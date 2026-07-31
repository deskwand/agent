/**
 * Group-private visibility gate tests for NotificationRouter.
 *
 * Proves:
 *  - Private visibility authorization sends only to target userId
 *  - Private visibility rejects wrong user
 *  - Chat visibility authorization is separate from private
 *  - Persistence restart preserves private authorizations
 *  - Revoked authorizations deny delivery
 *  - Expired authorizations deny delivery
 */

import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotificationRouter } from "../notification-router";
import { ChannelRuntimePersistence } from "../persistence";
import type { ChannelAdapter } from "../channel-adapter";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createAdapter(
  overrides: Partial<ChannelAdapter> = {},
): ChannelAdapter {
  return {
    channelType: "telegram",
    generation: 1,
    channelInstanceId: "telegram-1",
    connected: true,
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    send: vi.fn(async (message) => ({
      version: 1 as const,
      generation: message.generation,
      accepted: true,
      committed: true,
      outcome: "committed" as const,
      idempotencyKey: message.idempotencyKey,
    })),
    onMessage: vi.fn(() => () => undefined),
    onCommand: vi.fn(() => () => undefined),
    onInteraction: vi.fn(() => () => undefined),
    onStatus: vi.fn(() => () => undefined),
    onError: vi.fn(() => () => undefined),
    ...overrides,
  } as unknown as ChannelAdapter;
}

let database: DatabaseSync | undefined;

afterEach(() => {
  database?.close();
  database = undefined;
});

