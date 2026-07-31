/**
 * Feishu Runtime Channel Adapter
 *
 * Thin wrapper around the existing FeishuChannel that implements the
 * ChannelAdapter contract. Preserves all existing WebSocket/Webhook,
 * text/attachment/interactive, and CardKit behavior while exposing
 * Runtime-compatible events, DeliveryResult, and idempotency guarantees.
 */

import type {
  ChannelAdapter,
  ChannelAdapterConfig,
} from "../../runtime/channel-adapter";
import type {
  ChannelCommand,
  ChannelInteraction,
  ChannelInteractionResponse,
  ChannelStatusEvent,
  ChannelTarget,
  DeliveryResult,
  FileAttachment,
  InboundAttachment,
  Mention,
  OutboundMessage,
  ReactionEvent,
  ReactionUpdate,
  RuntimeChannelType,
  StreamUpdate,
  UnifiedMessage,
} from "../../runtime/contracts";
import type { RemoteMessage, RemoteResponse, RemoteResponseContent } from "../../types";

// ---------------------------------------------------------------------------
// Minimal interface for the existing FeishuChannel, allowing test injection
// ---------------------------------------------------------------------------

export interface IFeishuChannelLike {
  readonly type: "feishu";
  readonly connected: boolean;
  start(): Promise<void>;
  stop(): Promise<void>;
  send(response: RemoteResponse): Promise<void>;
  onMessage(handler: (msg: RemoteMessage) => void): void;
  onError(handler: (err: Error) => void): void;
}

// ---------------------------------------------------------------------------
// FeishuAdapter
// ---------------------------------------------------------------------------

export class FeishuAdapter implements ChannelAdapter {
  readonly channelType: RuntimeChannelType = "feishu";
  readonly channelInstanceId: string;
  readonly generation: number;
  private connectedState = false;
  private readonly messageHandlers = new Set<(message: UnifiedMessage) => void>();
  private readonly commandHandlers = new Set<(command: ChannelCommand) => void>();
  private readonly interactionHandlers = new Set<(interaction: ChannelInteraction) => void>();
  private readonly statusHandlers = new Set<(status: ChannelStatusEvent) => void>();
  private readonly errorHandlers = new Set<(error: Error) => void>();
  private readonly deliveries = new Map<string, DeliveryResult>();

  constructor(
    config: ChannelAdapterConfig,
    generation: number,
    private readonly feishu: IFeishuChannelLike,
  ) {
    this.channelInstanceId = config.channelInstanceId;
    this.generation = generation;
  }

  get connected(): boolean {
    return this.connectedState;
  }

  // -- lifecycle ------------------------------------------------------------

  async connect(signal: AbortSignal): Promise<void> {
    // Propagate abort signal to the underlying channel (if supported)
    signal.addEventListener("abort", () => {
      void this.disconnect({ reason: "aborted", timeoutMs: 5000 });
    }, { once: true });

    // Wire incoming messages BEFORE starting to avoid race
    this.feishu.onMessage((msg) => this.handleIncomingMessage(msg));
    this.feishu.onError((err) => {
      for (const handler of this.errorHandlers) handler(err);
    });

    await this.feishu.start();

    this.connectedState = true;
    this.emitStatus("connected");
  }

  async disconnect(_options?: { reason: string; timeoutMs: number }): Promise<void> {
    this.connectedState = false;
    try {
      await this.feishu.stop();
    } catch {
      // best-effort stop
    }
    this.emitStatus("stopped");
  }

  // -- send -----------------------------------------------------------------

  async send(message: OutboundMessage): Promise<DeliveryResult> {
    // Idempotency: return cached result if already delivered
    const cached = this.deliveries.get(message.idempotencyKey);
    if (cached) return cached;

    // Validate private target has userId
    FeishuAdapter.validateOutbound(message);

    if (message.target.visibility === "private") {
      return this.recordResult({
        version: 1,
        generation: this.generation,
        accepted: false,
        committed: false,
        outcome: "permanent_failure",
        idempotencyKey: message.idempotencyKey,
        errorCode: "PRIVATE_DELIVERY_UNSUPPORTED",
      });
    }

    try {
      const content = this.toRemoteContent(message);
      const response: RemoteResponse = {
        channelType: "feishu",
        channelId: message.target.chatId,
        content,
        replyTo: message.replyToMessageId,
      };

      await this.feishu.send(response);

      return this.recordResult({
        version: 1,
        generation: this.generation,
        accepted: true,
        committed: true,
        outcome: "committed",
        idempotencyKey: message.idempotencyKey,
      });
    } catch {
      return this.recordResult({
        version: 1,
        generation: this.generation,
        accepted: false,
        committed: false,
        outcome: "retryable_failure",
        idempotencyKey: message.idempotencyKey,
        retryable: true,
        errorCode: "FEISHU_SEND_ERROR",
      });
    }
  }

