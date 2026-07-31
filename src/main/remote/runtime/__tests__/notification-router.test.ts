import { describe, expect, it, vi } from "vitest";
import { NotificationRouter } from "../notification-router";
import type { ChannelAdapter } from "../channel-adapter";
import type { DeliveryResult } from "../contracts";

const adapter = {
  channelType: "telegram" as const,
  generation: 1,
  send: vi.fn(async (message) => ({
    version: 1 as const,
    generation: message.generation,
    accepted: true,
    committed: true,
    outcome: "committed" as const,
    idempotencyKey: message.idempotencyKey,
  })),
} as unknown as ChannelAdapter;

describe("notification router", () => {
  it("routes only to an enabled authorized target", async () => {
    const router = new NotificationRouter(() => adapter);
    router.authorize({
      version: 1,
      generation: 1,
      agentId: "agent-1",
      channelInstanceId: "telegram-1",
      chatId: "chat-1",
      enabledAt: 1,
    });

    await router.notify({
      agentId: "agent-1",
      sourceEventId: "event-1",
      generation: 1,
      target: {
        version: 1,
        channelType: "telegram",
        channelInstanceId: "telegram-1",
        chatId: "chat-1",
        visibility: "chat",
      },
      text: "done",
    });

    expect(adapter.send).toHaveBeenCalledOnce();
  });

  it("authorizes before idempotency lookup for a different visibility target", async () => {
    const router = new NotificationRouter(() => adapter);
    router.authorize({
      version: 1,
      generation: 1,
      agentId: "agent-1",
      channelInstanceId: "telegram-1",
      chatId: "chat-1",
      enabledAt: 1,
    });
    await router.notify({
      agentId: "agent-1",
      sourceEventId: "event-shared",
      generation: 1,
      target: {
        version: 1,
        channelType: "telegram",
        channelInstanceId: "telegram-1",
        chatId: "chat-1",
        visibility: "chat",
      },
      text: "public",
    });

    await expect(
      router.notify({
        agentId: "agent-1",
        sourceEventId: "event-shared",
        generation: 1,
        target: {
          version: 1,
          channelType: "telegram",
          channelInstanceId: "telegram-1",
          chatId: "chat-1",
          visibility: "private",
          userId: "user-1",
        },
        text: "private",
      }),
    ).rejects.toThrow("NOTIFICATION_TARGET_UNAUTHORIZED");
  });

  it("coalesces concurrent notifications with the same delivery key", async () => {
    let release: (() => void) | undefined;
    const send = vi.fn(
      () => new Promise<{
        version: 1;
        generation: number;
        accepted: boolean;
        committed: boolean;
        outcome: "committed";
        idempotencyKey: string;
      }>((resolve) => {
        release = () => resolve({ version: 1, generation: 1, accepted: true, committed: true, outcome: "committed", idempotencyKey: "ignored" });
      }),
    );
    const concurrentAdapter = { channelType: "telegram" as const, generation: 1, send } as unknown as ChannelAdapter;
    const router = new NotificationRouter(() => concurrentAdapter);
    router.authorize({ version: 1, generation: 1, agentId: "agent-1", channelInstanceId: "telegram-1", chatId: "chat-1", enabledAt: 1 });
    const request = { agentId: "agent-1", sourceEventId: "same", generation: 1, target: { version: 1 as const, channelType: "telegram" as const, channelInstanceId: "telegram-1", chatId: "chat-1", visibility: "chat" as const }, text: "same" };

    const first = router.notify(request);
    const second = router.notify(request);
    expect(send).toHaveBeenCalledOnce();
    release?.();
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
  });

  it("returns unknown when the adapter is superseded during send", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = {
      channelType: "telegram" as const,
      generation: 1,
      send: vi.fn(async (message: { idempotencyKey: string }) => {
        await gate;
        return {
          version: 1 as const,
          generation: 1,
          accepted: true,
          committed: true,
          outcome: "committed" as const,
          idempotencyKey: message.idempotencyKey,
        };
      }),
    } as unknown as ChannelAdapter;
    const second = {
      channelType: "telegram" as const,
      generation: 2,
    } as unknown as ChannelAdapter;
    let current = first;
    const router = new NotificationRouter(() => current);
    router.authorize({
      version: 1,
      generation: 1,
      agentId: "agent-1",
      channelInstanceId: "telegram-1",
      chatId: "chat-1",
      enabledAt: 1,
    });

    const result = router.notify({
      agentId: "agent-1",
      sourceEventId: "superseded",
      generation: 1,
      target: {
        version: 1,
        channelType: "telegram",
        channelInstanceId: "telegram-1",
        chatId: "chat-1",
        visibility: "chat",
      },
      text: "status",
    });
    await vi.waitFor(() => expect(first.send).toHaveBeenCalledOnce());
    current = second;
    release();

    await expect(result).resolves.toMatchObject({ outcome: "unknown" });
  });

  it("rejects a revoked target before adapter delivery", async () => {
    const router = new NotificationRouter(() => adapter);
    router.authorize({
      version: 1,
      generation: 1,
      agentId: "agent-1",
      channelInstanceId: "telegram-1",
      chatId: "chat-1",
      enabledAt: 1,
      revokedAt: 2,
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
          visibility: "chat",
        },
        text: "blocked",
      }),
    ).rejects.toThrow("NOTIFICATION_TARGET_UNAUTHORIZED");
  });

  it("expires a notification authorization after expiry time", async () => {
    const router = new NotificationRouter(() => adapter);
    router.authorize({
      version: 1,
      generation: 1,
      agentId: "agent-1",
      channelInstanceId: "telegram-1",
      chatId: "chat-1",
      enabledAt: 1,
      expiresAt: 1, // already expired
    });

    await expect(
      router.notify({
        agentId: "agent-1",
        sourceEventId: "event-exp",
        generation: 1,
        target: {
          version: 1,
          channelType: "telegram",
          channelInstanceId: "telegram-1",
          chatId: "chat-1",
          visibility: "chat",
        },
        text: "expired",
      }),
    ).rejects.toThrow("NOTIFICATION_TARGET_UNAUTHORIZED");
  });

  it("initialize converts pending notification outbox to unknown", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const { ChannelRuntimePersistence } = await import("../persistence");
    const db = new DatabaseSync(":memory:");
    const persistence = new ChannelRuntimePersistence(db, Buffer.alloc(32, 7));

    // Create a pending notification outbox row directly
    persistence.createOutboundDelivery({
      version: 1,
      generation: 1,
      idempotencyKey: "pending-on-crash",
      agentId: "agent-1",
      channelInstanceId: "telegram-1",
      chatId: "chat-1",
      targetVisibility: "chat",
      kind: "notification",
      payload: { text: "crashed" },
      state: "pending",
    });
    expect(persistence.getOutboundDelivery("pending-on-crash")?.state).toBe("pending");

    // initialize() should convert pending to unknown
    const router = new NotificationRouter(() => adapter, persistence);
    router.initialize();

    expect(persistence.getOutboundDelivery("pending-on-crash")?.state).toBe("unknown");

    // Committed notification outbox keys are hydrated for dedupe
    persistence.createOutboundDelivery({
      version: 1,
      generation: 1,
      idempotencyKey: "committed-survivor",
      agentId: "agent-1",
      channelInstanceId: "telegram-1",
      chatId: "chat-1",
      targetVisibility: "chat",
      kind: "notification",
      payload: { text: "survived" },
      state: "pending",
    });
    persistence.markOutboundCommitted("committed-survivor");

    const router2 = new NotificationRouter(() => adapter, persistence);
    router2.initialize();

    // Committed should still be committed (not converted)
    expect(persistence.getOutboundDelivery("committed-survivor")?.state).toBe("committed");

    db.close();
  });

  it("revalidates authorization before retry after retryable_failure", async () => {
    // Adapter that returns retryable_failure then committed on retry.
    // The retry is a side effect inside handleNotifyResult;
    // notify() returns the original result.
    const { DatabaseSync } = await import("node:sqlite");
    const { ChannelRuntimePersistence } = await import("../persistence");
    const db = new DatabaseSync(":memory:");
    const persistence = new ChannelRuntimePersistence(db, Buffer.alloc(32, 7));

    const send = vi
      .fn()
      .mockResolvedValueOnce({
        version: 1 as const,
        generation: 1,
        accepted: false,
        committed: false,
        outcome: "retryable_failure" as const,
        idempotencyKey: "rk",
      })
      .mockResolvedValueOnce({
        version: 1 as const,
        generation: 1,
        accepted: true,
        committed: true,
        outcome: "committed" as const,
        idempotencyKey: "rk",
      });

    const retryAdapter = { channelType: "telegram" as const, generation: 1, send } as unknown as ChannelAdapter;
    const router = new NotificationRouter(() => retryAdapter, persistence);
    router.initialize();
    router.authorize({
      version: 1,
      generation: 1,
      agentId: "agent-1",
      channelInstanceId: "telegram-1",
      chatId: "chat-1",
      enabledAt: 1,
    });

    const result = await router.notify({
      agentId: "agent-1",
      sourceEventId: "retry-ok",
      generation: 1,
      target: {
        version: 1,
        channelType: "telegram",
        channelInstanceId: "telegram-1",
        chatId: "chat-1",
        visibility: "chat",
      },
      text: "retry-me",
    });

    // notify() returns the original result (retryable_failure) while
    // handleNotifyResult retries as a side effect.
    expect(result.outcome).toBe("retryable_failure");
    // Both first send and retry send happened
    expect(send).toHaveBeenCalledTimes(2);
    // The delivery row should be committed after successful retry
    const deliveryKey = JSON.stringify(["agent-1", "telegram-1", "chat-1", 1, "chat", null, "retry-ok"]);
    expect(persistence.getOutboundDelivery(deliveryKey)?.state).toBe("committed");

    db.close();
  });

  it("revoked authorization before retry marks as failed, does not retry", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const { ChannelRuntimePersistence } = await import("../persistence");
    const db = new DatabaseSync(":memory:");
    const persistence = new ChannelRuntimePersistence(db, Buffer.alloc(32, 7));

    // Adapter returns retryable_failure, then we revoke between first send
    // and retry revalidation.
    let onSend: ((result: {
      version: 1;
      generation: number;
      accepted: boolean;
      committed: boolean;
      outcome: "retryable_failure";
      idempotencyKey: string;
    }) => void) | undefined;
    const send = vi.fn(
      () =>
        new Promise<{
          version: 1;
          generation: number;
          accepted: boolean;
          committed: boolean;
          outcome: "retryable_failure";
          idempotencyKey: string;
        }>((resolve) => {
          onSend = resolve;
        }),
    );

    const adapter = { channelType: "telegram" as const, generation: 1, send } as unknown as ChannelAdapter;
    const router = new NotificationRouter(() => adapter, persistence);
    router.initialize();
    router.authorize({
      version: 1,
      generation: 1,
      agentId: "agent-1",
      channelInstanceId: "telegram-1",
      chatId: "chat-1",
      enabledAt: 1,
    });

    // Start notify — it will create outbound, call send, and hang on send
    const notifyPromise = router.notify({
      agentId: "agent-1",
      sourceEventId: "retry-revoke",
      generation: 1,
      target: {
        version: 1,
        channelType: "telegram",
        channelInstanceId: "telegram-1",
        chatId: "chat-1",
        visibility: "chat",
      },
      text: "retry-then-revoke",
    });

    // Wait for send to be called
    await Promise.resolve();
    expect(send).toHaveBeenCalledTimes(1);

    // Revoke authorization while first send is still in-flight
    router.revoke("agent-1", "telegram-1", "chat-1");

    // Now release the first send with retryable_failure
    onSend!({
      version: 1,
      generation: 1,
      accepted: false,
      committed: false,
      outcome: "retryable_failure",
      idempotencyKey: "rvk",
    });

    await notifyPromise;

    // Retry revalidation should have detected revocation and marked as failed
    const deliveryKey = JSON.stringify(["agent-1", "telegram-1", "chat-1", 1, "chat", null, "retry-revoke"]);
    expect(persistence.getOutboundDelivery(deliveryKey)?.state).toBe("failed");
    // Only the first send, no retry (revalidation blocked it)
    expect(send).toHaveBeenCalledTimes(1);

    db.close();
  });

  it("retry revalidates expiry before second send", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const { ChannelRuntimePersistence } = await import("../persistence");
    const db = new DatabaseSync(":memory:");
    const persistence = new ChannelRuntimePersistence(db, Buffer.alloc(32, 7));

    // Adapter returns retryable_failure. Authorization has expiry far in
    // the future during first send but revalidation will see it's revoked
    // (in this test we mutate the in-memory map to set an expired time).
    let onSend: ((result: {
      version: 1;
      generation: number;
      accepted: boolean;
      committed: boolean;
      outcome: "retryable_failure";
      idempotencyKey: string;
    }) => void) | undefined;
    const send = vi.fn(
      () =>
        new Promise<{
          version: 1;
          generation: number;
          accepted: boolean;
          committed: boolean;
          outcome: "retryable_failure";
          idempotencyKey: string;
        }>((resolve) => {
          onSend = resolve;
        }),
    );

    const adapter = { channelType: "telegram" as const, generation: 1, send } as unknown as ChannelAdapter;
    const router = new NotificationRouter(() => adapter, persistence);
    router.initialize();
    router.authorize({
      version: 1,
      generation: 1,
      agentId: "agent-1",
      channelInstanceId: "telegram-1",
      chatId: "chat-1",
      enabledAt: 1,
    });

    const notifyPromise = router.notify({
      agentId: "agent-1",
      sourceEventId: "exp-retry",
      generation: 1,
      target: {
        version: 1,
        channelType: "telegram",
        channelInstanceId: "telegram-1",
        chatId: "chat-1",
        visibility: "chat",
      },
      text: "expiry-test",
    });

    // Wait for send
    await Promise.resolve();
    expect(send).toHaveBeenCalledTimes(1);

    // Mutate the in-memory authorization to have an expired time.
    // Access internal map via prototype trick.
    const authMap: Map<string, { revokedAt?: number; expiresAt?: number }> =
      (router as unknown as { authorizations: Map<string, { revokedAt?: number; expiresAt?: number }> }).authorizations;
    for (const [, auth] of authMap) {
      auth.expiresAt = 1; // expired
    }

    // Release first send with retryable_failure
    onSend!({
      version: 1,
      generation: 1,
      accepted: false,
      committed: false,
      outcome: "retryable_failure",
      idempotencyKey: "exp",
    });

    await notifyPromise;

    const deliveryKey = JSON.stringify(["agent-1", "telegram-1", "chat-1", 1, "chat", null, "exp-retry"]);
    expect(persistence.getOutboundDelivery(deliveryKey)?.state).toBe("failed");
    expect(send).toHaveBeenCalledTimes(1); // no retry

    db.close();
  });

  it("two routers sharing one DB: only one sends", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const { ChannelRuntimePersistence } = await import("../persistence");
    const db = new DatabaseSync(":memory:");
    const persistence = new ChannelRuntimePersistence(db, Buffer.alloc(32, 7));

    const send1 = vi.fn(async () => ({
      version: 1 as const,
      generation: 1,
      accepted: true,
      committed: true,
      outcome: "committed" as const,
      idempotencyKey: "dual",
    }));
    const send2 = vi.fn(async () => ({
      version: 1 as const,
      generation: 1,
      accepted: true,
      committed: true,
      outcome: "committed" as const,
      idempotencyKey: "dual",
    }));

    const adapter1 = { channelType: "telegram" as const, generation: 1, send: send1 } as unknown as ChannelAdapter;
    const adapter2 = { channelType: "telegram" as const, generation: 1, send: send2 } as unknown as ChannelAdapter;

    const router1 = new NotificationRouter(() => adapter1, persistence);
    const router2 = new NotificationRouter(() => adapter2, persistence);
    router1.initialize();
    router2.initialize();
    router1.authorize({ version: 1, generation: 1, agentId: "agent-1", channelInstanceId: "telegram-1", chatId: "chat-1", enabledAt: 1 });
    router2.authorize({ version: 1, generation: 1, agentId: "agent-1", channelInstanceId: "telegram-1", chatId: "chat-1", enabledAt: 1 });

    const request = {
      agentId: "agent-1",
      sourceEventId: "dual-send",
      generation: 1,
      target: { version: 1 as const, channelType: "telegram" as const, channelInstanceId: "telegram-1", chatId: "chat-1", visibility: "chat" as const },
      text: "shared",
    };

    // One router wins the claim, the other sees NOTIFICATION_OUTCOME_INDETERMINATE.
    const [result1, result2] = await Promise.allSettled([
      router1.notify(request),
      router2.notify(request),
    ]);

    // At least one must be committed
    const committed = [result1, result2].filter(
      (r) => r.status === "fulfilled" && (r.value as DeliveryResult).outcome === "committed",
    );
    expect(committed.length).toBeGreaterThanOrEqual(1);

    // Only one adapter should have been called
    const totalCalls = send1.mock.calls.length + send2.mock.calls.length;
    expect(totalCalls).toBe(1);

    // The outbound row should be committed
    const deliveryKey = JSON.stringify(["agent-1", "telegram-1", "chat-1", 1, "chat", null, "dual-send"]);
    expect(persistence.getOutboundDelivery(deliveryKey)?.state).toBe("committed");

    db.close();
  });
});
