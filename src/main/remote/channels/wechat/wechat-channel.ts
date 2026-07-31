import type {
  ChannelAdapter,
  ChannelAdapterConfig,
} from "../../runtime/channel-adapter";
import type {
  ChannelCommand,
  ChannelInteraction,
  ChannelInteractionResponse,
  ChannelPairingEvent,
  ChannelStatusEvent,
  ChannelTarget,
  DeliveryResult,
  FileAttachment,
  InboundAttachment,
  OutboundMessage,
  ReactionUpdate,
  StreamUpdate,
  UnifiedMessage,
} from "../../runtime/contracts";
import { normalizeMessage } from "../../runtime/inbound-normalizer";
import type { WeChatPuppetPairingEvent } from "./wechat-ilink-puppet";

// ---------------------------------------------------------------------------
// Module-level credential serialization (shared across Channel objects)
// ---------------------------------------------------------------------------

const credentialQueues = new Map<string, Promise<void>>();
const credentialEpochs = new Map<string, number>();

// ---------------------------------------------------------------------------
// Injectable puppet abstraction
// ---------------------------------------------------------------------------

export interface WeChatPuppetLike {
  onPairing(
    handler: (event: WeChatPuppetPairingEvent) => void,
  ): () => void;
  onCredentialInvalidated(handler: () => void): () => void;
  onLogin(handler: (user: unknown) => void): void;
  onLogout(handler: (user: unknown) => void): void;
  onMessage(handler: (message: unknown) => void): void;
  onError(handler: (error: Error) => void): void;
  start(token?: string): Promise<void>;
  stop(): Promise<void>;
  logout(): Promise<void>;
  isLoggedIn: boolean;
  sendText(contactId: string, text: string): Promise<{ id: string }>;
  sendImage(contactId: string, fileData: string): Promise<{ id: string }>;
  sendFile(
    contactId: string,
    fileData: string,
    filename?: string,
  ): Promise<{ id: string }>;
  sendTyping?(contactId: string): Promise<void>;
  stopTyping?(contactId: string): Promise<void>;
  downloadAttachment?(
    sourceRef: string,
    signal?: AbortSignal,
  ): Promise<Buffer>;
  contactAlias(contactId: string): Promise<string>;
  roomTopic(roomId: string): Promise<string>;
}

// ---------------------------------------------------------------------------
// Injectable token store
// ---------------------------------------------------------------------------

export interface WeChatTokenStore {
  load(instanceId: string): Promise<string | null>;
  save(instanceId: string, token: string): Promise<void>;
  clear(instanceId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Puppet message shape (minimal contract)
// ---------------------------------------------------------------------------

interface WeChatPuppetAttachment {
  id: string;
  filename?: string;
  mediaType?: string;
  sourceRef: string;
}

interface WeChatPuppetMessage {
  id: string;
  talker: () => { id: string; name: () => string };
  room: () => { id: string; topic: () => string } | null;
  text: () => string;
  type: () => number;
  attachments?: WeChatPuppetAttachment[];
}

function isWeChatPuppetMessage(msg: unknown): msg is WeChatPuppetMessage {
  if (!msg || typeof msg !== "object") return false;
  const m = msg as Record<string, unknown>;
  return (
    typeof m.id === "string" &&
    typeof m.talker === "function" &&
    typeof m.room === "function" &&
    typeof m.text === "function" &&
    typeof m.type === "function"
  );
}

// WeChat message types
const WECHAT_MSG_TYPE_IMAGE = 6;

// Image media types that the channel can deliver natively
const MAX_WECHAT_ATTACHMENT_BYTES = 30 * 1024 * 1024;
const MAX_WECHAT_MESSAGE_ATTACHMENT_BYTES = 50 * 1024 * 1024;

const SUPPORTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/bmp",
]);

// ---------------------------------------------------------------------------
// WeChatChannel
// ---------------------------------------------------------------------------

function resolveSendTarget(target: ChannelTarget): string {
  return target.visibility === "private" ? target.userId : target.chatId;
}

export class WeChatChannel implements ChannelAdapter {
  readonly channelType = "wechat" as const;
  readonly channelInstanceId: string;
  readonly generation: number;

