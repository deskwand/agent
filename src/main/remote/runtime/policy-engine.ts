import type { ChatKind, UnifiedMessage } from "./contracts";

export interface ChannelPolicyConfig {
  enabled: boolean;
  allowedChatKinds: ChatKind[];
  dmEnabled: boolean;
  groupEnabled: boolean;
  channelEnabled: boolean;
  deniedUsers: string[];
  deniedChats: string[];
  allowedUsers: string[];
  allowedChats: string[];
  requireMention: boolean;
  allowBots: boolean;
  allowedCommands: string[];
  /** DM authorization preserved from channel-specific legacy policy. */
  dmPolicy?: "open" | "allowlist" | "deny";
  dmAllowFrom?: string[];
  /** When defined, group/channel messages are limited to these chat IDs. */
  groupAllowedChats?: string[];
  /** Optional per-group requireMention overrides (chatId -> bool).  */
  groupRequireMention?: Record<string, boolean>;
  /** Optional per-group allowFrom overrides (chatId -> userId[]).  */
  groupAllowFrom?: Record<string, string[]>;
  /** Default requireMention for groups not listed in groupRequireMention.  */
  defaultRequireMention?: boolean;
}

export type PolicyDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason:
        | "CHANNEL_DISABLED"
        | "CHAT_KIND_NOT_ALLOWED"
        | "DENIED_USER"
        | "DENIED_CHAT"
        | "USER_NOT_ALLOWED"
        | "CHAT_NOT_ALLOWED"
        | "BOT_MESSAGE_NOT_ALLOWED"
        | "MENTION_REQUIRED";
    };

export type PrivateTargetDecision =
  | { allowed: true }
  | { allowed: false; reason: "PRIVATE_TARGET_UNAUTHORIZED" };

export type CommandPolicyDecision =
  | { allowed: true }
  | { allowed: false; reason: "COMMAND_NOT_ALLOWED" };

export function evaluateMessagePolicy(
  message: UnifiedMessage,
  config: ChannelPolicyConfig,
): PolicyDecision {
  if (!config.enabled) {
    return { allowed: false, reason: "CHANNEL_DISABLED" };
  }
  if (!config.allowedChatKinds.includes(message.chatKind)) {
    return { allowed: false, reason: "CHAT_KIND_NOT_ALLOWED" };
  }
  if (!isChatKindEnabled(message.chatKind, config)) {
    return { allowed: false, reason: "CHAT_KIND_NOT_ALLOWED" };
  }
  if (message.chatKind === "dm") {
    if (config.dmPolicy === "deny") {
      return { allowed: false, reason: "CHAT_KIND_NOT_ALLOWED" };
    }
    if (
      config.dmPolicy === "allowlist" &&
      !(config.dmAllowFrom ?? []).includes(message.userId)
    ) {
      return { allowed: false, reason: "USER_NOT_ALLOWED" };
    }
  }
  if (
    message.chatKind !== "dm" &&
    config.groupAllowedChats !== undefined &&
    !config.groupAllowedChats.includes(message.chatId)
  ) {
    return { allowed: false, reason: "CHAT_NOT_ALLOWED" };
  }
  if (config.deniedUsers.includes(message.userId)) {
    return { allowed: false, reason: "DENIED_USER" };
  }
  if (config.deniedChats.includes(message.chatId)) {
    return { allowed: false, reason: "DENIED_CHAT" };
  }
  if (
    config.allowedUsers.length > 0 &&
    !config.allowedUsers.includes(message.userId)
  ) {
    return { allowed: false, reason: "USER_NOT_ALLOWED" };
  }
  if (
    config.allowedChats.length > 0 &&
    !config.allowedChats.includes(message.chatId)
  ) {
    return { allowed: false, reason: "CHAT_NOT_ALLOWED" };
  }
  // Per-group allowFrom: if this chat has an explicit allowFrom list,
  // check the sender against it.
  const perGroupAllowFrom =
    config.groupAllowFrom?.[message.chatId];
  if (
    perGroupAllowFrom &&
    perGroupAllowFrom.length > 0 &&
    !perGroupAllowFrom.includes(message.userId)
  ) {
    return { allowed: false, reason: "USER_NOT_ALLOWED" };
  }
  if (message.isBot && !config.allowBots) {
    return { allowed: false, reason: "BOT_MESSAGE_NOT_ALLOWED" };
  }
  if (
    config.requireMention &&
    (message.chatKind === "group" || message.chatKind === "channel") &&
    !message.botMentioned
  ) {
    return { allowed: false, reason: "MENTION_REQUIRED" };
  }
  // Per-group requireMention: explicit override per chatId wins;
  // defaultRequireMention applies when not overridden.
  if (message.chatKind === "group" || message.chatKind === "channel") {
    const perChatMention = config.groupRequireMention?.[message.chatId];
    const mentionRequired =
      perChatMention !== undefined
        ? perChatMention
        : (config.defaultRequireMention ?? false);
    if (mentionRequired && !message.botMentioned) {
      return { allowed: false, reason: "MENTION_REQUIRED" };
    }
  }
  return { allowed: true };
}

export function evaluateCommandPolicy(
  commandName: string,
  config: ChannelPolicyConfig,
): CommandPolicyDecision {
  return config.allowedCommands.length === 0 || config.allowedCommands.includes(commandName)
    ? { allowed: true }
    : { allowed: false, reason: "COMMAND_NOT_ALLOWED" };
}

export function evaluatePrivateTarget(
  targetUserId: string,
  authorization: { userId?: string },
): PrivateTargetDecision {
  return authorization.userId === targetUserId
    ? { allowed: true }
    : { allowed: false, reason: "PRIVATE_TARGET_UNAUTHORIZED" };
}

function isChatKindEnabled(
  chatKind: ChatKind,
  config: ChannelPolicyConfig,
): boolean {
  if (chatKind === "dm") return config.dmEnabled;
  if (chatKind === "group") return config.groupEnabled;
  return config.channelEnabled;
}
