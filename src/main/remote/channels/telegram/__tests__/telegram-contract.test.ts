import { describe, expect, it, vi } from "vitest";
import { TelegramChannel, splitTelegramText } from "../telegram-channel";
import type { OutboundMessage } from "../../../runtime/contracts";

const api = {
  getMe: vi.fn(async () => ({ id: 99, username: "deskwand_bot" })),
  sendMessage: vi.fn(async () => ({ message_id: 7 })),
  sendDocument: vi.fn(async () => ({ message_id: 8 })),
  sendChatAction: vi.fn(async () => undefined),
};

describe("telegram channel", () => {
  it("splits text at Telegram's 4096 character limit", () => {
    const parts = splitTelegramText("a".repeat(4097));
    expect(parts).toHaveLength(2);
    expect(parts.every((part) => part.length <= 4096)).toBe(true);
  });

  it("normalizes a Telegram text update", () => {
    const channel = new TelegramChannel(
      {
        channelType: "telegram",
        channelInstanceId: "telegram-1",
        agentId: "agent-1",
        settings: { botToken: "token" },
      },
      1,
      api,
    );
    const handler = vi.fn();
    channel.onMessage(handler);

    channel.handleUpdate({
      update_id: 1,
      message: {
        message_id: 2,
        date: 1,
        chat: { id: 10, type: "private" },
        from: { id: 20, first_name: "User", is_bot: false },
        text: "hello",
      },
    });

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "telegram-1:10:2",
        chatKind: "dm",
        userId: "20",
        text: "hello",
      }),
    );
  });

  it("polls updates and advances the offset until disconnect", async () => {
    const pollingApi = {
      ...api,
      getUpdates: vi
        .fn()
        .mockResolvedValueOnce([
          {
            update_id: 4,
            message: {
              message_id: 5,
              date: 1,
              chat: { id: 10, type: "private" as const },
              from: { id: 20, is_bot: false },
              text: "polled",
            },
          },
        ])
        .mockImplementation(
          async (_offset: number | undefined, _timeout: number, signal?: AbortSignal) =>
            new Promise<never>((_resolve, reject) => {
              signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
            }),
        ),
    };
    const channel = new TelegramChannel(
      {
        channelType: "telegram",
        channelInstanceId: "telegram-1",
        agentId: "agent-1",
        settings: { botToken: "token" },
      },
      1,
      pollingApi,
    );
    const handler = vi.fn();
    channel.onMessage(handler);

    await channel.connect(new AbortController().signal);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await channel.disconnect();

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ text: "polled" }));
    expect(pollingApi.getUpdates).toHaveBeenCalledWith(5, 25, expect.any(AbortSignal));
  });

  it("routes private target to userId, not chatId", async () => {
    const channel = new TelegramChannel(
      {
        channelType: "telegram",
        channelInstanceId: "telegram-1",
        agentId: "agent-1",
        settings: { botToken: "token" },
      },
      1,
      api,
    );
    const message: OutboundMessage = {
      version: 1,
      generation: 1,
      idempotencyKey: "private-send",
      target: {
        version: 1,
        channelType: "telegram",
        channelInstanceId: "telegram-1",
        chatId: "group-10",
        visibility: "private",
        userId: "user-20",
      },
      text: "private hello",
      kind: "notification",
    };

    await channel.send(message);

    expect(api.sendMessage).toHaveBeenCalledWith(
      "user-20",
      "private hello",
      undefined,
    );
  });

  it("routes private sendTyping to userId", async () => {
    const channel = new TelegramChannel(
      {
        channelType: "telegram",
        channelInstanceId: "telegram-1",
        agentId: "agent-1",
        settings: { botToken: "token" },
      },
      1,
      api,
    );
    await channel.sendTyping({
      version: 1,
      channelType: "telegram",
      channelInstanceId: "telegram-1",
      chatId: "group-10",
      visibility: "private",
      userId: "user-99",
    });

    expect(api.sendChatAction).toHaveBeenCalledWith("user-99", "typing");
  });

  it("sends chat target to chatId as before", async () => {
    const channel = new TelegramChannel(
      {
        channelType: "telegram",
        channelInstanceId: "telegram-1",
        agentId: "agent-1",
        settings: { botToken: "token" },
      },
      1,
      api,
    );
    const message: OutboundMessage = {
      version: 1,
      generation: 1,
      idempotencyKey: "chat-send",
      target: {
        version: 1,
        channelType: "telegram",
        channelInstanceId: "telegram-1",
        chatId: "group-10",
        visibility: "chat",
      },
      text: "group hello",
      kind: "reply",
    };

    await channel.send(message);

    expect(api.sendMessage).toHaveBeenCalledWith(
      "group-10",
      "group hello",
      undefined,
    );
  });

  it("returns a committed result for a text send", async () => {
    const channel = new TelegramChannel(
      {
        channelType: "telegram",
        channelInstanceId: "telegram-1",
        agentId: "agent-1",
        settings: { botToken: "token" },
      },
      1,
      api,
    );
    const message: OutboundMessage = {
      version: 1,
      generation: 1,
      idempotencyKey: "reply-1",
      target: {
        version: 1,
        channelType: "telegram",
        channelInstanceId: "telegram-1",
        chatId: "10",
        visibility: "chat",
      },
      text: "hello",
      kind: "reply",
    };

    await expect(channel.send(message)).resolves.toMatchObject({
      outcome: "committed",
      idempotencyKey: "reply-1",
      platformMessageId: "7",
    });
  });
});
