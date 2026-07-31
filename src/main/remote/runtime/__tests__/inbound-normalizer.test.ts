import { describe, expect, it } from "vitest";
import { normalizeMessage } from "../inbound-normalizer";

describe("inbound normalizer", () => {
  it("does not treat an unrelated bot mention as the channel bot", () => {
    const message = normalizeMessage({
      version: 1,
      generation: 1,
      id: "m1",
      channelType: "telegram",
      channelInstanceId: "telegram-1",
      chatId: "group-1",
      userId: "user-1",
      chatKind: "group",
      text: "@other hello",
      mentions: [
        { version: 1, userId: "other-bot", displayName: "other", isBot: true },
      ],
      attachments: [],
      timestamp: 1,
    });

    expect(message.text).toBe("@other hello");
    expect(message.botMentioned).toBe(false);
  });

  it("removes only the bot mention from group text", () => {
    const message = normalizeMessage({
      version: 1,
      generation: 1,
      id: "m1",
      channelType: "telegram",
      channelInstanceId: "telegram-1",
      chatId: "group-1",
      userId: "user-1",
      chatKind: "group",
      text: "@deskwand hello @other",
      botUserId: "bot-1",
      mentions: [
        { version: 1, userId: "bot-1", displayName: "deskwand", isBot: true },
        { version: 1, userId: "user-2", displayName: "other", isBot: false },
      ],
      attachments: [],
      timestamp: 1,
    });

    expect(message.text).toBe("hello @other");
    expect(message.mentions).toHaveLength(1);
    expect(message.mentions[0]?.userId).toBe("user-2");
  });
});
