import type { ChannelAdapter, ChannelAdapterConfig } from "../../runtime/channel-adapter";
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
import type { QqApiLike, QqEvent, QqGatewayLike } from "./qq-gateway";
export type { QqApiLike, QqEvent, QqGatewayLike } from "./qq-gateway";

export const PASSIVE_REPLY_WINDOW_MS = 3 * 60 * 1000;

function resolveSendTarget(target: ChannelTarget): string {
  return target.visibility === "private" ? target.userId : target.chatId;
}

function isGateway(api: QqApiLike | QqGatewayLike): api is QqGatewayLike {
  return "connect" in api && "disconnect" in api;
}

export class QqChannel implements ChannelAdapter {
  readonly channelType = "qq" as const;
  readonly channelInstanceId: string;
  readonly generation: number;
  private connectedState = false;
  private readonly inboundAt = new Map<string, number>();
  private readonly sequences = new Map<string, number>();
  private readonly messageHandlers = new Set<(message: UnifiedMessage) => void>();
  private readonly commandHandlers = new Set<(command: ChannelCommand) => void>();
  private readonly interactionHandlers = new Set<(interaction: ChannelInteraction) => void>();
  private readonly statusHandlers = new Set<(status: ChannelStatusEvent) => void>();
  private readonly errorHandlers = new Set<(error: Error) => void>();
  private readonly deliveries = new Map<string, DeliveryResult>();
  private gatewayCleanup: (() => void) | null = null;

  constructor(
    _config: ChannelAdapterConfig,
    generation: number,
    private readonly api: QqApiLike | QqGatewayLike,
  ) {
    this.channelInstanceId = _config.channelInstanceId;
    this.generation = generation;
  }

  get connected(): boolean {
    return this.connectedState;
  }

  async connect(signal?: AbortSignal): Promise<void> {
    const effectiveSignal = signal ?? new AbortController().signal;

    if (isGateway(this.api)) {
      // Bind gateway event handlers before connecting
      this.gatewayCleanup = this.api.onEvent((event: QqEvent) => {
        this.handleEvent(event);
      });

      const unsubError = this.api.onGatewayError((err: Error) => {
        for (const handler of this.errorHandlers) handler(err);
      });

      try {
        await this.api.connect(effectiveSignal);
        this.connectedState = true;
        this.emitStatus("connected");
      } catch (err) {
        this.gatewayCleanup?.();
        this.gatewayCleanup = null;
        unsubError();
        throw err;
      }
    } else {
      // Bare QqApiLike (test-only path)
      this.connectedState = true;
      this.emitStatus("connected");
    }
  }

  async disconnect(): Promise<void> {
    if (isGateway(this.api)) {
      await this.api.disconnect();
    }
    this.gatewayCleanup?.();
    this.gatewayCleanup = null;
    this.connectedState = false;
    this.emitStatus("stopped");
  }

  async send(message: OutboundMessage): Promise<DeliveryResult> {
    const existing = this.deliveries.get(message.idempotencyKey);
    if (existing) return existing;
    if (!message.text) return this.failure(message.idempotencyKey, "QQ_EMPTY_MESSAGE");
    const sent = await this.api.sendMessage(resolveSendTarget(message.target), message.text);
    const result: DeliveryResult = {
      version: 1,
      generation: message.generation,
      accepted: true,
      committed: true,
      outcome: "committed",
      idempotencyKey: message.idempotencyKey,
      platformMessageId: sent.id,
    };
    this.deliveries.set(message.idempotencyKey, result);
    return result;
  }

  streamUpdate(target: ChannelTarget, update: StreamUpdate): Promise<DeliveryResult> {
    return this.send({
      version: 1,
      generation: update.generation,
      idempotencyKey: update.idempotencyKey,
      target,
      text: update.fullText,
      kind: "reply",
    });
  }

  onMessage(handler: (message: UnifiedMessage) => void): () => void { return this.subscribe(this.messageHandlers, handler); }
  onCommand(handler: (command: ChannelCommand) => void): () => void { return this.subscribe(this.commandHandlers, handler); }
  onInteraction(handler: (interaction: ChannelInteraction) => void): () => void { return this.subscribe(this.interactionHandlers, handler); }
  onStatus(handler: (status: ChannelStatusEvent) => void): () => void { return this.subscribe(this.statusHandlers, handler); }
  onError(handler: (error: Error) => void): () => void { return this.subscribe(this.errorHandlers, handler); }

  handleEvent(event: QqEvent): void {
    if (event.author.bot) return;
    this.recordInbound(event.id, Date.now());
    const chatKind = event.chat_type === "c2c" ? "dm" : event.chat_type === "group" ? "group" : "channel";
    const chatId = event.group_id ?? event.channel_id ?? event.author.id;
    const message = normalizeMessage({
      version: 1,
      generation: this.generation,
      id: `${this.channelInstanceId}:${event.id}`,
      channelType: "qq",
      channelInstanceId: this.channelInstanceId,
      chatId,
      userId: event.author.id,
      userName: event.author.username,
      isBot: event.author.bot,
      chatKind,
      text: event.content,
      attachments: [],
      mentions: [],
      timestamp: Date.now(),
    });
    for (const handler of this.messageHandlers) handler(message);
  }

  recordInbound(eventId: string, timestamp: number): void {
    this.inboundAt.set(eventId, timestamp);
    this.sequences.set(eventId, 0);
  }

  canReplyPassively(eventId: string, now: number): boolean {
    const receivedAt = this.inboundAt.get(eventId);
    return receivedAt !== undefined && now - receivedAt < PASSIVE_REPLY_WINDOW_MS;
  }

  nextMessageSequence(eventId: string): number {
    const next = (this.sequences.get(eventId) ?? 0) + 1;
    this.sequences.set(eventId, next);
    return next;
  }

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
}