  private connectedState = false;
  private listenersRegistered = false;
  private readonly messageHandlers = new Set<
    (message: UnifiedMessage) => void
  >();
  private readonly commandHandlers = new Set<
    (command: ChannelCommand) => void
  >();
  private readonly interactionHandlers = new Set<
    (interaction: ChannelInteraction) => void
  >();
  private readonly statusHandlers = new Set<
    (status: ChannelStatusEvent) => void
  >();
  private readonly errorHandlers = new Set<(error: Error) => void>();
  private readonly pairingHandlers = new Set<
    (event: ChannelPairingEvent) => void
  >();
  private readonly deliveries = new Map<string, DeliveryResult>();

  // One removable external abort listener — no recursive abort ownership.
  private externalAbortCleanup: (() => void) | null = null;
  // Serialize connect attempts and teardown so stale starts cannot affect newer ones.
  private connectingPromise: Promise<void> | null = null;
  private stoppingPromise: Promise<void> | null = null;
  // When true, suppress callbacks and credential writes from this adapter.
  private teardownStarted = false;
  // Invalidates connect work that was awaiting an earlier lifecycle operation.
  private lifecycleEpoch = 0;
  // Tracks whether a start may have made the Puppet active.
  private puppetMayBeRunning = false;

  constructor(
    _config: ChannelAdapterConfig,
    generation: number,
    private readonly puppet: WeChatPuppetLike,
    private readonly tokenStore: WeChatTokenStore,
    // Kept for constructor compatibility; protocol is no longer used in
    // lifecycle. Tests may inject it.
    _protocol?: unknown,
  ) {
    this.channelInstanceId = _config.channelInstanceId;
    this.generation = generation;
    void _protocol;
  }

