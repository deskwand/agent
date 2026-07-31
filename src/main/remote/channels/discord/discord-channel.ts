import type {
  ChannelAdapter,
  ChannelAdapterConfig,
} from "../../runtime/channel-adapter";
import type {
  ChannelCommand,
  ChannelInteraction,
  ChannelStatusEvent,
  ChannelTarget,
  DeliveryResult,
  OutboundMessage,
  StreamUpdate,
  UnifiedMessage,
} from "../../runtime/contracts";
import { normalizeMessage } from "../../runtime/inbound-normalizer";
import type { DiscordRestLike } from "./discord-rest";
import type {
  DiscordGatewayLike,
  DiscordGatewayPayload,
} from "./discord-gateway";

// ---------------------------------------------------------------------------
// Discord Gateway op codes
// ---------------------------------------------------------------------------

const OP_DISPATCH = 0;
const OP_HEARTBEAT = 1;
const OP_IDENTIFY = 2;
const OP_RESUME = 6;
const OP_RECONNECT = 7;
const OP_HELLO = 10;
const OP_HEARTBEAT_ACK = 11;

// ---------------------------------------------------------------------------
// Intents (bitfield)
// ---------------------------------------------------------------------------

const INTENT_GUILD_MESSAGES = 1 << 9; // 512
const INTENT_DIRECT_MESSAGES = 1 << 12; // 4096
const INTENT_MESSAGE_CONTENT = 1 << 15; // 32768
const DEFAULT_INTENTS =
  INTENT_GUILD_MESSAGES | INTENT_DIRECT_MESSAGES | INTENT_MESSAGE_CONTENT;

// ---------------------------------------------------------------------------
// Resume / reconnect
// ---------------------------------------------------------------------------

const MAX_RESUME_WINDOW_MS = 60_000;
const MAX_RESUME_RETRIES = 3;

// ---------------------------------------------------------------------------
// DiscordGatewayMessage (inbound from handleGatewayEvent for test compat)
// ---------------------------------------------------------------------------

interface DiscordGatewayMessage {
  t?: string;
  op?: number;
  d?: {
    id?: string;
    channel_id?: string;
    content?: string;
    guild_id?: string;
    author?: { id: string; username?: string; bot?: boolean };
  };
}

// ---------------------------------------------------------------------------
// DiscordChannel
// ---------------------------------------------------------------------------

export class DiscordChannel implements ChannelAdapter {
  readonly channelType = "discord" as const;
  readonly channelInstanceId: string;
  readonly generation: number;

  private connectedState = false;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatIntervalMs = 0;
  private lastSequence: number | null = null;
  private sessionId: string | null = null;
  private resumeUrl: string | null = null;
  private resumeGateOpen = 0;
  private resumeRetries = 0;

  private readonly messageHandlers = new Set<(message: UnifiedMessage) => void>();
  private readonly commandHandlers = new Set<(command: ChannelCommand) => void>();
  private readonly interactionHandlers = new Set<
    (interaction: ChannelInteraction) => void
  >();
  private readonly statusHandlers = new Set<
    (status: ChannelStatusEvent) => void
  >();
  private readonly errorHandlers = new Set<(error: Error) => void>();
  private readonly deliveries = new Map<string, DeliveryResult>();