function createPersistence(): ChannelRuntimePersistence {
  database = new DatabaseSync(":memory:");
  return new ChannelRuntimePersistence(database, Buffer.alloc(32, 7));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("group private visibility gate", () => {
  it("sends only to target userId with visibility private", async () => {
    const adapter = createAdapter();
    const router = new NotificationRouter(() => adapter);

    router.authorize({
      version: 1,
      generation: 1,
      agentId: "agent-1",
      channelInstanceId: "telegram-1",
      chatId: "chat-1",
      userId: "user-a",
      enabledAt: Date.now(),
    });

    const result = await router.notify({
      agentId: "agent-1",
      sourceEventId: "event-1",
      generation: 1,
      target: {
        version: 1,
        channelType: "telegram",
        channelInstanceId: "telegram-1",
        chatId: "chat-1",
        visibility: "private",
        userId: "user-a",
      },
      text: "private message",
    });

    expect(result.outcome).toBe("committed");
    const sendMock = adapter.send as ReturnType<typeof vi.fn>;
    expect(sendMock).toHaveBeenCalledTimes(1);
    const sentMsg = sendMock.mock.calls[0][0];
    expect(sentMsg.target.visibility).toBe("private");
    expect(sentMsg.target.userId).toBe("user-a");
  });

  it("denies private visibility to wrong user", async () => {
    const adapter = createAdapter();
    const router = new NotificationRouter(() => adapter);

    router.authorize({
      version: 1,
      generation: 1,
      agentId: "agent-1",
      channelInstanceId: "telegram-1",
      chatId: "chat-1",
      userId: "user-a",
      enabledAt: Date.now(),
    });

    await expect(
      router.notify({
        agentId: "agent-1",
        sourceEventId: "event-2",
        generation: 1,
        target: {
          version: 1,
          channelType: "telegram",
          channelInstanceId: "telegram-1",
          chatId: "chat-1",
          visibility: "private",
          userId: "user-b",
        },
        text: "should not deliver",
      }),
    ).rejects.toThrow("NOTIFICATION_TARGET_UNAUTHORIZED");
  });

  it("private authorization cannot be used for chat visibility", async () => {
    const adapter = createAdapter();
    const router = new NotificationRouter(() => adapter);

    // Authorize only private (userId: "user-a")
    router.authorize({
      version: 1,
      generation: 1,
      agentId: "agent-1",
      channelInstanceId: "telegram-1",
      chatId: "chat-1",
      userId: "user-a",
      enabledAt: Date.now(),
    });

    // Try chat visibility with this authorization
    await expect(
      router.notify({
        agentId: "agent-1",
        sourceEventId: "event-3",
        generation: 1,
        target: {
          version: 1,
          channelType: "telegram",
          channelInstanceId: "telegram-1",
          chatId: "chat-1",
          visibility: "chat",
        },
        text: "should not deliver as chat",
      }),
    ).rejects.toThrow("NOTIFICATION_TARGET_UNAUTHORIZED");

    // But private visibility still works
    const result = await router.notify({
      agentId: "agent-1",
      sourceEventId: "event-4",
      generation: 1,
      target: {
        version: 1,
        channelType: "telegram",
        channelInstanceId: "telegram-1",
        chatId: "chat-1",
        visibility: "private",
        userId: "user-a",
      },
      text: "private ok",
    });

    expect(result.outcome).toBe("committed");
  });

  it("chat visibility authorization cannot send private", async () => {
    const adapter = createAdapter();
    const router = new NotificationRouter(() => adapter);

    // Authorize chat visibility (no userId)
    router.authorize({
      version: 1,
      generation: 1,
      agentId: "agent-1",
      channelInstanceId: "telegram-1",
      chatId: "chat-1",
      enabledAt: Date.now(),
    });

    // Chat visibility works
    const chatResult = await router.notify({
      agentId: "agent-1",
      sourceEventId: "event-5",
      generation: 1,
      target: {
        version: 1,
        channelType: "telegram",
        channelInstanceId: "telegram-1",
        chatId: "chat-1",
        visibility: "chat",
      },
      text: "chat message",
    });
    expect(chatResult.outcome).toBe("committed");

    // Private visibility fails (no user-scoped auth)
    await expect(
      router.notify({
        agentId: "agent-1",
        sourceEventId: "event-6",
        generation: 1,
        target: {
          version: 1,
          channelType: "telegram",
          channelInstanceId: "telegram-1",
          chatId: "chat-1",
          visibility: "private",
          userId: "user-a",
        },
        text: "should not deliver",
      }),
    ).rejects.toThrow("NOTIFICATION_TARGET_UNAUTHORIZED");
  });

  it("revoked private authorization denies delivery", async () => {
    const adapter = createAdapter();
    const router = new NotificationRouter(() => adapter);

    router.authorize({
      version: 1,
      generation: 1,
      agentId: "agent-1",
      channelInstanceId: "telegram-1",
      chatId: "chat-1",
      userId: "user-a",
      enabledAt: Date.now(),
    });

    router.revoke("agent-1", "telegram-1", "chat-1", "user-a");

    await expect(
      router.notify({
        agentId: "agent-1",
        sourceEventId: "event-7",
        generation: 1,
        target: {
          version: 1,
          channelType: "telegram",
          channelInstanceId: "telegram-1",
          chatId: "chat-1",
          visibility: "private",
          userId: "user-a",
        },
        text: "revoked",
      }),
    ).rejects.toThrow("NOTIFICATION_TARGET_UNAUTHORIZED");
  });

  it("expired private authorization denies delivery", async () => {
    const adapter = createAdapter();
    const router = new NotificationRouter(() => adapter);

    router.authorize({
      version: 1,
      generation: 1,
      agentId: "agent-1",
      channelInstanceId: "telegram-1",
      chatId: "chat-1",
      userId: "user-a",
      enabledAt: Date.now(),
      expiresAt: 1, // already expired
    });

    await expect(
      router.notify({
        agentId: "agent-1",
        sourceEventId: "event-8",
        generation: 1,
        target: {
          version: 1,
          channelType: "telegram",
          channelInstanceId: "telegram-1",
          chatId: "chat-1",
          visibility: "private",
          userId: "user-a",
        },
        text: "expired",
      }),
    ).rejects.toThrow("NOTIFICATION_TARGET_UNAUTHORIZED");
  });
});

describe("persistence restart preserves private authorizations", () => {
  it("authorization persisted, then hydrated by new router instance", async () => {
    const persistence = createPersistence();
    const adapter = createAdapter();

    // First lifecycle: authorize
    const router1 = new NotificationRouter(() => adapter, persistence);
    router1.authorize({
      version: 1,
      generation: 1,
      agentId: "agent-1",
      channelInstanceId: "telegram-1",
      chatId: "chat-1",
      userId: "user-persist",
      enabledAt: Date.now(),
    });

    // Second lifecycle on same DB: hydrate from persistence
    const router2 = new NotificationRouter(() => adapter, persistence);
    router2.initialize();

    const result = await router2.notify({
      agentId: "agent-1",
      sourceEventId: "event-persist",
      generation: 1,
      target: {
        version: 1,
        channelType: "telegram",
        channelInstanceId: "telegram-1",
        chatId: "chat-1",
        visibility: "private",
        userId: "user-persist",
      },
      text: "persisted private",
    });

    expect(result.outcome).toBe("committed");
  });

  it("revoked authorization is not hydrated as active", async () => {
    const persistence = createPersistence();
    const adapter = createAdapter();

    // First lifecycle: authorize then revoke
    const router1 = new NotificationRouter(() => adapter, persistence);
    router1.authorize({
      version: 1,
      generation: 1,
      agentId: "agent-1",
      channelInstanceId: "telegram-1",
      chatId: "chat-1",
      userId: "user-revoked",
      enabledAt: Date.now(),
    });
    router1.revoke("agent-1", "telegram-1", "chat-1", "user-revoked");

    // Second lifecycle: should not see the revoked authorization
    const router2 = new NotificationRouter(() => adapter, persistence);
    router2.initialize();

    await expect(
      router2.notify({
        agentId: "agent-1",
        sourceEventId: "event-revoked-persist",
        generation: 1,
        target: {
          version: 1,
          channelType: "telegram",
          channelInstanceId: "telegram-1",
          chatId: "chat-1",
          visibility: "private",
          userId: "user-revoked",
        },
        text: "should be revoked",
      }),
    ).rejects.toThrow("NOTIFICATION_TARGET_UNAUTHORIZED");
  });
});

describe("private visibility authorization key scoping", () => {
  it("chat-level authorization does not interfere with user-level private", async () => {
    const adapter = createAdapter();
    const router = new NotificationRouter(() => adapter);

    // Chat-level authorization
    router.authorize({
      version: 1,
      generation: 1,
      agentId: "agent-1",
      channelInstanceId: "telegram-1",
      chatId: "chat-1",
      enabledAt: Date.now(),
    });

    // User-level private authorization for same chat
    router.authorize({
      version: 1,
      generation: 1,
      agentId: "agent-1",
      channelInstanceId: "telegram-1",
      chatId: "chat-1",
      userId: "user-scoped",
      enabledAt: Date.now(),
    });

    // Private delivery works for the scoped user
    const privateResult = await router.notify({
      agentId: "agent-1",
      sourceEventId: "event-scoped-1",
      generation: 1,
      target: {
        version: 1,
        channelType: "telegram",
        channelInstanceId: "telegram-1",
        chatId: "chat-1",
        visibility: "private",
        userId: "user-scoped",
      },
      text: "private scoped",
    });
    expect(privateResult.outcome).toBe("committed");

    // Private delivery fails for different user
    await expect(
      router.notify({
        agentId: "agent-1",
        sourceEventId: "event-scoped-2",
        generation: 1,
        target: {
          version: 1,
          channelType: "telegram",
          channelInstanceId: "telegram-1",
          chatId: "chat-1",
          visibility: "private",
          userId: "other-user",
        },
        text: "should not deliver",
      }),
    ).rejects.toThrow("NOTIFICATION_TARGET_UNAUTHORIZED");

    // Chat visibility still works
    const chatResult = await router.notify({
      agentId: "agent-1",
      sourceEventId: "event-scoped-3",
      generation: 1,
      target: {
        version: 1,
        channelType: "telegram",
        channelInstanceId: "telegram-1",
        chatId: "chat-1",
        visibility: "chat",
      },
      text: "chat works",
    });
    expect(chatResult.outcome).toBe("committed");
  });

  it("revoking chat-level auth does not revoke user-level private auth", async () => {
    const adapter = createAdapter();
    const router = new NotificationRouter(() => adapter);

    router.authorize({
      version: 1,
      generation: 1,
      agentId: "agent-1",
      channelInstanceId: "telegram-1",
      chatId: "chat-1",
      enabledAt: Date.now(),
    });

    router.authorize({
      version: 1,
      generation: 1,
      agentId: "agent-1",
      channelInstanceId: "telegram-1",
      chatId: "chat-1",
      userId: "user-private",
      enabledAt: Date.now(),
    });

    // Revoke only chat-level
    router.revoke("agent-1", "telegram-1", "chat-1");

    // Chat visibility now fails
    await expect(
      router.notify({
        agentId: "agent-1",
        sourceEventId: "event-revoke-1",
        generation: 1,
        target: {
          version: 1,
          channelType: "telegram",
          channelInstanceId: "telegram-1",
          chatId: "chat-1",
          visibility: "chat",
        },
        text: "chat revoked",
      }),
    ).rejects.toThrow("NOTIFICATION_TARGET_UNAUTHORIZED");

    // User-level private still works
    const privateResult = await router.notify({
      agentId: "agent-1",
      sourceEventId: "event-revoke-2",
      generation: 1,
      target: {
        version: 1,
        channelType: "telegram",
        channelInstanceId: "telegram-1",
        chatId: "chat-1",
        visibility: "private",
        userId: "user-private",
      },
      text: "private still ok",
    });
    expect(privateResult.outcome).toBe("committed");
  });
});
