export type { ChannelPairingEvent } from "../../../shared/ipc-types";

export const CHANNEL_SCHEMA_VERSION = 1 as const;

export type RuntimeChannelType =
  | "feishu"
  | "telegram"
  | "discord"
  | "qq"
  | "slack"
  | "wechat";

const RUNTIME_CHANNEL_TYPES: ReadonlySet<string> = new Set([
  "feishu",
  "telegram",
  "discord",
  "qq",
  "slack",
  "wechat",
]);

export type ChatKind = "dm" | "group" | "channel";
export type MessageVisibility = "chat" | "private";

export type ChannelTarget =
  | {
      version: typeof CHANNEL_SCHEMA_VERSION;
      channelType: RuntimeChannelType;
      channelInstanceId: string;
      chatId: string;
      visibility: "chat";
      userId?: never;
    }
  | {
      version: typeof CHANNEL_SCHEMA_VERSION;
      channelType: RuntimeChannelType;
      channelInstanceId: string;
      chatId: string;
      visibility: "private";
      userId: string;
    };

export interface InboundAttachment {
  version: typeof CHANNEL_SCHEMA_VERSION;
  id: string;
  filename?: string;
  mediaType?: string;
  size?: number;
  sourceRef: string;
  sourceKind: "platform" | "https";
}

export interface Mention {
  version: typeof CHANNEL_SCHEMA_VERSION;
  userId?: string;
  displayName?: string;
  isBot: boolean;
}

export interface UnifiedMessage {
  version: typeof CHANNEL_SCHEMA_VERSION;
  generation: number;
  id: string;
  channelType: RuntimeChannelType;
  channelInstanceId: string;
  chatId: string;
  userId: string;
  userName?: string;
  isBot?: boolean;
  botMentioned?: boolean;
  chatKind: ChatKind;
  text: string;
  attachments: InboundAttachment[];
  mentions: Mention[];
  replyToMessageId?: string;
  timestamp: number;
  raw?: unknown;
}

export interface FileAttachment {
  version: typeof CHANNEL_SCHEMA_VERSION;
  filename: string;
  data: string;
  mediaType: string;
  size: number;
}

export interface OutboundAttachment {
  version: typeof CHANNEL_SCHEMA_VERSION;
  filename: string;
  mediaType: string;
  data?: string;
  path?: string;
  sourceUrl?: string;
}

export interface OutboundMessage {
  version: typeof CHANNEL_SCHEMA_VERSION;
  generation: number;
  idempotencyKey: string;
  target: ChannelTarget;
  text?: string;
  markdown?: string;
  attachments?: OutboundAttachment[];
  replyToMessageId?: string;
  kind: "reply" | "notification" | "interaction" | "error";
}

export interface ChannelCommand {
  version: typeof CHANNEL_SCHEMA_VERSION;
  generation: number;
  id: string;
  name: string;
  args: string[];
  message: UnifiedMessage;
}

export interface ChannelInteraction {
  version: typeof CHANNEL_SCHEMA_VERSION;
  generation: number;
  id: string;
  channelType: RuntimeChannelType;
  channelInstanceId: string;
  userId: string;
  chatId: string;
  messageId: string;
  value: unknown;
  expiresAt: number;
}

export interface ChannelInteractionResponse {
  version: typeof CHANNEL_SCHEMA_VERSION;
  generation: number;
  interactionId: string;
  idempotencyKey: string;
  target: ChannelTarget;
  text?: string;
  card?: unknown;
  acknowledged: boolean;
}

export interface ReactionUpdate {
  version: typeof CHANNEL_SCHEMA_VERSION;
  generation: number;
  idempotencyKey: string;
  messageId: string;
  action: "add" | "remove" | "replace";
  emoji: string;
  userId: string;
}

export interface ReactionEvent {
  version: typeof CHANNEL_SCHEMA_VERSION;
  generation: number;
  id: string;
  channelInstanceId: string;
  chatId: string;
  userId: string;
  messageId: string;
  emoji: string;
  action: "add" | "remove";
}

export interface ChannelStatusEvent {
  version: typeof CHANNEL_SCHEMA_VERSION;
  channelType: RuntimeChannelType;
  channelInstanceId: string;
  generation: number;
  state:
    | "stopped"
    | "starting"
    | "connected"
    | "draining"
    | "reconnecting"
    | "failed"
    | "stopping";
  errorCode?: string;
  retryAt?: number;
  timestamp: number;
}