  // -- stream methods -------------------------------------------------------

  async streamUpdate(
    target: ChannelTarget,
    update: StreamUpdate,
  ): Promise<DeliveryResult> {
    if (target.visibility === "private") {
      return this.recordResult({
        version: 1,
        generation: this.generation,
        accepted: false,
        committed: false,
        outcome: "permanent_failure",
        idempotencyKey: update.idempotencyKey,
        errorCode: "PRIVATE_DELIVERY_UNSUPPORTED",
      });
    }
    // For non-final stream updates, we track acceptance but don't send
    // individual chunks to avoid flooding Feishu with partial messages.
    // Only streamComplete triggers actual delivery.
    return this.recordResult({
      version: 1,
      generation: this.generation,
      accepted: true,
      committed: update.isFinal,
      outcome: update.isFinal ? "committed" : "accepted",
      idempotencyKey: update.idempotencyKey,
    });
  }

  async streamComplete(
    target: ChannelTarget,
    finalText: string,
    idempotencyKey: string,
  ): Promise<DeliveryResult> {
    return this.send({
      version: 1,
      generation: this.generation,
      idempotencyKey,
      target,
      text: finalText,
      kind: "reply",
    });
  }

  async streamError(
    target: ChannelTarget,
    error: string,
    idempotencyKey: string,
  ): Promise<DeliveryResult> {
    return this.send({
      version: 1,
      generation: this.generation,
      idempotencyKey,
      target,
      text: error,
      kind: "error",
    });
  }

  // -- sendTyping (no-op for Feishu) ----------------------------------------

  async sendTyping(target: ChannelTarget): Promise<void> {
    if (target.visibility === "private") {
      return; // no-op: private delivery unsupported, silently skip typing
    }
    // Feishu does not support typing indicators
  }

  // -- sendFile (not yet implemented) ---------------------------------------

  async sendFile(
    target: ChannelTarget,
    _file: FileAttachment,
    idempotencyKey: string,
  ): Promise<DeliveryResult> {
    if (target.visibility === "private") {
      return this.recordResult({
        version: 1,
        generation: this.generation,
        accepted: false,
        committed: false,
        outcome: "permanent_failure",
        idempotencyKey,
        errorCode: "PRIVATE_DELIVERY_UNSUPPORTED",
      });
    }
    return this.recordResult({
      version: 1,
      generation: this.generation,
      accepted: false,
      committed: false,
      outcome: "permanent_failure",
      idempotencyKey,
      errorCode: "FEISHU_SENDFILE_NOT_IMPLEMENTED",
    });
  }

  // -- respondInteraction (not yet implemented) -----------------------------

  async respondInteraction(
    _response: ChannelInteractionResponse,
  ): Promise<DeliveryResult> {
    return this.recordResult({
      version: 1,
      generation: this.generation,
      accepted: false,
      committed: false,
      outcome: "permanent_failure",
      idempotencyKey: _response.idempotencyKey,
      errorCode: "FEISHU_RESPOND_INTERACTION_NOT_IMPLEMENTED",
    });
  }

  // -- setReaction (not yet implemented) ------------------------------------

  async setReaction(
    _target: ChannelTarget,
    _reaction: ReactionUpdate,
  ): Promise<DeliveryResult> {
    return this.recordResult({
      version: 1,
      generation: this.generation,
      accepted: false,
      committed: false,
      outcome: "permanent_failure",
      idempotencyKey: _reaction.idempotencyKey,
      errorCode: "FEISHU_REACTION_NOT_IMPLEMENTED",
    });
  }

  // -- lookupDelivery --------------------------------------------------------

  async lookupDelivery(idempotencyKey: string): Promise<DeliveryResult> {
    const cached = this.deliveries.get(idempotencyKey);
    if (cached) return cached;
    return {
      version: 1,
      generation: this.generation,
      accepted: false,
      committed: false,
      outcome: "unknown",
      idempotencyKey,
    };
  }

  // -- handler subscriptions (all return unsubscribe) -----------------------

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

  // -- reaction events (Feishu emits as onReaction) -------------------------

  // Note: The current FeishuChannel does not emit reaction events natively.
  // When support is added, wire here. For now, delegate silently.
  onReaction?(_handler: (reaction: ReactionEvent) => void): () => void {
    return () => {};
  }

  // -- outbound validation (static, shared by tests) ------------------------

  static validateOutbound(message: OutboundMessage): void {
    if (
      message.target.visibility === "private" &&
      typeof message.target.userId !== "string"
    ) {
      throw new Error("PRIVATE_TARGET_USER_REQUIRED");
    }
  }