  private unsubscribeGateway: Array<() => void> = [];
  private readyResolve: (() => void) | null = null;
  private readyReject: ((err: Error) => void) | null = null;
  private signal: AbortSignal | null = null;
  private token: string;
  private stopping = false;
  private serverReconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    _config: ChannelAdapterConfig,
    generation: number,
    private readonly rest: DiscordRestLike,
    private readonly gateway?: DiscordGatewayLike,
  ) {
    this.channelInstanceId = _config.channelInstanceId;
    this.generation = generation;
    this.token = String(_config.settings.botToken ?? "");
  }

  // -------------------------------------------------------------------
  // ChannelAdapter
  // -------------------------------------------------------------------

  get connected(): boolean {
    return this.connectedState;
  }

  connect(signal?: AbortSignal): Promise<void> {
    // Backward-compat: no gateway -> stub mode (test only)
    if (!this.gateway) {
      this.connectedState = true;
      this.emitStatus("connected");
      return Promise.resolve();
    }

    this.signal = signal ?? null;
    this.stopping = false;
    this.connectedState = false;
    const connection = this.connectGateway();
    // Runtime managers may observe status events without awaiting connect.
    void connection.catch(() => undefined);
    return connection;
  }

  async disconnect(options?: {
    reason: string;
    timeoutMs: number;
  }): Promise<void> {
    this.stopping = true;
    if (this.serverReconnectTimer !== null) {
      clearTimeout(this.serverReconnectTimer);
      this.serverReconnectTimer = null;
    }
    this.stopHeartbeat();
    this.unsubscribeAll();
    // Resolve pending connect waiters by rejecting them on an explicit stop.
    this.readyReject?.(new Error("DISCORD_GATEWAY_STOPPED"));
    this.readyReject = null;
    this.readyResolve = null;
    if (this.gateway) {
      this.gateway.close(1000, options?.reason ?? "client_disconnect");
    }
    this.sessionId = null;
    this.lastSequence = null;
    this.resumeUrl = null;
    this.resumeGateOpen = 0;
    this.resumeRetries = 0;
    this.connectedState = false;
    this.emitStatus("stopped");
  }

  async send(message: OutboundMessage): Promise<DeliveryResult> {
    const existing = this.deliveries.get(message.idempotencyKey);
    if (existing) return existing;
    if (message.target.visibility === "private") {
      return this.failure(message.idempotencyKey, "PRIVATE_DELIVERY_UNSUPPORTED");
    }
    if (!message.text)
      return this.failure(message.idempotencyKey, "DISCORD_EMPTY_MESSAGE");
    let platformMessageId: string | undefined;
    for (const part of splitDiscordText(message.text)) {
      const sent = await this.rest.sendMessage(
        message.target.chatId,
        part,
        message.replyToMessageId,
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

  // -------------------------------------------------------------------
  // Event subscriptions
  // -------------------------------------------------------------------

  onMessage(handler: (message: UnifiedMessage) => void): () => void {
    return this.subscribe(this.messageHandlers, handler);
  }
  onCommand(handler: (command: ChannelCommand) => void): () => void {
    return this.subscribe(this.commandHandlers, handler);
  }
  onInteraction(handler: (interaction: ChannelInteraction) => void): () => void {
    return this.subscribe(this.interactionHandlers, handler);
  }
  onStatus(handler: (status: ChannelStatusEvent) => void): () => void {
    return this.subscribe(this.statusHandlers, handler);
  }
  onError(handler: (error: Error) => void): () => void {
    return this.subscribe(this.errorHandlers, handler);
  }

  // -------------------------------------------------------------------
  // Test-compat: direct gateway event injection
  // -------------------------------------------------------------------

  handleGatewayEvent(event: DiscordGatewayMessage): void {
    if (event.op === OP_HEARTBEAT_ACK) return;
    if (
      event.t !== "MESSAGE_CREATE" ||
      !event.d?.id ||
      !event.d.channel_id ||
      !event.d.author
    )
      return;
    if (event.d.author.bot) return;
    const message = normalizeMessage({
      version: 1,
      generation: this.generation,
      id: `${this.channelInstanceId}:${event.d.id}`,
      channelType: "discord",
      channelInstanceId: this.channelInstanceId,
      chatId: event.d.channel_id,
      userId: event.d.author.id,
      userName: event.d.author.username,
      isBot: event.d.author.bot,
      chatKind: event.d.guild_id ? "channel" : "dm",
      text: event.d.content ?? "",
      attachments: [],
      mentions: [],
      timestamp: Date.now(),
    });
    for (const handler of this.messageHandlers) handler(message);
  }

  // -------------------------------------------------------------------
  // Private: Gateway lifecycle
  // -------------------------------------------------------------------

  private async connectGateway(): Promise<void> {
    if (!this.gateway) return;

    const gatewayUrl = this.resumeUrl ?? (await this.rest.getGatewayUrl());
    this.resumeUrl = gatewayUrl;
    this.emitStatus("starting");

    // Wire gateway event handlers
    this.unsubscribeAll();
    this.unsubscribeGateway.push(
      this.gateway.onPayload((p) => this.onGatewayPayload(p)),
      this.gateway.onClose((code, reason) =>
        this.onGatewayClose(code, reason),
      ),
      this.gateway.onError((error) => this.onGatewayError(error)),
    );

    const signal = this.signal ?? new AbortController().signal;
    const ready = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    // The adapter may be started by a lifecycle manager that does not await
    // the readiness promise; prevent a transport close from becoming an
    // unhandled rejection while preserving rejection for explicit callers.
    void ready.catch(() => undefined);
    await this.gateway.connect(gatewayUrl, signal);

    // Wait for READY dispatch (or error)
    return ready;
  }

  private onGatewayPayload(payload: DiscordGatewayPayload): void {
    // Track sequence for heartbeat payloads and resume
    if (payload.s != null) this.lastSequence = payload.s;

    switch (payload.op) {
      case OP_HELLO:
        this.onHello(payload);
        break;
      case OP_DISPATCH:
        this.onDispatch(payload);
        break;
      case OP_HEARTBEAT:
        this.sendHeartbeat();
        break;
      case OP_HEARTBEAT_ACK:
        // Heartbeat acknowledged — no action needed
        break;
      case OP_RECONNECT:
        this.onServerReconnect();
        break;
      default:
        break;
    }
  }

  private onHello(payload: DiscordGatewayPayload): void {
    const d = payload.d as
      | { heartbeat_interval: number }
      | undefined;
    this.heartbeatIntervalMs = d?.heartbeat_interval ?? this.heartbeatIntervalMs;
    // Start heartbeat before identify so we don't miss the first interval
    this.startHeartbeat();

    // Send Identify or Resume
    if (this.canResume()) {
      this.sendResume();
    } else {
      this.sendIdentify();
    }
  }

  private onDispatch(payload: DiscordGatewayPayload): void {
    switch (payload.t) {
      case "READY": {
        const d = payload.d as
          | { session_id: string; resume_gateway_url?: string }
          | undefined;
        if (d?.session_id) {
          this.sessionId = d.session_id;
          this.resumeGateOpen = Date.now();
          this.resumeRetries = 0;
          if (d.resume_gateway_url) this.resumeUrl = d.resume_gateway_url;
        }
        this.connectedState = true;
        this.emitStatus("connected");
        this.resolveReady();
        break;
      }
      case "RESUMED":
        this.resumeRetries = 0;
        this.connectedState = true;
        this.emitStatus("connected");
        this.resolveReady();
        break;
      case "MESSAGE_CREATE":
        this.onMessageCreate(payload);
        break;
      default:
        break;
    }
  }

  private onMessageCreate(payload: DiscordGatewayPayload): void {
    const d = payload.d as Record<string, unknown> | undefined;
    if (!d?.id || !d?.channel_id || !d?.author) return;
    const author = d.author as Record<string, unknown>;
    if (author.bot) return;

    const message = normalizeMessage({
      version: 1,
      generation: this.generation,
      id: `${this.channelInstanceId}:${d.id as string}`,
      channelType: "discord",
      channelInstanceId: this.channelInstanceId,
      chatId: d.channel_id as string,
      userId: author.id as string,
      userName: (author.username as string) ?? undefined,
      isBot: Boolean(author.bot),
      chatKind: d.guild_id ? "channel" : "dm",
      text: (d.content as string) ?? "",
      attachments: [],
      mentions: [],
      timestamp: Date.now(),
    });
    for (const handler of this.messageHandlers) handler(message);
  }

  private onGatewayClose(code: number, reason: string): void {
    this.stopHeartbeat();

    // Reject any pending ready promise if we never got READY
    if (this.readyReject) {
      this.readyReject(
        new Error(`DISCORD_GATEWAY_CLOSED:${code}:${reason}`),
      );
      this.readyReject = null;
      this.readyResolve = null;
    }

    if (this.stopping || code === 1000 || code === 1001) {
      // Clean close — no reconnect
      this.connectedState = false;
      this.emitStatus("stopped");
      return;
    }

    // Try resume first, then give up
    if (this.canResume()) {
      this.emitStatus("reconnecting");
      this.attemptResume().catch(() => {
        this.sessionId = null;
        this.lastSequence = null;
        this.emitStatus("failed");
      });
    } else {
      this.sessionId = null;
      this.lastSequence = null;
      this.connectedState = false;
      this.emitStatus("failed");
    }
  }

  private onGatewayError(error: Error): void {
    for (const handler of this.errorHandlers) handler(error);
    // Reject pending ready promise
    if (this.readyReject) {
      this.readyReject(error);
      this.readyReject = null;
      this.readyResolve = null;
    }
  }

  // -------------------------------------------------------------------
  // Private: Identify / Resume
  // -------------------------------------------------------------------

  private sendIdentify(): void {
    if (!this.gateway) return;
    const token = this.token;
    this.gateway.send({
      op: OP_IDENTIFY,
      d: {
        token,
        intents: DEFAULT_INTENTS,
        properties: {
          os: process.platform,
          browser: "deskwand",
          device: "deskwand",
        },
      },
    });
  }

  private canResume(): boolean {
    return (
      this.sessionId !== null &&
      this.lastSequence !== null &&
      Date.now() - this.resumeGateOpen < MAX_RESUME_WINDOW_MS &&
      this.resumeRetries < MAX_RESUME_RETRIES
    );
  }

  private sendResume(): void {
    if (!this.gateway || !this.sessionId) return;
    const token = this.token;
    this.gateway.send({
      op: OP_RESUME,
      d: {
        token,
        session_id: this.sessionId,
        seq: this.lastSequence ?? 0,
      },
    });
    this.resumeRetries++;
  }

  private async attemptResume(): Promise<void> {
    // Brief delay then reconnect
    await sleep(1000);
    if (this.stopping || this.connectedState) return;
    // Reset ready promise state for reconnect
    this.readyResolve = null;
    this.readyReject = null;
    await this.connectGateway();
  }

  private onServerReconnect(): void {
    this.stopHeartbeat();
    if (this.stopping) return;
    if (this.gateway) {
      this.gateway.close(1001, "server_reconnect");
    }
    // Reset session for new identify
    this.sessionId = null;
    this.lastSequence = null;
    this.resumeRetries = 0;
    this.serverReconnectTimer = setTimeout(() => {
      this.serverReconnectTimer = null;
      if (this.stopping) return;
      this.connectGateway().catch(() => {
        this.emitStatus("failed");
      });
    }, 1_000);
  }

  // -------------------------------------------------------------------
  // Private: Heartbeat
  // -------------------------------------------------------------------

  private startHeartbeat(): void {
    this.stopHeartbeat();
    if (this.heartbeatIntervalMs <= 0) return;
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat();
    }, this.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private sendHeartbeat(): void {
    if (!this.gateway) return;
    this.gateway.send({
      op: OP_HEARTBEAT,
      d: this.lastSequence,
    });
  }

  // -------------------------------------------------------------------
  // Private: Ready resolution
  // -------------------------------------------------------------------

  private resolveReady(): void {
    if (this.readyResolve) {
      this.readyResolve();
      this.readyResolve = null;
      this.readyReject = null;
    }
  }

  // -------------------------------------------------------------------
  // Private: token injection (for use in production bootstrap)
  // -------------------------------------------------------------------

  /** Inject the bot token for Identify/Resume payloads.
   *  Deliberate escape hatch to avoid storing the token in a visible
   *  instance field while still including it in gateway payloads. */
  _setToken(token: string): void {
    this.token = token;
  }

  // -------------------------------------------------------------------
  // Private: helpers
  // -------------------------------------------------------------------

  private failure(idempotencyKey: string, errorCode: string): DeliveryResult {
    return {
      version: 1,
      generation: this.generation,
      accepted: false,
      committed: false,
      outcome: "permanent_failure",
      idempotencyKey,
      errorCode,
    };
  }

  private emitStatus(state: ChannelStatusEvent["state"]): void {
    const status: ChannelStatusEvent = {
      version: 1,
      channelType: this.channelType,
      channelInstanceId: this.channelInstanceId,
      generation: this.generation,
      state,
      timestamp: Date.now(),
    };
    for (const handler of this.statusHandlers) handler(status);
  }

  private subscribe<T>(set: Set<T>, handler: T): () => void {
    set.add(handler);
    return () => set.delete(handler);
  }

  private unsubscribeAll(): void {
    for (const unsubscribe of this.unsubscribeGateway) unsubscribe();
    this.unsubscribeGateway = [];
  }
}

// ---------------------------------------------------------------------------
// Export: message splitter
// ---------------------------------------------------------------------------

export function splitDiscordText(text: string): string[] {
  if (text.length <= 2000) return [text];
  const parts: string[] = [];
  for (let offset = 0; offset < text.length; offset += 2000) {
    parts.push(text.slice(offset, offset + 2000));
  }
  return parts;
}

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
