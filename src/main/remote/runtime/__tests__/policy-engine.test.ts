import { describe, expect, it } from "vitest";
import {
  evaluateCommandPolicy,
  evaluateMessagePolicy,
  evaluatePrivateTarget,
} from "../policy-engine";
import type { UnifiedMessage } from "../contracts";
import type { ChannelPolicyConfig } from "../policy-engine";

const config: ChannelPolicyConfig = {
  enabled: true,
  allowedChatKinds: ["dm", "group", "channel"],
  dmEnabled: true,
  groupEnabled: true,
  channelEnabled: true,
  deniedUsers: [],
  deniedChats: [],
  allowedUsers: [],
  allowedChats: [],
  requireMention: false,
  allowBots: false,
  allowedCommands: [],
};

function message(overrides: Partial<UnifiedMessage> = {}): UnifiedMessage {
  return {
    version: 1,
    generation: 1,
    id: "m1",
    channelType: "telegram",
    channelInstanceId: "telegram-1",
    chatId: "chat-1",
    userId: "user-1",
    chatKind: "dm",
    text: "hello",
    attachments: [],
    mentions: [],
    timestamp: 1,
    ...overrides,
  };
}

describe("channel policy engine", () => {
  it("checks chat kind before allow rules", () => {
    const result = evaluateMessagePolicy(
      message({ chatKind: "group" }),
      { ...config, allowedChatKinds: ["dm"], allowedUsers: ["user-1"] },
    );
    expect(result).toEqual({ allowed: false, reason: "CHAT_KIND_NOT_ALLOWED" });
  });

  it("deny wins over allow", () => {
    const result = evaluateMessagePolicy(
      message(),
      { ...config, allowedUsers: ["user-1"], deniedUsers: ["user-1"] },
    );
    expect(result).toEqual({ allowed: false, reason: "DENIED_USER" });
  });

  it("requires a mention when configured for group messages", () => {
    const result = evaluateMessagePolicy(
      message({ chatKind: "group", mentions: [] }),
      { ...config, requireMention: true },
    );
    expect(result).toEqual({ allowed: false, reason: "MENTION_REQUIRED" });
  });

  it("fails closed for an empty migrated DM allowlist", () => {
    expect(
      evaluateMessagePolicy(message(), {
        ...config,
        dmPolicy: "allowlist",
        dmAllowFrom: [],
      }),
    ).toEqual({ allowed: false, reason: "USER_NOT_ALLOWED" });
  });

  it("preserves per-group chat, user, and mention restrictions", () => {
    const migrated = {
      ...config,
      groupAllowedChats: ["group-1"],
      groupAllowFrom: { "group-1": ["member-1"] },
      groupRequireMention: { "group-1": true },
    };
    expect(
      evaluateMessagePolicy(
        message({
          chatKind: "group",
          chatId: "group-2",
          userId: "member-1",
          botMentioned: true,
        }),
        migrated,
      ),
    ).toEqual({ allowed: false, reason: "CHAT_NOT_ALLOWED" });
    expect(
      evaluateMessagePolicy(
        message({
          chatKind: "group",
          chatId: "group-1",
          userId: "outsider",
          botMentioned: true,
        }),
        migrated,
      ),
    ).toEqual({ allowed: false, reason: "USER_NOT_ALLOWED" });
    expect(
      evaluateMessagePolicy(
        message({
          chatKind: "group",
          chatId: "group-1",
          userId: "member-1",
          botMentioned: false,
        }),
        migrated,
      ),
    ).toEqual({ allowed: false, reason: "MENTION_REQUIRED" });
  });

  it("rejects commands outside the command allowlist", () => {
    const result = evaluateCommandPolicy("compact", { ...config, allowedCommands: ["help"] });
    expect(result).toEqual({ allowed: false, reason: "COMMAND_NOT_ALLOWED" });
  });

  it("requires a matching user for private targets", () => {
    expect(evaluatePrivateTarget("user-2", { userId: "user-1" })).toEqual({
      allowed: false,
      reason: "PRIVATE_TARGET_UNAUTHORIZED",
    });
  });
});