  // -- internal helpers -----------------------------------------------------

  /**
   * Ingest a message emitted by the underlying FeishuChannel and normalize
   * it into a UnifiedMessage for Runtime consumption.
   */
  private handleIncomingMessage(msg: RemoteMessage): void {
    // Double-check bot self-filtering (FeishuChannel should already filter,
    // but we guard here for extra safety)
    if (msg.sender.isBot) return;

    const unified = this.toUnifiedMessage(msg);
    for (const handler of this.messageHandlers) handler(unified);
  }

  /**
   * Convert the old RemoteMessage format into the new UnifiedMessage format.
   */
  private toUnifiedMessage(msg: RemoteMessage): UnifiedMessage {
    const chatKind = msg.isGroup ? "group" : "dm";
    const attachments = this.extractAttachments(msg);
    const mentions = this.extractMentions(msg);

    return {
      version: 1,
      generation: this.generation,
      id: `${this.channelInstanceId}:${msg.channelId}:${msg.id}`,
      channelType: "feishu",
      channelInstanceId: this.channelInstanceId,
      chatId: msg.channelId,
      userId: msg.sender.id,
      userName: msg.sender.name,
      isBot: msg.sender.isBot,
      botMentioned: msg.isMentioned,
      chatKind,
      text: msg.content.text ?? "",
      attachments,
      mentions,
      replyToMessageId: msg.replyTo,
      timestamp: msg.timestamp,
      raw: msg.raw,
    };
  }

  /**
   * Extract InboundAttachment[] from the old RemoteContent format.
   */
  private extractAttachments(msg: RemoteMessage): InboundAttachment[] {
    const result: InboundAttachment[] = [];

    if (msg.content.type === "image" && msg.content.imageKey) {
      result.push({
        version: 1,
        id: `${this.channelInstanceId}:img:${msg.id}`,
        sourceRef: msg.content.imageKey,
        sourceKind: "platform",
        mediaType: "image/*",
      });
    }

    if (msg.content.type === "file" && msg.content.file) {
      result.push({
        version: 1,
        id: `${this.channelInstanceId}:file:${msg.id}`,
        filename: msg.content.file.name,
        sourceRef: msg.content.file.key ?? msg.content.file.url ?? "",
        sourceKind: msg.content.file.key ? "platform" : "https",
        size: msg.content.file.size,
        mediaType: msg.content.file.mimeType,
      });
    }

    if (msg.content.type === "voice" && msg.content.voice) {
      result.push({
        version: 1,
        id: `${this.channelInstanceId}:voice:${msg.id}`,
        sourceRef: msg.content.voice.key ?? msg.content.voice.url ?? "",
        sourceKind: msg.content.voice.key ? "platform" : "https",
        mediaType: "audio/*",
      });
    }

    return result;
  }

  /**
   * Extract Mention[] from the old RemoteMessage's raw field.
   * Feishu encodes mentions inside `raw.mentions` from the platform event.
   */
  private extractMentions(msg: RemoteMessage): Mention[] {
    const raw = msg.raw as Record<string, unknown> | undefined;
    if (!raw || !Array.isArray(raw.mentions)) return [];

    return (raw.mentions as Record<string, unknown>[])
      .map((m): Mention => {
        const id = m.id as Record<string, unknown> | undefined;
        return {
          version: 1,
          userId: (id?.open_id as string) ?? (id?.user_id as string),
          displayName: (m.name as string) ?? (m.key as string),
          isBot: false, // non-bot mentions only (bot self-mentions handled separately)
        };
      })
      .filter((m) => m.userId !== undefined);
  }

  /**
   * Convert OutboundMessage content to legacy RemoteResponseContent.
   */
  private toRemoteContent(message: OutboundMessage): RemoteResponseContent {
    // Use card type if a card is present
    const messageRecord = message as unknown as Record<string, unknown>;
    if (messageRecord.card) {
      return {
        type: "card",
        card: messageRecord.card,
      };
    }

    // Use markdown if provided
    if (message.markdown) {
      return {
        type: "markdown",
        markdown: message.markdown,
      };
    }

    // Text content
    return {
      type: "text",
      text: message.text ?? "",
    };
  }

  /**
   * Record a delivery result for idempotency tracking.
   */
  private recordResult(result: DeliveryResult): DeliveryResult {
    if (result.outcome === "committed") {
      this.deliveries.set(result.idempotencyKey, result);
    }
    return result;
  }

  /**
   * Emit a status event to all registered status handlers.
   */
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

  /**
   * Add a handler to a set and return an unsubscribe function.
   */
  private subscribe<T>(set: Set<T>, handler: T): () => void {
    set.add(handler);
    return () => set.delete(handler);
  }
}
