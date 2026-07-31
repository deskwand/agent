import { describe, expect, it } from "vitest";
import {
  parseChannelTarget,
  parseChannelType,
  parseUnifiedMessage,
} from "../contracts";

describe("channel runtime contracts", () => {
  it("rejects an unknown contract version", () => {
    expect(() => parseUnifiedMessage({ version: 2 })).toThrow(
      "UNSUPPORTED_CHANNEL_SCHEMA",
    );
  });

  it("requires a userId for private targets", () => {
    expect(() =>
      parseChannelTarget({
        version: 1,
        channelType: "telegram",
        channelInstanceId: "telegram-1",
        chatId: "chat-1",
        visibility: "private",
      }),
    ).toThrow("PRIVATE_TARGET_USER_REQUIRED");
  });

  it("preserves bot and mention metadata when parsing a message", () => {
    const parsed = parseUnifiedMessage({
      version: 1,
      generation: 1,
      id: "m1",
      channelType: "telegram",
      channelInstanceId: "telegram-1",
      chatId: "chat-1",
      userId: "user-1",
      isBot: true,
      botMentioned: true,
      chatKind: "group",
      text: "hello",
      attachments: [],
      mentions: [],
      timestamp: 1,
    });
    expect(parsed.isBot).toBe(true);
    expect(parsed.botMentioned).toBe(true);
  });

  it("accepts only the six runtime channel types", () => {
    expect(parseChannelType("telegram")).toBe("telegram");
    expect(() => parseChannelType("dingtalk")).toThrow(
      "UNSUPPORTED_CHANNEL_TYPE",
    );
  });
});