  get connected(): boolean {
    return this.connectedState;
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  async connect(signal: AbortSignal): Promise<void> {
    const previous = this.connectingPromise;
    if (previous) {
      await previous.catch(() => undefined);
    }
    if (signal.aborted) return;

    const operation = this.connectInternal(signal);
    const tracked = operation.finally(() => {
      if (this.connectingPromise === tracked) this.connectingPromise = null;
    });
    this.connectingPromise = tracked;
    return tracked;
  }

  private async connectInternal(signal: AbortSignal): Promise<void> {
    if (this.connectedState) return;

    // Already-aborted signal: return silently, no failed status.
    if (signal.aborted) return;

    // If a previous lifecycle is still stopping, wait for it so we do not
    // lose the start.
    if (this.stoppingPromise) {
      await this.stoppingPromise;
      this.stoppingPromise = null;
      // Recheck: abort may have fired during the wait.
      if (signal.aborted) return;
    }

    this.teardownStarted = false;
    const lifecycleEpoch = ++this.lifecycleEpoch;
    this.emitStatus("starting");

    // Remove any stale external abort listener from a previous lifecycle.
    if (this.externalAbortCleanup) {
      this.externalAbortCleanup();
      this.externalAbortCleanup = null;
    }

    const cleanupExternalAbort = () => {
      signal.removeEventListener("abort", onExternalAbort);
      if (this.externalAbortCleanup === cleanupExternalAbort) {
        this.externalAbortCleanup = null;
      }
    };
    const onExternalAbort = () => {
      cleanupExternalAbort();
      if (lifecycleEpoch !== this.lifecycleEpoch) return;
      this.teardownConnection().catch(() => {
        /* best-effort */
      });
    };
    signal.addEventListener("abort", onExternalAbort, { once: true });
    this.externalAbortCleanup = cleanupExternalAbort;

    // 1. Load persisted token (rethrow on failure)
    try {
      const token = await this.tokenStore.load(this.channelInstanceId);

      // Recheck: abort may have fired during load.
      if (signal.aborted || lifecycleEpoch !== this.lifecycleEpoch) {
        cleanupExternalAbort();
        return;
      }

      // 2. Register puppet listeners once
      this.registerPuppetListeners();

      // 3. Final signal check before starting puppet.
      if (signal.aborted || lifecycleEpoch !== this.lifecycleEpoch) {
        cleanupExternalAbort();
        return;
      }

      // 4. Start puppet (returns immediately, login/pairing via events).
      // Mark it before awaiting so disconnect-during-start performs a stop.
      const startPromise = this.puppet.start(token ?? undefined);
      this.puppetMayBeRunning = true;
      await startPromise;
      // A delayed start may become active after an earlier stop completed.
      this.puppetMayBeRunning = true;
      if (signal.aborted || lifecycleEpoch !== this.lifecycleEpoch) {
        await this.teardownConnection();
      }

      // Do not check isLoggedIn — puppet emits events asynchronously
    } catch (err) {
      if (
        signal.aborted ||
        lifecycleEpoch !== this.lifecycleEpoch ||
        this.teardownStarted
      ) {
        cleanupExternalAbort();
        return;
      }
      const error = err instanceof Error ? err : new Error(String(err));
      this.emitError(error);
      this.emitStatus("failed");
      throw error;
    }
  }

  async disconnect(options?: { reason: string; timeoutMs: number }): Promise<void> {
    this.teardownStarted = true;
    // Enqueue clear before teardown so a new generation's save remains ordered,
    // but do not let a slow credential backend delay stopping network activity.
    const clearPromise = options?.reason === "user"
      ? this.clearCredentials()
      : Promise.resolve();
    const stopPromise = this.teardownConnection().then(async () => {
      if (options?.reason !== "user") return;
      try {
        await this.puppet.logout();
      } catch {
        // best-effort
      }
    });
    const completion = Promise.all([clearPromise, stopPromise]).then(
      () => undefined,
    );
    await settleWithin(completion, options?.timeoutMs);
    this.emitStatus("stopped");
  }

  // -----------------------------------------------------------------------
  // Sending
  // -----------------------------------------------------------------------

  async send(message: OutboundMessage): Promise<DeliveryResult> {
    const existing = this.deliveries.get(message.idempotencyKey);
    if (existing) return existing;

    if (!this.connectedState) {
      return this.failure(message.idempotencyKey, "CHANNEL_NOT_CONNECTED");
    }

    const attachments = message.attachments ?? [];
    const attachmentBytes = attachments.reduce(
      (total, attachment) =>
        total +
        (attachment.data ? Buffer.byteLength(attachment.data, "base64") : 0),
      0,
    );
    if (
      attachments.some(
        (attachment) =>
          attachment.data !== undefined &&
          Buffer.byteLength(attachment.data, "base64") >
            MAX_WECHAT_ATTACHMENT_BYTES,
      ) ||
      attachmentBytes > MAX_WECHAT_MESSAGE_ATTACHMENT_BYTES
    ) {
      return this.failure(message.idempotencyKey, "ATTACHMENT_TOO_LARGE");
    }
    if (!message.text && attachments.length === 0) {
      return this.failure(message.idempotencyKey, "WECHAT_EMPTY_MESSAGE");
    }
    if (attachments.some((attachment) => !attachment.data)) {
      return this.failure(
        message.idempotencyKey,
        "CHANNEL_CAPABILITY_UNAVAILABLE",
      );
    }

    try {
      let platformMessageId: string | undefined;
      const recipient = resolveSendTarget(message.target);
      if (message.text) {
        const sent = await this.puppet.sendText(
          recipient,
          message.text,
        );
        platformMessageId = sent.id;
      }
      for (const attachment of attachments) {
        const sent = SUPPORTED_IMAGE_TYPES.has(attachment.mediaType)
          ? await this.puppet.sendImage(
              recipient,
              attachment.data!,
            )
          : await this.puppet.sendFile(
              recipient,
              attachment.data!,
              attachment.filename,
            );
        platformMessageId = sent.id;
      }
      const result: DeliveryResult = {
        version: 1,
        generation: message.generation,
        accepted: true,
        committed: true,
        outcome: "committed",
        idempotencyKey: message.idempotencyKey,
        platformMessageId,
      };
      this.deliveries.set(message.idempotencyKey, result);
      return result;
    } catch (err) {
      return this.retryableFailure(
        message.idempotencyKey,
        err instanceof Error ? err.message : "WECHAT_SEND_FAILED",
      );
    }
  }

  async sendFile(
    target: ChannelTarget,
    file: FileAttachment,
    idempotencyKey: string,
  ): Promise<DeliveryResult> {
    const existing = this.deliveries.get(idempotencyKey);
    if (existing) return existing;

    if (!this.connectedState) {
      return this.failure(idempotencyKey, "CHANNEL_NOT_CONNECTED");
    }
    if (file.size > MAX_WECHAT_ATTACHMENT_BYTES) {
      return this.failure(idempotencyKey, "ATTACHMENT_TOO_LARGE");
    }

    try {
      const recipient = resolveSendTarget(target);
      const sent = SUPPORTED_IMAGE_TYPES.has(file.mediaType)
        ? await this.puppet.sendImage(recipient, file.data)
        : await this.puppet.sendFile(recipient, file.data, file.filename);
      const result: DeliveryResult = {
        version: 1,
        generation: this.generation,
        accepted: true,
        committed: true,
        outcome: "committed",
        idempotencyKey,
        platformMessageId: sent.id,
      };
      this.deliveries.set(idempotencyKey, result);
      return result;
    } catch (err) {
      return this.retryableFailure(
        idempotencyKey,
        err instanceof Error ? err.message : "WECHAT_SEND_FILE_FAILED",
      );
    }
  }

  respondInteraction(
    response: ChannelInteractionResponse,
  ): Promise<DeliveryResult> {
    return this.send({
      version: 1,
      generation: response.generation,
      idempotencyKey: response.idempotencyKey,
      target: response.target,
      text: response.text,
      kind: "interaction",
    });
  }

  setReaction(
    _target: ChannelTarget,
    reaction: ReactionUpdate,
  ): Promise<DeliveryResult> {
    // WeChat puppet doesn't support reactions natively
    return Promise.resolve(
      this.failure(reaction.idempotencyKey, "CHANNEL_CAPABILITY_UNAVAILABLE"),
    );
  }

  async sendTyping(target: ChannelTarget): Promise<void> {
    await this.puppet.sendTyping?.(resolveSendTarget(target));
  }

  async downloadAttachment(
    sourceRef: string,
    signal?: AbortSignal,
  ): Promise<Buffer> {
    if (!this.puppet.downloadAttachment) {
      throw new Error("ATTACHMENT_SOURCE_UNAVAILABLE");
    }
    return this.puppet.downloadAttachment(sourceRef, signal);
  }

  streamUpdate(
    target: ChannelTarget,
    update: StreamUpdate,
  ): Promise<DeliveryResult> {
    return this.send({
      version: 1,
      generation: update.generation,
      idempotencyKey: update.idempotencyKey,
      target,
      text: update.fullText,
      kind: "reply",
    });
  }

  async streamComplete(
    target: ChannelTarget,
    finalText: string,
    idempotencyKey: string,
  ): Promise<DeliveryResult> {
    const existing = this.deliveries.get(idempotencyKey);
    if (existing) return existing;

    if (!this.connectedState) {
      return this.failure(idempotencyKey, "CHANNEL_NOT_CONNECTED");
    }

    try {
      const recipient = resolveSendTarget(target);
      const sent = await this.puppet.sendText(recipient, finalText);
      const result: DeliveryResult = {
        version: 1,
        generation: this.generation,
        accepted: true,
        committed: true,
        outcome: "committed",
        idempotencyKey,
        platformMessageId: sent.id,
      };
      this.deliveries.set(idempotencyKey, result);
      return result;
    } catch (err) {
      return this.retryableFailure(
        idempotencyKey,
        err instanceof Error ? err.message : "WECHAT_STREAM_COMPLETE_FAILED",
      );
    }
  }

  streamError(
    target: ChannelTarget,
    error: string,
    idempotencyKey: string,
  ): Promise<DeliveryResult> {
    return this.send({
      version: 1,
      generation: this.generation,
      idempotencyKey,
      target,
      text: `[Stream error] ${error}`,
      kind: "error",
    });
  }

  lookupDelivery(idempotencyKey: string): Promise<DeliveryResult> {
    const existing = this.deliveries.get(idempotencyKey);
    return Promise.resolve(
      existing ?? {
        version: 1,
        generation: this.generation,
        accepted: false,
        committed: false,
        outcome: "unknown",
        idempotencyKey,
      },
    );
  }

  // -----------------------------------------------------------------------
  // Event subscriptions
  // -----------------------------------------------------------------------

  onMessage(handler: (message: UnifiedMessage) => void): () => void {
    return this.subscribe(this.messageHandlers, handler);
  }
  onCommand(handler: (command: ChannelCommand) => void): () => void {
    return this.subscribe(this.commandHandlers, handler);
  }
  onInteraction(handler: (interaction: ChannelInteraction) => void): () => void {
    return this.subscribe(this.interactionHandlers, handler);
  }
  onPairing(
    handler: (event: ChannelPairingEvent) => void,
  ): () => void {
    return this.subscribe(this.pairingHandlers, handler);
  }
  onStatus(handler: (status: ChannelStatusEvent) => void): () => void {
    return this.subscribe(this.statusHandlers, handler);
  }
  onError(handler: (error: Error) => void): () => void {
    return this.subscribe(this.errorHandlers, handler);
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  private registerPuppetListeners(): void {
    if (this.listenersRegistered) return;
    this.listenersRegistered = true;

    // Pairing events (QR flow)
    this.puppet.onPairing((puppetEvent) => {
      if (this.teardownStarted) return;
      const channelEvent: ChannelPairingEvent = {
        version: 1,
        channelType: "wechat",
        channelInstanceId: this.channelInstanceId,
        generation: this.generation,
        state: puppetEvent.state,
        imageUrl:
          puppetEvent.state === "pending" || puppetEvent.state === "scanned"
            ? puppetEvent.imageUrl
            : undefined,
        errorCode: puppetEvent.errorCode,
        timestamp: Date.now(),
      };
      for (const handler of this.pairingHandlers) {
        try {
          handler(channelEvent);
        } catch {
          // handler errors must not break the event loop
        }
      }
      if (puppetEvent.state === "failed") {
        this.connectedState = false;
        this.emitStatus(
          "failed",
          puppetEvent.errorCode ?? "WECHAT_QR_LOGIN_FAILED",
        );
      }
    });

    // Credential invalidation — clear saved token and transition to reconnecting.
    this.puppet.onCredentialInvalidated(() => {
      if (this.teardownStarted) return;
      this.connectedState = false;
      this.emitStatus("reconnecting");
      this.clearCredentials().catch(() => {
        /* fire-and-forget; clearCredentials already emits on failure */
      });
    });

    // Login
    this.puppet.onLogin((user: unknown) => {
      if (this.teardownStarted) return;
      this.connectedState = true;
      this.emitStatus("connected");

      // Persist token via serialized queue so a concurrent clear wins.
      const token = this.deriveToken(user);
      if (token) {
        this.saveCredentials(token);
      }
    });

    // Inbound messages
    this.puppet.onMessage((raw: unknown) => {
      if (this.teardownStarted || !isWeChatPuppetMessage(raw)) return;
      this.handleInboundMessage(raw);
    });

    // Errors
    this.puppet.onError((err: Error) => {
      if (this.teardownStarted) return;
      this.emitError(err);
    });
  }

  private handleInboundMessage(msg: WeChatPuppetMessage): void {
    const talker = msg.talker();
    const room = msg.room();
    const text = msg.text();
    const msgType = msg.type();

    const isGroup = room !== null;
    const chatId = isGroup ? room.id : talker.id;
    const chatKind = isGroup ? "group" : "dm";

    const attachments: InboundAttachment[] =
      msg.attachments?.map((attachment) => ({
        version: 1,
        id: attachment.id,
        filename: attachment.filename,
        mediaType: attachment.mediaType,
        sourceRef: attachment.sourceRef,
        sourceKind: "platform",
      })) ?? [];
    if (attachments.length === 0 && msgType === WECHAT_MSG_TYPE_IMAGE) {
      attachments.push({
        version: 1,
        id: `${msg.id}-img`,
        filename: `wechat-image-${msg.id}.jpg`,
        sourceRef: `wechat:${this.channelInstanceId}:image:${msg.id}`,
        sourceKind: "platform",
      });
    }

    const unified = normalizeMessage({
      version: 1,
      generation: this.generation,
      id: `${this.channelInstanceId}:${msg.id}`,
      channelType: "wechat",
      channelInstanceId: this.channelInstanceId,
      chatId,
      userId: talker.id,
      userName: talker.name(),
      isBot: false,
      chatKind,
      text,
      attachments,
      mentions: [],
      timestamp: Date.now(),
    });

    for (const handler of this.messageHandlers) {
      try {
        handler(unified);
      } catch {
        // handler errors must not break the message loop
      }
    }
  }

  // Idempotent: safe to call multiple times without side effects.
  private async teardownConnection(): Promise<void> {
    if (this.stoppingPromise) return this.stoppingPromise;

    this.teardownStarted = true;
    this.lifecycleEpoch += 1;
    this.connectedState = false;

    // Remove the external abort listener so stale signals cannot interfere.
    if (this.externalAbortCleanup) {
      this.externalAbortCleanup();
      this.externalAbortCleanup = null;
    }

    if (!this.puppetMayBeRunning) return;
    this.puppetMayBeRunning = false;
    const stopPromise = this.puppet.stop().catch(() => {
      /* best-effort */
    });
    this.stoppingPromise = stopPromise;
    try {
      await stopPromise;
    } finally {
      if (this.stoppingPromise === stopPromise) {
        this.stoppingPromise = null;
      }
    }
  }

  private deriveToken(user: unknown): string | null {
    if (!user || typeof user !== "object") return null;
    const u = user as Record<string, unknown>;
    if (typeof u.token === "string" && u.token.length > 0) return u.token;
    if (typeof u.id === "string") return `wx:${u.id}`;
    return null;
  }

  // -----------------------------------------------------------------------
  // Delivery helpers
  // -----------------------------------------------------------------------

  private failure(
    idempotencyKey: string,
    errorCode: string,
  ): DeliveryResult {
    const existing = this.deliveries.get(idempotencyKey);
    if (existing) return existing;
    const result: DeliveryResult = {
      version: 1,
      generation: this.generation,
      accepted: false,
      committed: false,
      outcome: "permanent_failure",
      idempotencyKey,
      errorCode,
    };
    this.deliveries.set(idempotencyKey, result);
    return result;
  }

  private retryableFailure(
    idempotencyKey: string,
    errorCode: string,
  ): DeliveryResult {
    const existing = this.deliveries.get(idempotencyKey);
    if (existing) return existing;
    const result: DeliveryResult = {
      version: 1,
      generation: this.generation,
      accepted: false,
      committed: false,
      outcome: "retryable_failure",
      idempotencyKey,
      errorCode,
      retryable: true,
    };
    this.deliveries.set(idempotencyKey, result);
    return result;
  }

  private emitStatus(
    state: ChannelStatusEvent["state"],
    errorCode?: string,
  ): void {
    const status: ChannelStatusEvent = {
      version: 1,
      channelType: this.channelType,
      channelInstanceId: this.channelInstanceId,
      generation: this.generation,
      state,
      errorCode,
      timestamp: Date.now(),
    };
    for (const handler of this.statusHandlers) {
      try {
        handler(status);
      } catch {
        // best-effort
      }
    }
  }

  // -----------------------------------------------------------------------
  // Serialized credential operations with module-level queue and epoch
  // shared across WeChatChannel objects with the same channelInstanceId.
  // -----------------------------------------------------------------------

  private saveCredentials(token: string): void {
    // Suppress credential writes once teardown has begun on this instance.
    if (this.teardownStarted) return;

    const id = this.channelInstanceId;
    const currentEpoch = credentialEpochs.get(id) ?? 0;
    const epoch = currentEpoch + 1;
    credentialEpochs.set(id, epoch);

    const queue = credentialQueues.get(id) ?? Promise.resolve();
    const saveOp = queue.then(async () => {
      // A later clear bumped the epoch — discard this stale save.
      if (credentialEpochs.get(id) !== epoch) return;
      await this.tokenStore.save(id, token);
    });
    credentialQueues.set(
      id,
      saveOp.catch(() => {
        /* suppress queue unhandled rejection */
      }),
    );
    saveOp.catch(() => {
      this.emitError(new Error("WECHAT_CREDENTIAL_PERSIST_FAILED"));
    });
  }

  private async clearCredentials(): Promise<void> {
    const id = this.channelInstanceId;
    const currentEpoch = credentialEpochs.get(id) ?? 0;
    credentialEpochs.set(id, currentEpoch + 1); // invalidate any in-flight save

    const queue = credentialQueues.get(id) ?? Promise.resolve();
    const clearOp = queue.then(() =>
      this.tokenStore.clear(id),
    );
    credentialQueues.set(
      id,
      clearOp.catch(() => {
        /* suppress queue unhandled rejection */
      }),
    );
    try {
      await clearOp;
    } catch {
      this.emitError(new Error("WECHAT_CREDENTIAL_CLEAR_FAILED"));
    }
  }

  // -----------------------------------------------------------------------

  private emitError(error: Error): void {
    for (const handler of this.errorHandlers) {
      try {
        handler(error);
      } catch {
        // best-effort
      }
    }
  }

  private subscribe<T>(set: Set<T>, handler: T): () => void {
    set.add(handler);
    return () => {
      set.delete(handler);
    };
  }
}

async function settleWithin(
  promise: Promise<void>,
  timeoutMs: number | undefined,
): Promise<void> {
  if (timeoutMs === undefined || timeoutMs <= 0) {
    await promise;
    return;
  }
  let timeout: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    promise,
    new Promise<void>((resolve) => {
      timeout = setTimeout(resolve, timeoutMs);
    }),
  ]);
  if (timeout !== undefined) clearTimeout(timeout);
}