export interface DeliveryResult {
  version: typeof CHANNEL_SCHEMA_VERSION;
  generation: number;
  accepted: boolean;
  committed: boolean;
  outcome:
    | "committed"
    | "accepted"
    | "retryable_failure"
    | "permanent_failure"
    | "unknown";
  idempotencyKey: string;
  platformMessageId?: string;
  retryable?: boolean;
  errorCode?: string;
}

export interface StreamUpdate {
  version: typeof CHANNEL_SCHEMA_VERSION;
  generation: number;
  streamId: string;
  sequence: number;
  target: ChannelTarget;
  fullText: string;
  idempotencyKey: string;
  isFinal: boolean;
}

export interface AttachmentSource {
  version: typeof CHANNEL_SCHEMA_VERSION;
  generation: number;
  id: string;
  channelInstanceId: string;
  sourceKind: "platform" | "https";
  filename?: string;
  mediaType?: string;
  declaredSize?: number;
  platformRef: string;
  sourceRef: string;
}

export function parseChannelType(value: unknown): RuntimeChannelType {
  if (typeof value === "string" && RUNTIME_CHANNEL_TYPES.has(value)) {
    return value as RuntimeChannelType;
  }
  throw new Error("UNSUPPORTED_CHANNEL_TYPE");
}

export function parseChannelTarget(value: unknown): ChannelTarget {
  if (!isRecord(value) || value.version !== CHANNEL_SCHEMA_VERSION) {
    throw new Error("UNSUPPORTED_CHANNEL_SCHEMA");
  }

  const channelType = parseChannelType(value.channelType);
  const channelInstanceId = requireString(value.channelInstanceId);
  const chatId = requireString(value.chatId);

  if (value.visibility === "private") {
    if (typeof value.userId !== "string" || value.userId.length === 0) {
      throw new Error("PRIVATE_TARGET_USER_REQUIRED");
    }
    return {
      version: CHANNEL_SCHEMA_VERSION,
      channelType,
      channelInstanceId,
      chatId,
      visibility: "private",
      userId: value.userId,
    };
  }

  if (value.visibility !== "chat" || value.userId !== undefined) {
    throw new Error("INVALID_CHANNEL_TARGET");
  }

  return {
    version: CHANNEL_SCHEMA_VERSION,
    channelType,
    channelInstanceId,
    chatId,
    visibility: "chat",
  };
}

export function parseUnifiedMessage(value: unknown): UnifiedMessage {
  if (!isRecord(value) || value.version !== CHANNEL_SCHEMA_VERSION) {
    throw new Error("UNSUPPORTED_CHANNEL_SCHEMA");
  }

  const message = value;
  const chatKind = message.chatKind;
  if (chatKind !== "dm" && chatKind !== "group" && chatKind !== "channel") {
    throw new Error("INVALID_UNIFIED_MESSAGE");
  }

  if (!Array.isArray(message.attachments) || !Array.isArray(message.mentions)) {
    throw new Error("INVALID_UNIFIED_MESSAGE");
  }

  return {
    version: CHANNEL_SCHEMA_VERSION,
    generation: requireNumber(message.generation),
    id: requireString(message.id),
    channelType: parseChannelType(message.channelType),
    channelInstanceId: requireString(message.channelInstanceId),
    chatId: requireString(message.chatId),
    userId: requireString(message.userId),
    userName: optionalString(message.userName),
    isBot: message.isBot === undefined ? undefined : Boolean(message.isBot),
    botMentioned:
      message.botMentioned === undefined
        ? undefined
        : Boolean(message.botMentioned),
    chatKind,
    text: requireString(message.text),
    attachments: message.attachments as InboundAttachment[],
    mentions: message.mentions as Mention[],
    replyToMessageId: optionalString(message.replyToMessageId),
    timestamp: requireNumber(message.timestamp),
    raw: message.raw,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requireString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("INVALID_CHANNEL_CONTRACT");
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return value === undefined ? undefined : requireString(value);
}

function requireNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("INVALID_CHANNEL_CONTRACT");
  }
  return value;
}
