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
import * as crypto from "crypto";

// ---------------------------------------------------------------------------
// Injected API surface (clean boundary – no direct @slack import)
// ---------------------------------------------------------------------------
export interface SlackWebClientLike {
  chat: {
    postMessage(args: {
      channel: string;
      text: string;
      thread_ts?: string;
      mrkdwn?: boolean;
    }): Promise<{ ts?: string; channel?: string }>;
  };
  auth: {
    test(): Promise<{ user_id?: string }>;
  };
}

// ---------------------------------------------------------------------------
// Slack event shape (what Socket Mode / Events API delivers)
// ---------------------------------------------------------------------------
export interface SlackEventSource {
  start(handler: (event: SlackMessageEvent) => void): Promise<void>;
  stop(): Promise<void>;
}

export interface SlackMessageEvent {
  type?: string;
  user?: string;
  text?: string;
  channel?: string;
  ts?: string;
  thread_ts?: string;
  bot_id?: string;
  subtype?: string;
  bot_profile?: unknown;
}

// ---------------------------------------------------------------------------
// Text splitting (4000-char chunks)
// ---------------------------------------------------------------------------
const SLACK_CHUNK_SIZE = 4000;

export function splitSlackText(text: string): string[] {
  if (text.length <= SLACK_CHUNK_SIZE) return [text];
  const parts: string[] = [];
  for (let offset = 0; offset < text.length; offset += SLACK_CHUNK_SIZE) {
    parts.push(text.slice(offset, offset + SLACK_CHUNK_SIZE));
  }
  return parts;
}

// ---------------------------------------------------------------------------
// Deterministic signature-verification helper
// ---------------------------------------------------------------------------
const DEFAULT_TOLERANCE_SECONDS = 300;

export function verifySlackSignature(
  body: string,
  timestamp: string,
  signature: string,
  signingSecret: string,
  toleranceSeconds: number = DEFAULT_TOLERANCE_SECONDS,
): boolean {
  if (!signingSecret || !timestamp || !signature) return false;

  const ts = parseInt(timestamp, 10);
  if (!Number.isFinite(ts)) return false;

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > toleranceSeconds) return false;

  const sigBase = `v0:${timestamp}:${body}`;
  const computed = `v0=${crypto.createHmac("sha256", signingSecret).update(sigBase).digest("hex")}`;

  try {
    const sigBuf = Buffer.from(signature);
    const computedBuf = Buffer.from(computed);
    if (sigBuf.length !== computedBuf.length) return false;
    return crypto.timingSafeEqual(sigBuf, computedBuf);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// SlackRuntimeChannel – ChannelAdapter for Slack
// ---------------------------------------------------------------------------
export class SlackRuntimeChannel implements ChannelAdapter {
  readonly channelType = "slack" as const;
  readonly channelInstanceId: string;
  readonly generation: number;

  private connectedState = false;
  private botUserId: string | undefined;

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
  private readonly deliveries = new Map<string, DeliveryResult>();

  constructor(
    _config: ChannelAdapterConfig,
    generation: number,
    private readonly client: SlackWebClientLike,
    private readonly eventSource?: SlackEventSource,
  ) {
    this.channelInstanceId = _config.channelInstanceId;
    this.generation = generation;
  }

  // -----------------------------------------------------------------------
  // lifecycle
  // -----------------------------------------------------------------------
  get connected(): boolean {
    return this.connectedState;
  }

  async connect(_signal?: AbortSignal): Promise<void> {
    const auth = await this.client.auth.test();
    this.botUserId = auth.user_id;
    if (this.eventSource) {
      await this.eventSource.start((event) => this.handleSlackEvent(event));
    }
    this.connectedState = true;
    this.emitStatus("connected");
  }

  async disconnect(_options?: {
    reason: string;
    timeoutMs: number;
  }): Promise<void> {
    await this.eventSource?.stop();
    this.connectedState = false;
    this.emitStatus("stopped");
  }

  // -----------------------------------------------------------------------
  // send (with idempotency + 4000-char splitting)
  // -----------------------------------------------------------------------
  async send(message: OutboundMessage): Promise<DeliveryResult> {
    const cached = this.deliveries.get(message.idempotencyKey);
    if (cached) return cached;

    if (message.target.visibility === "private") {
      return this.failure(message.idempotencyKey, "PRIVATE_DELIVERY_UNSUPPORTED");
    }

    const text = message.text ?? message.markdown;
    if (!text) {
      return this.failure(message.idempotencyKey, "SLACK_EMPTY_MESSAGE");
    }

    const [channel, threadTs] = message.target.chatId.split(":");

    let platformMessageId: string | undefined;
    for (const chunk of splitSlackText(text)) {
      const sent = await this.client.chat.postMessage({
        channel,
        text: chunk,
        thread_ts: threadTs,
        mrkdwn: true,
      });
      platformMessageId = sent.ts ?? platformMessageId;
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

  // -----------------------------------------------------------------------
  // streamUpdate (delegates to send)
  // -----------------------------------------------------------------------
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

  // -----------------------------------------------------------------------
  // event subscriptions
  // -----------------------------------------------------------------------
  onMessage(handler: (message: UnifiedMessage) => void): () => void {
    return this.subscribe(this.messageHandlers, handler);
  }

  onCommand(handler: (command: ChannelCommand) => void): () => void {
    return this.subscribe(this.commandHandlers, handler);
  }

  onInteraction(
    handler: (interaction: ChannelInteraction) => void,
  ): () => void {
    return this.subscribe(this.interactionHandlers, handler);
  }

  onStatus(handler: (status: ChannelStatusEvent) => void): () => void {
    return this.subscribe(this.statusHandlers, handler);
  }

  onError(handler: (error: Error) => void): () => void {
    return this.subscribe(this.errorHandlers, handler);
  }

  // -----------------------------------------------------------------------
  // handleSlackEvent – normalise incoming Slack event → UnifiedMessage
  // -----------------------------------------------------------------------
  handleSlackEvent(event: SlackMessageEvent): void {
    // Reject bot messages
    if (event.bot_id || event.subtype === "bot_message") return;
    if (event.user === this.botUserId) return;

    if (!event.user || !event.channel || !event.ts) return;

    const chatKind: "dm" | "channel" = event.channel.startsWith("D")
      ? "dm"
      : "channel";
    const chatId = event.thread_ts
      ? `${event.channel}:${event.thread_ts}`
      : event.channel;

    const message = normalizeMessage({
      version: 1,
      generation: this.generation,
      id: `${this.channelInstanceId}:${event.ts}`,
      channelType: "slack",
      channelInstanceId: this.channelInstanceId,
      chatId,
      userId: event.user,
      isBot: false,
      chatKind,
      text: event.text ?? "",
      attachments: [],
      mentions: [],
      timestamp: Math.floor(parseFloat(event.ts) * 1000),
      botUserId: this.botUserId,
    });

    for (const handler of this.messageHandlers) {
      handler(message);
    }
  }

  // -----------------------------------------------------------------------
  // internal helpers
  // -----------------------------------------------------------------------
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
    for (const handler of this.statusHandlers) {
      handler(status);
    }
  }

  private subscribe<T>(set: Set<T>, handler: T): () => void {
    set.add(handler);
    return () => {
      set.delete(handler);
    };
  }
}
