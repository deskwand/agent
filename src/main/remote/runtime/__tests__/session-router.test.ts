import { describe, expect, it } from "vitest";
import { SessionRouter } from "../session-router";
import type { UnifiedMessage } from "../contracts";

function message(userId: string): UnifiedMessage {
  return {
    version: 1,
    generation: 1,
    id: `${userId}-message`,
    channelType: "telegram",
    channelInstanceId: "telegram-1",
    chatId: "group-1",
    userId,
    chatKind: "group",
    text: "hello",
    attachments: [],
    mentions: [],
    timestamp: 1,
  };
}

describe("session router", () => {
  it("creates separate sessions for two users in one group", async () => {
    const router = new SessionRouter({ agentId: "agent-1" });
    const first = await router.resolveSession(message("user-a"));
    const second = await router.resolveSession(message("user-b"));

    expect(first.sessionId).not.toBe(second.sessionId);
    expect(first.userId).toBe("user-a");
    expect(second.userId).toBe("user-b");
  });

  it("restores a user session across connection generations", async () => {
    const router = new SessionRouter({ agentId: "agent-1" });
    const first = await router.resolveSession(message("user-a"));
    const second = await router.resolveSession({ ...message("user-a"), generation: 2 });

    expect(first.sessionId).toBe(second.sessionId);
  });

  it("serializes messages for one session", async () => {
    const order: string[] = [];
    const router = new SessionRouter({ agentId: "agent-1" });
    const binding = await router.resolveSession(message("user-a"));

    await Promise.all([
      router.enqueue(binding, async () => {
        order.push("first-start");
        await Promise.resolve();
        order.push("first-end");
      }),
      router.enqueue(binding, async () => {
        order.push("second");
      }),
    ]);

    expect(order).toEqual(["first-start", "first-end", "second"]);
  });
});
