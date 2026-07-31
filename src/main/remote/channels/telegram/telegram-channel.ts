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
  FileAttachment,
  OutboundMessage,
  ReactionUpdate,
  StreamUpdate,
  UnifiedMessage,
} from "../../runtime/contracts";
import { normalizeMessage } from "../../runtime/inbound-normalizer";
import {
  TelegramApi,
  type TelegramApiLike,
  type TelegramSentMessage,
  type TelegramUpdate,
} from "./telegram-api";

function resolveSendTarget(target: ChannelTarget): string {
  return target.visibility === "private" ? target.userId : target.chatId;
}

export class TelegramChannel implements ChannelAdapter {
  readonly channelType = "telegram" as const;
  readonly channelInstanceId: string;
  readonly generation: number;
  private connectedState = false;
  private botUserId: string | undefined;
  private readonly messageHandlers = new Set<(message: UnifiedMessage) => void>();
  private readonly commandHandlers = new Set<(command: ChannelCommand) => void>();
  private readonly interactionHandlers = new Set<(interaction: ChannelInteraction) => void>();
  private readonly statusHandlers = new Set<(status: ChannelStatusEvent) => void>();
  private readonly errorHandlers = new Set<(error: Error) => void>();
  private readonly deliveries = new Map<string, DeliveryResult>();
  private pollAbortController: AbortController | null = null;
  private pollPromise: Promise<void> | null = null;
  private nextUpdateId: number | undefined;

  constructor(
    config: ChannelAdapterConfig,
    generation: number,
    private readonly api: TelegramApiLike = new TelegramApi(String(config.settings.botToken)),
  ) {
    this.channelInstanceId = config.channelInstanceId;
    this.generation = generation;
  }

  get connected(): boolean {
    return this.connectedState;
  }

  async connect(signal: AbortSignal): Promise<void> {
    const bot = await this.api.getMe(signal);
    this.botUserId = String(bot.id);
    this.connectedState = true;
    this.emitStatus("connected");
    if (this.api.getUpdates) {
      this.pollAbortController = new AbortController();
      signal.addEventListener(
        "abort",
        () => this.pollAbortController?.abort(),
        { once: true },
      );
      this.pollPromise = this.pollLoop(this.pollAbortController.signal);
    }
  }

  async disconnect(): Promise<void> {
    this.connectedState = false;
    this.pollAbortController?.abort();
    await this.pollPromise;
    this.pollPromise = null;
    this.pollAbortController = null;
    this.emitStatus("stopped");
  }

  async send(message: OutboundMessage): Promise<DeliveryResult> {
    const existing = this.deliveries.get(message.idempotencyKey);
    if (existing) return existing;
    if (message.text === undefined && !message.attachments?.length) {
      return this.recordFailure(message.idempotencyKey, "TELEGRAM_EMPTY_MESSAGE");
    }

    let last: TelegramSentMessage | undefined;
    const recipient = resolveSendTarget(message.target);
    if (message.text !== undefined) {
      for (const part of splitTelegramText(message.text)) {
        last = await this.api.sendMessage(
          recipient,
          part,
          message.replyToMessageId,
        );
      }
    }
    if (message.attachments) {
      for (const attachment of message.attachments) {
        if (!attachment.data) {
          return this.recordFailure(
            message.idempotencyKey,
            "TELEGRAM_ATTACHMENT_SOURCE_UNSUPPORTED",
          );
        }
        last = await this.api.sendDocument(
          recipient,
          attachment.filename,
          Buffer.from(attachment.data, "base64"),
          attachment.mediaType,
        );
      }
    }

    const result = this.recordSuccess(
      message.idempotencyKey,
      last?.message_id,
      message.generation,
    );
    return result;
  }

  async sendFile(
    target: ChannelTarget,
    file: FileAttachment,
    idempotencyKey: string,
  ): Promise<DeliveryResult> {
    const sent = await this.api.sendDocument(
      resolveSendTarget(target),
      file.filename,
      Buffer.from(file.data, "base64"),
      file.mediaType,
    );
    return this.recordSuccess(idempotencyKey, sent.message_id, this.generation);
  }

  async sendTyping(target: ChannelTarget): Promise<void> {
    await this.api.sendChatAction(resolveSendTarget(target), "typing");
  }

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

  setReaction(
    _target: ChannelTarget,
    _reaction: ReactionUpdate,
  ): Promise<DeliveryResult> {
    return Promise.resolve(
      this.recordFailure("reaction", "TELEGRAM_REACTION_UNSUPPORTED"),
    );
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

  private async pollLoop(signal: AbortSignal): Promise<void> {
    while (this.connectedState && !signal.aborted) {
      try {
        const updates = await this.api.getUpdates?.(
          this.nextUpdateId,
          25,
          signal,
        );
        for (const update of updates ?? []) {
          this.nextUpdateId = update.update_id + 1;
          this.handleUpdate(update);
        }
      } catch (error) {
        if (signal.aborted || !this.connectedState) return;
        for (const handler of this.errorHandlers) {
          handler(error instanceof Error ? error : new Error(String(error)));
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 1_000));
      }
    }
  }

  handleUpdate(update: TelegramUpdate): void {
    const incoming = update.message;
    if (!incoming || !incoming.from || incoming.from.is_bot) return;
    const chatKind = incoming.chat.type === "private"
      ? "dm"
      : incoming.chat.type === "channel"
        ? "channel"
        : "group";
    const text = incoming.text ?? "";
    const normalized = normalizeMessage({
      version: 1,
      generation: this.generation,
      id: `${this.channelInstanceId}:${incoming.chat.id}:${incoming.message_id}`,
      channelType: "telegram",
      channelInstanceId: this.channelInstanceId,
      chatId: String(incoming.chat.id),
      userId: String(incoming.from.id),
      userName: incoming.from.username ?? incoming.from.first_name,
      isBot: incoming.from.is_bot,
      chatKind,
      text,
      attachments: [],
      mentions: [],
      timestamp: incoming.date * 1000,
      botUserId: this.botUserId,
    });

    // Centralized command parsing is owned by ConnectionManager.
    // Emit only through messageHandlers; ConnectionManager dispatches
    // "/command" text to onCommand.
    for (const handler of this.messageHandlers) handler(normalized);
  }

  private recordSuccess(
    idempotencyKey: string,
    messageId: number | undefined,
    generation: number,
  ): DeliveryResult {
    const result: DeliveryResult = {
      version: 1,
      generation,
      accepted: true,
      committed: true,
      outcome: "committed",
      idempotencyKey,
      platformMessageId: messageId === undefined ? undefined : String(messageId),
    };
    this.deliveries.set(idempotencyKey, result);
    return result;
  }

  private recordFailure(idempotencyKey: string, errorCode: string): DeliveryResult {
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

export function splitTelegramText(text: string): string[] {
  if (text.length <= 4096) return [text];
  const parts: string[] = [];
  for (let offset = 0; offset < text.length; offset += 4096) {
    parts.push(text.slice(offset, offset + 4096));
  }
  return parts;
}
