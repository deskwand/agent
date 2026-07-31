/**
 * Final delivery deduplication and StreamDelivery behavior tests.
 *
 * Proves:
 *  - StreamDelivery existing behavior (duplicate final, retry, ordering)
 *  - Persisted outbox duplicate coordinator behavior
 *  - ChannelRuntimePersistence outbound idempotency across restarts
 */

import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  StreamDelivery,
} from "../../main/remote/runtime/stream-delivery";
import {
  ChannelRuntimePersistence,
} from "../../main/remote/runtime/persistence";
import type {
  ChannelAdapter,
} from "../../main/remote/runtime/channel-adapter";
import type {
  ChannelTarget,
} from "../../main/remote/runtime/contracts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const target: ChannelTarget = {
  version: 1,
  channelType: "telegram",
  channelInstanceId: "telegram-1",
  chatId: "chat-1",
  visibility: "chat",
};

// ---------------------------------------------------------------------------
// StreamDelivery tests (existing behavior confirmation)
// ---------------------------------------------------------------------------

describe("StreamDelivery deduplication", () => {
  it("does not resend a committed final delivery", async () => {
    const adapter = {
      streamComplete: vi.fn(async () => ({
        version: 1 as const,
        generation: 1,
        accepted: true,
        committed: true,
        outcome: "committed" as const,
        idempotencyKey: "final-key",
      })),
      send: vi.fn(),
    } as unknown as ChannelAdapter;
    const delivery = new StreamDelivery(adapter);

    await delivery.complete("stream-1", target, "final text", "final-key", 1);
    await delivery.complete("stream-1", target, "final text", "final-key", 1);

    expect(adapter.streamComplete).toHaveBeenCalledTimes(1);
    // send should not have been called since streamComplete was used
    expect(adapter.send).not.toHaveBeenCalled();
  });

  it("duplicate committed final returns committed result without sending", async () => {
    const adapter = {
      streamComplete: vi.fn(async () => ({
        version: 1 as const,
        generation: 1,
        accepted: true,
        committed: true,
        outcome: "committed" as const,
        idempotencyKey: "dup-key",
      })),
    } as unknown as ChannelAdapter;
    const delivery = new StreamDelivery(adapter);

    const first = await delivery.complete(
      "stream-2", target, "text", "dup-key", 1,
    );
    expect(first.outcome).toBe("committed");

    const second = await delivery.complete(
      "stream-2", target, "text", "dup-key", 1,
    );
    expect(second.outcome).toBe("committed");
    expect(second.accepted).toBe(true);
    expect(second.committed).toBe(true);
    expect(adapter.streamComplete).toHaveBeenCalledTimes(1);
  });

  it("falls back to adapter.send when streamComplete is absent", async () => {
    const adapter = {
      send: vi.fn(async () => ({
        version: 1 as const,
        generation: 1,
        accepted: true,
        committed: true,
        outcome: "committed" as const,
        idempotencyKey: "fallback-key",
      })),
    } as unknown as ChannelAdapter;
    const delivery = new StreamDelivery(adapter);

    await delivery.complete("stream-3", target, "hello", "fallback-key", 1);

    expect(adapter.send).toHaveBeenCalledTimes(1);
    expect(adapter.send).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "fallback-key",
        kind: "reply",
        text: "hello",
      }),
    );
  });

  it("retries a sequence after a retryable delivery failure", async () => {
    const adapter = {
      streamUpdate: vi
        .fn()
        .mockResolvedValueOnce({
          version: 1 as const,
          generation: 1,
          accepted: false,
          committed: false,
          outcome: "retryable_failure" as const,
          idempotencyKey: "retry-one",
        })
        .mockResolvedValueOnce({
          version: 1 as const,
          generation: 1,
          accepted: true,
          committed: true,
          outcome: "committed" as const,
          idempotencyKey: "retry-one",
        }),
    } as unknown as ChannelAdapter;
    const delivery = new StreamDelivery(adapter);
    const update = {
      version: 1 as const,
      generation: 1,
      streamId: "stream-retry",
      sequence: 1,
      target,
      fullText: "one",
      idempotencyKey: "retry-one",
      isFinal: false,
    };

    await delivery.update(update);
    await delivery.update(update);

    expect(adapter.streamUpdate).toHaveBeenCalledTimes(2);
  });

  it("drops duplicate and out-of-order updates", async () => {
    const adapter = {
      streamUpdate: vi.fn(async (u: { sequence: number }) => ({
        version: 1 as const,
        generation: 1,
        accepted: true,
        committed: true,
        outcome: "committed" as const,
        idempotencyKey: String(u.sequence),
      })),
    } as unknown as ChannelAdapter;
    const delivery = new StreamDelivery(adapter);

    await delivery.update({
      version: 1,
      generation: 1,
      streamId: "drop-stream",
      sequence: 2,
      target,
      fullText: "two",
      idempotencyKey: "two",
      isFinal: false,
    });
    // Out of order — sequence 1 < last (2), dropped
    await delivery.update({
      version: 1,
      generation: 1,
      streamId: "drop-stream",
      sequence: 1,
      target,
      fullText: "one",
      idempotencyKey: "one",
      isFinal: false,
    });
    // Duplicate sequence — dropped
    await delivery.update({
      version: 1,
      generation: 1,
      streamId: "drop-stream",
      sequence: 2,
      target,
      fullText: "two-again",
      idempotencyKey: "two-again",
      isFinal: false,
    });

    expect(adapter.streamUpdate).toHaveBeenCalledTimes(1);
  });

  it("rejects committed stream updates for the same sequence", async () => {
    const adapter = {
      streamUpdate: vi.fn(async (u: { sequence: number }) => ({
        version: 1 as const,
        generation: 1,
        accepted: true,
        committed: true,
        outcome: "committed" as const,
        idempotencyKey: String(u.sequence),
      })),
    } as unknown as ChannelAdapter;
    const delivery = new StreamDelivery(adapter);

    await delivery.update({
      version: 1,
      generation: 1,
      streamId: "commit-stream",
      sequence: 1,
      target,
      fullText: "A",
      idempotencyKey: "ka",
      isFinal: false,
    });
    await delivery.update({
      version: 1,
      generation: 1,
      streamId: "commit-stream",
      sequence: 2,
      target,
      fullText: "B",
      idempotencyKey: "kb",
      isFinal: false,
    });
    // Re-submit sequence 2 — duplicate, dropped
    await delivery.update({
      version: 1,
      generation: 1,
      streamId: "commit-stream",
      sequence: 2,
      target,
      fullText: "B-again",
      idempotencyKey: "kb-again",
      isFinal: false,
    });

    expect(adapter.streamUpdate).toHaveBeenCalledTimes(2);
  });

  it("cancels stream and allows re-delivery on new stream ID", async () => {
    const adapter = {
      streamUpdate: vi.fn(async () => ({
        version: 1 as const,
        generation: 1,
        accepted: true,
        committed: true,
        outcome: "committed" as const,
        idempotencyKey: "new-key",
      })),
      streamComplete: vi.fn(async () => ({
        version: 1 as const,
        generation: 1,
        accepted: true,
        committed: true,
        outcome: "committed" as const,
        idempotencyKey: "comp-key",
      })),
    } as unknown as ChannelAdapter;
    const delivery = new StreamDelivery(adapter);

    // Start and cancel
    await delivery.update({
      version: 1,
      generation: 1,
      streamId: "cancel-me",
      sequence: 1,
      target,
      fullText: "will cancel",
      idempotencyKey: "cancel-key",
      isFinal: false,
    });
    delivery.cancel("cancel-me");

    // New stream — should not conflict
    await delivery.update({
      version: 1,
      generation: 1,
      streamId: "new-stream",
      sequence: 1,
      target,
      fullText: "new",
      idempotencyKey: "new-key",
      isFinal: false,
    });

    expect(adapter.streamUpdate).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Persistence outbox duplicate coordinator tests
// ---------------------------------------------------------------------------

describe("Persistence outbox duplicate coordinator", () => {
  let database: DatabaseSync | undefined;

  afterEach(() => {
    database?.close();
    database = undefined;
  });

  function createStore(): ChannelRuntimePersistence {
    database = new DatabaseSync(":memory:");
    return new ChannelRuntimePersistence(database, Buffer.alloc(32, 7));
  }

  it("INSERT OR IGNORE rejects duplicate idempotency keys", () => {
    const store = createStore();
    const input = {
      version: 1 as const,
      generation: 1,
      idempotencyKey: "dup-key",
      agentId: "agent-1",
      channelInstanceId: "ch-1",
      chatId: "chat-1",
      targetVisibility: "chat" as const,
      kind: "reply" as const,
      payload: { text: "hello" },
      state: "pending" as const,
    };

    store.createOutboundDelivery(input);

    // Same key, same payload — should succeed via INSERT OR IGNORE
    // and the getOutboundDelivery check passes since payload matches
    expect(() => store.createOutboundDelivery(input)).not.toThrow();
  });

  it("throws OUTBOUND_IDEMPOTENCY_CONFLICT for same key with different payload", () => {
    const store = createStore();
    store.createOutboundDelivery({
      version: 1,
      generation: 1,
      idempotencyKey: "conflict-key",
      agentId: "agent-1",
      channelInstanceId: "ch-1",
      chatId: "chat-1",
      targetVisibility: "chat",
      kind: "reply",
      payload: { text: "first" },
      state: "pending",
    });

    expect(() =>
      store.createOutboundDelivery({
        version: 1,
        generation: 1,
        idempotencyKey: "conflict-key",
        agentId: "agent-1",
        channelInstanceId: "ch-1",
        chatId: "chat-1",
        targetVisibility: "chat",
        kind: "reply",
        payload: { text: "second" },
        state: "pending",
      }),
    ).toThrow("OUTBOUND_IDEMPOTENCY_CONFLICT");
  });

  it("does not regress committed delivery to unknown", () => {
    const store = createStore();
    store.createOutboundDelivery({
      version: 1,
      generation: 1,
      idempotencyKey: "committed-key",
      agentId: "agent-1",
      channelInstanceId: "ch-1",
      chatId: "chat-1",
      targetVisibility: "chat",
      kind: "reply",
      payload: { text: "done" },
      state: "pending",
    });
    store.markOutboundCommitted("committed-key");

    // Attempt to mark unknown — should not regress
    store.markOutboundUnknown("committed-key");
    expect(store.getOutboundDelivery("committed-key")?.state).toBe("committed");
  });

  it("does not regress committed delivery to failed", () => {
    const store = createStore();
    store.createOutboundDelivery({
      version: 1,
      generation: 1,
      idempotencyKey: "committed-key-2",
      agentId: "agent-1",
      channelInstanceId: "ch-1",
      chatId: "chat-1",
      targetVisibility: "chat",
      kind: "reply",
      payload: { text: "done" },
      state: "pending",
    });
    store.markOutboundCommitted("committed-key-2");

    // Attempt to mark failed — should not regress
    store.markOutboundFailed("committed-key-2");
    expect(store.getOutboundDelivery("committed-key-2")?.state).toBe(
      "committed",
    );
  });

  it("transitions pending to unknown only", () => {
    const store = createStore();
    store.createOutboundDelivery({
      version: 1,
      generation: 1,
      idempotencyKey: "pending-to-unknown",
      agentId: "agent-1",
      channelInstanceId: "ch-1",
      chatId: "chat-1",
      targetVisibility: "chat",
      kind: "reply",
      payload: { text: "pending" },
      state: "pending",
    });

    store.markOutboundUnknown("pending-to-unknown");
    expect(
      store.getOutboundDelivery("pending-to-unknown")?.state,
    ).toBe("unknown");

    // Already unknown — another markOutboundUnknown should be no-op on state
    // but still succeeds. Check that state stays unknown.
    store.markOutboundUnknown("pending-to-unknown");
    expect(
      store.getOutboundDelivery("pending-to-unknown")?.state,
    ).toBe("unknown");
  });

  it("transitions pending to failed", () => {
    const store = createStore();
    store.createOutboundDelivery({
      version: 1,
      generation: 1,
      idempotencyKey: "pending-to-failed",
      agentId: "agent-1",
      channelInstanceId: "ch-1",
      chatId: "chat-1",
      targetVisibility: "chat",
      kind: "reply",
      payload: { text: "will fail" },
      state: "pending",
    });

    store.markOutboundFailed("pending-to-failed");
    expect(store.getOutboundDelivery("pending-to-failed")?.state).toBe(
      "failed",
    );
  });

  it("transitions unknown to failed", () => {
    const store = createStore();
    store.createOutboundDelivery({
      version: 1,
      generation: 1,
      idempotencyKey: "unknown-to-failed",
      agentId: "agent-1",
      channelInstanceId: "ch-1",
      chatId: "chat-1",
      targetVisibility: "chat",
      kind: "reply",
      payload: { text: "will fail after unknown" },
      state: "pending",
    });
    store.markOutboundUnknown("unknown-to-failed");
    store.markOutboundFailed("unknown-to-failed");
    expect(store.getOutboundDelivery("unknown-to-failed")?.state).toBe(
      "failed",
    );
  });

  // -----------------------------------------------------------------------
  // Strict commit transaction tests
  // -----------------------------------------------------------------------

  it("commitOutboundAndReceipt atomically completes both rows", () => {
    const store = createStore();
    const receiptKey = JSON.stringify(["ch-1", "chat-1", "msg-1"]);
    const idempotencyKey = "atomic-key";

    store.createOutboundDelivery({
      version: 1,
      generation: 1,
      idempotencyKey,
      agentId: "agent-1",
      channelInstanceId: "ch-1",
      chatId: "chat-1",
      targetVisibility: "chat",
      kind: "reply",
      payload: { text: "atomic" },
      state: "pending",
    });

    store.claimInboundReceipt({
      version: 1,
      generation: 1,
      receiptKey,
      messageId: "msg-1",
      channelInstanceId: "ch-1",
      chatId: "chat-1",
      userId: "user-1",
      agentId: "agent-1",
      state: "received",
      normalizedText: "hello",
      attachmentIds: [],
      outboundFinalIdempotencyKey: idempotencyKey,
      receivedAt: 1,
    });

    store.commitOutboundAndReceipt(idempotencyKey, receiptKey, "plat-1");

    expect(store.getOutboundDelivery(idempotencyKey)?.state).toBe("committed");
    expect(store.getInboundReceipt(receiptKey)?.state).toBe("completed");
  });

  it("commitOutboundAndReceipt throws on unrelated delivery key", () => {
    const store = createStore();
    const receiptKey = JSON.stringify(["ch-1", "chat-1", "msg-1"]);
    const idempotencyKey = "correct-key";
    const wrongKey = "wrong-key";

    store.createOutboundDelivery({
      version: 1,
      generation: 1,
      idempotencyKey,
      agentId: "agent-1",
      channelInstanceId: "ch-1",
      chatId: "chat-1",
      targetVisibility: "chat",
      kind: "reply",
      payload: { text: "atomic" },
      state: "pending",
    });

    store.claimInboundReceipt({
      version: 1,
      generation: 1,
      receiptKey,
      messageId: "msg-1",
      channelInstanceId: "ch-1",
      chatId: "chat-1",
      userId: "user-1",
      agentId: "agent-1",
      state: "received",
      normalizedText: "hello",
      attachmentIds: [],
      outboundFinalIdempotencyKey: idempotencyKey,
      receivedAt: 1,
    });

    expect(() =>
      store.commitOutboundAndReceipt(wrongKey, receiptKey),
    ).toThrow("COMMIT_UNRELATED_DELIVERY");

    // Both rows unchanged
    expect(store.getOutboundDelivery(idempotencyKey)?.state).toBe("pending");
    expect(store.getInboundReceipt(receiptKey)?.state).toBe("processing");
  });

  it("commitOutboundAndReceipt leaves state unchanged on CAS failure", () => {
    const store = createStore();
    const receiptKey = JSON.stringify(["ch-1", "chat-1", "msg-cas"]);
    const idempotencyKey = "cas-key";

    store.createOutboundDelivery({
      version: 1,
      generation: 1,
      idempotencyKey,
      agentId: "agent-1",
      channelInstanceId: "ch-1",
      chatId: "chat-1",
      targetVisibility: "chat",
      kind: "reply",
      payload: { text: "cas" },
      state: "pending",
    });

    store.claimInboundReceipt({
      version: 1,
      generation: 1,
      receiptKey,
      messageId: "msg-cas",
      channelInstanceId: "ch-1",
      chatId: "chat-1",
      userId: "user-1",
      agentId: "agent-1",
      state: "received",
      normalizedText: "hello",
      attachmentIds: [],
      outboundFinalIdempotencyKey: idempotencyKey,
      receivedAt: 1,
    });

    // Mark outbound committed externally — CAS will fail
    store.markOutboundCommitted(idempotencyKey);

    expect(() =>
      store.commitOutboundAndReceipt(idempotencyKey, receiptKey),
    ).toThrow("COMMIT_DELIVERY_CAS_FAILED");

    // Receipt should still be processing (rollback preserved it)
    expect(store.getInboundReceipt(receiptKey)?.state).toBe("processing");
  });

  // -----------------------------------------------------------------------
  // Outbound delivery state machine: pending → committed, failed, unknown
  // -----------------------------------------------------------------------

  it("enforces outbound state transitions", () => {
    const store = createStore();
    const key = "state-machine-key";

    store.createOutboundDelivery({
      version: 1,
      generation: 1,
      idempotencyKey: key,
      agentId: "agent-1",
      channelInstanceId: "ch-1",
      chatId: "chat-1",
      targetVisibility: "chat",
      kind: "reply",
      payload: { text: "test" },
      state: "pending",
    });

    // pending → committed
    store.markOutboundCommitted(key);
    expect(store.getOutboundDelivery(key)?.state).toBe("committed");

    // committed → unknown: blocked
    store.markOutboundUnknown(key);
    expect(store.getOutboundDelivery(key)?.state).toBe("committed");

    // committed → failed: blocked
    store.markOutboundFailed(key);
    expect(store.getOutboundDelivery(key)?.state).toBe("committed");
  });

  it("unknown → failed is allowed", () => {
    const store = createStore();
    const key = "unknown-fail-key";

    store.createOutboundDelivery({
      version: 1,
      generation: 1,
      idempotencyKey: key,
      agentId: "agent-1",
      channelInstanceId: "ch-1",
      chatId: "chat-1",
      targetVisibility: "chat",
      kind: "reply",
      payload: { text: "test" },
      state: "pending",
    });

    store.markOutboundUnknown(key);
    expect(store.getOutboundDelivery(key)?.state).toBe("unknown");

    store.markOutboundFailed(key);
    expect(store.getOutboundDelivery(key)?.state).toBe("failed");
  });

  it("committed → committed via commitOutboundAndReceipt is valid (CAS permits unknown → committed)", () => {
    const store = createStore();
    const receiptKey = JSON.stringify(["ch-1", "chat-1", "msg-rec"]);
    const key = "recon-key";

    store.createOutboundDelivery({
      version: 1,
      generation: 1,
      idempotencyKey: key,
      agentId: "agent-1",
      channelInstanceId: "ch-1",
      chatId: "chat-1",
      targetVisibility: "chat",
      kind: "reply",
      payload: { text: "recon" },
      state: "pending",
    });

    store.markOutboundUnknown(key);

    store.claimInboundReceipt({
      version: 1,
      generation: 1,
      receiptKey,
      messageId: "msg-rec",
      channelInstanceId: "ch-1",
      chatId: "chat-1",
      userId: "user-1",
      agentId: "agent-1",
      state: "received",
      normalizedText: "hello",
      attachmentIds: [],
      outboundFinalIdempotencyKey: key,
      receivedAt: 1,
    });

    // unknown → committed via commitOutboundAndReceipt (reconciliation)
    store.commitOutboundAndReceipt(key, receiptKey, "plat-rec");
    expect(store.getOutboundDelivery(key)?.state).toBe("committed");
    expect(store.getInboundReceipt(receiptKey)?.state).toBe("completed");
  });

  // -----------------------------------------------------------------------
  // Recovery action dispatch
  // -----------------------------------------------------------------------

  it("getRecoveryAction returns complete-receipt for committed delivery", () => {
    const store = createStore();
    const rk = JSON.stringify(["ch-1", "chat-1", "msg-rec"]);
    const dk = "recovery-key";

    store.createOutboundDelivery({
      version: 1,
      generation: 1,
      idempotencyKey: dk,
      agentId: "agent-1",
      channelInstanceId: "ch-1",
      chatId: "chat-1",
      targetVisibility: "chat",
      kind: "reply",
      payload: { text: "rec" },
      state: "pending",
    });
    store.markOutboundCommitted(dk);

    store.claimInboundReceipt({
      version: 1,
      generation: 1,
      receiptKey: rk,
      messageId: "msg-rec",
      channelInstanceId: "ch-1",
      chatId: "chat-1",
      userId: "user-1",
      agentId: "agent-1",
      state: "received",
      normalizedText: "hello",
      attachmentIds: [],
      outboundFinalIdempotencyKey: dk,
      receivedAt: 1,
    });

    expect(store.getRecoveryAction(rk)).toBe("complete-receipt");
  });

  it("getRecoveryAction returns reconcile-delivery for unknown delivery", () => {
    const store = createStore();
    const rk = JSON.stringify(["ch-1", "chat-1", "msg-unk"]);
    const dk = "unknown-rec-key";

    store.createOutboundDelivery({
      version: 1,
      generation: 1,
      idempotencyKey: dk,
      agentId: "agent-1",
      channelInstanceId: "ch-1",
      chatId: "chat-1",
      targetVisibility: "chat",
      kind: "reply",
      payload: { text: "unk" },
      state: "pending",
    });
    store.markOutboundUnknown(dk);

    store.claimInboundReceipt({
      version: 1,
      generation: 1,
      receiptKey: rk,
      messageId: "msg-unk",
      channelInstanceId: "ch-1",
      chatId: "chat-1",
      userId: "user-1",
      agentId: "agent-1",
      state: "received",
      normalizedText: "hello",
      attachmentIds: [],
      outboundFinalIdempotencyKey: dk,
      receivedAt: 1,
    });

    expect(store.getRecoveryAction(rk)).toBe("reconcile-delivery");
  });

  it("getRecoveryAction returns requeue-receipt for expired lease without outbound", () => {
    const store = createStore();
    const rk = JSON.stringify(["ch-1", "chat-1", "msg-exp"]);

    store.claimInboundReceipt({
      version: 1,
      generation: 1,
      receiptKey: rk,
      messageId: "msg-exp",
      channelInstanceId: "ch-1",
      chatId: "chat-1",
      userId: "user-1",
      agentId: "agent-1",
      state: "received",
      normalizedText: "hello",
      attachmentIds: [],
      receivedAt: 1,
      leaseUntil: 1, // expired
    });

    expect(store.getRecoveryAction(rk, 100)).toBe("requeue-receipt");
  });

  it("getRecoveryAction returns wait for unexpired lease without outbound", () => {
    const store = createStore();
    const rk = JSON.stringify(["ch-1", "chat-1", "msg-wait"]);

    store.claimInboundReceipt({
      version: 1,
      generation: 1,
      receiptKey: rk,
      messageId: "msg-wait",
      channelInstanceId: "ch-1",
      chatId: "chat-1",
      userId: "user-1",
      agentId: "agent-1",
      state: "received",
      normalizedText: "hello",
      attachmentIds: [],
      receivedAt: 1,
      leaseUntil: Date.now() + 120_000,
    });

    expect(store.getRecoveryAction(rk)).toBe("wait");
  });

  it("getRecoveryAction returns not-found for unknown receipt", () => {
    const store = createStore();
    expect(store.getRecoveryAction("nope")).toBe("not-found");
  });
});

// ---------------------------------------------------------------------------
// StreamDelivery persistence-backed tests
// ---------------------------------------------------------------------------

describe("StreamDelivery with persistence", () => {
  let database: DatabaseSync | undefined;

  afterEach(() => {
    database?.close();
    database = undefined;
  });

  function createStore(): ChannelRuntimePersistence {
    database = new DatabaseSync(":memory:");
    return new ChannelRuntimePersistence(database, Buffer.alloc(32, 7));
  }

  it("dedupes a committed final delivery across StreamDelivery re-instantiation", async () => {
    const store = createStore();
    const adapter = {
      streamComplete: vi.fn(async () => ({
        version: 1 as const,
        generation: 1,
        accepted: true,
        committed: true,
        outcome: "committed" as const,
        idempotencyKey: "final-persist",
      })),
      send: vi.fn(),
    } as unknown as ChannelAdapter;

    // First instance commits
    const delivery1 = new StreamDelivery(adapter, store);
    await delivery1.complete(
      "stream-p1", target, "hello", "final-persist", 1,
    );
    expect(adapter.streamComplete).toHaveBeenCalledTimes(1);

    // Second instance (simulating restart) dedupes via persistence
    const adapter2 = {
      streamComplete: vi.fn(),
      send: vi.fn(),
    } as unknown as ChannelAdapter;
    const delivery2 = new StreamDelivery(adapter2, store);

    const result = await delivery2.complete(
      "stream-p1", target, "hello", "final-persist", 1,
    );

    expect(result.outcome).toBe("committed");
    expect(result.accepted).toBe(true);
    expect(result.committed).toBe(true);
    // No adapter call on second instance
    expect(adapter2.streamComplete).not.toHaveBeenCalled();
    expect(adapter2.send).not.toHaveBeenCalled();
  });

  it("persists accepted sequence progression and hydrates on restart", async () => {
    const store = createStore();
    const adapter = {
      streamUpdate: vi.fn(async (u: { sequence: number }) => ({
        version: 1 as const,
        generation: 1,
        accepted: true,
        committed: true,
        outcome: "committed" as const,
        idempotencyKey: `seq-${u.sequence}`,
      })),
    } as unknown as ChannelAdapter;

    const delivery1 = new StreamDelivery(adapter, store);
    await delivery1.update({
      version: 1,
      generation: 1,
      streamId: "stream-seq",
      sequence: 1,
      target,
      fullText: "A",
      idempotencyKey: "seq-1",
      isFinal: false,
    });
    await delivery1.update({
      version: 1,
      generation: 1,
      streamId: "stream-seq",
      sequence: 3,
      target,
      fullText: "B",
      idempotencyKey: "seq-3",
      isFinal: false,
    });

    // New instance should skip sequences <= 3
    const adapter2 = {
      streamUpdate: vi.fn(async () => ({
        version: 1 as const,
        generation: 1,
        accepted: true,
        committed: true,
        outcome: "committed" as const,
        idempotencyKey: "seq-5",
      })),
    } as unknown as ChannelAdapter;
    const delivery2 = new StreamDelivery(adapter2, store);

    // Sequence 2 is < 3, should be dropped
    const dropped = await delivery2.update({
      version: 1,
      generation: 1,
      streamId: "stream-seq",
      sequence: 2,
      target,
      fullText: "C",
      idempotencyKey: "seq-2",
      isFinal: false,
    });
    expect(dropped).toBeUndefined();
    expect(adapter2.streamUpdate).not.toHaveBeenCalled();

    // Sequence 5 > 3, should be sent
    await delivery2.update({
      version: 1,
      generation: 1,
      streamId: "stream-seq",
      sequence: 5,
      target,
      fullText: "D",
      idempotencyKey: "seq-5",
      isFinal: false,
    });
    expect(adapter2.streamUpdate).toHaveBeenCalledTimes(1);
  });

  it("cancel persists cancelled state preventing re-use", async () => {
    const store = createStore();
    const adapter = {
      streamUpdate: vi.fn(),
    } as unknown as ChannelAdapter;

    const delivery1 = new StreamDelivery(adapter, store);
    delivery1.cancel("stream-cancel");

    // The persisted state shows cancelled
    const persisted = store.getStreamState("stream-cancel");
    expect(persisted?.state).toBe("cancelled");

    // Cancel still succeeds as a no-op for the same instance
    delivery1.cancel("stream-cancel");
  });
});

// ---------------------------------------------------------------------------
// NotificationRouter persistence-backed tests
// ---------------------------------------------------------------------------

import { NotificationRouter } from "../../main/remote/runtime/notification-router";

describe("NotificationRouter with persistence", () => {
  let database: DatabaseSync | undefined;

  afterEach(() => {
    database?.close();
    database = undefined;
  });

  function createStore(): ChannelRuntimePersistence {
    database = new DatabaseSync(":memory:");
    return new ChannelRuntimePersistence(database, Buffer.alloc(32, 7));
  }

  const baseAdapter = {
    channelType: "telegram" as const,
    generation: 1,
    send: vi.fn(async () => ({
      version: 1 as const,
      generation: 1,
      accepted: true,
      committed: true,
      outcome: "committed" as const,
      idempotencyKey: "ignored",
    })),
  } as unknown as ChannelAdapter;

  it("survives authorization across router re-instantiation", async () => {
    const store = createStore();

    // First router authorizes and persists
    const router1 = new NotificationRouter(() => baseAdapter, store);
    router1.authorize({
      version: 1,
      generation: 1,
      agentId: "agent-1",
      channelInstanceId: "telegram-1",
      chatId: "chat-1",
      enabledAt: 100,
    });

    // Second router hydrates from persistence
    const router2 = new NotificationRouter(() => baseAdapter, store);
    router2.initialize();

    await router2.notify({
      agentId: "agent-1",
      sourceEventId: "event-persist",
      generation: 1,
      target: {
        version: 1,
        channelType: "telegram",
        channelInstanceId: "telegram-1",
        chatId: "chat-1",
        visibility: "chat",
      },
      text: "survived",
    });

    expect(baseAdapter.send).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "notification" }),
    );
  });

  it("revocation survives across router re-instantiation", async () => {
    const store = createStore();

    const router1 = new NotificationRouter(() => baseAdapter, store);
    router1.authorize({
      version: 1,
      generation: 1,
      agentId: "agent-1",
      channelInstanceId: "telegram-1",
      chatId: "chat-1",
      enabledAt: 100,
    });
    router1.revoke("agent-1", "telegram-1", "chat-1");

    // Revocation persists
    const stored = store.getNotificationAuthorization(
      "agent-1",
      "telegram-1",
      "chat-1",
    );
    expect(stored?.revokedAt).toBeGreaterThan(0);

    // Second router with fresh adapter
    const adapter2 = {
      channelType: "telegram" as const,
      generation: 1,
      send: vi.fn(),
    } as unknown as ChannelAdapter;
    const router2 = new NotificationRouter(() => adapter2, store);
    router2.initialize();

    await expect(
      router2.notify({
        agentId: "agent-1",
        sourceEventId: "event-rev",
        generation: 1,
        target: {
          version: 1,
          channelType: "telegram",
          channelInstanceId: "telegram-1",
          chatId: "chat-1",
          visibility: "chat",
        },
        text: "revoked",
      }),
    ).rejects.toThrow("NOTIFICATION_TARGET_UNAUTHORIZED");
    expect(adapter2.send).not.toHaveBeenCalled();
  });

  it("expiry survives across router re-instantiation", async () => {
    const store = createStore();

    const router1 = new NotificationRouter(() => baseAdapter, store);
    router1.authorize({
      version: 1,
      generation: 1,
      agentId: "agent-1",
      channelInstanceId: "telegram-1",
      chatId: "chat-1",
      enabledAt: 100,
      expiresAt: 1, // expired
    });

    const adapter2 = {
      channelType: "telegram" as const,
      generation: 1,
      send: vi.fn(),
    } as unknown as ChannelAdapter;
    const router2 = new NotificationRouter(() => adapter2, store);
    router2.initialize();

    await expect(
      router2.notify({
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
    expect(adapter2.send).not.toHaveBeenCalled();
  });

  it("committed notification is not resent across router re-instantiation", async () => {
    const store = createStore();

    const adapter1 = {
      channelType: "telegram" as const,
      generation: 1,
      send: vi.fn(async () => ({
        version: 1 as const,
        generation: 1,
        accepted: true,
        committed: true,
        outcome: "committed" as const,
        idempotencyKey: "ignored",
      })),
    } as unknown as ChannelAdapter;

    // First router commits a notification
    const router1 = new NotificationRouter(() => adapter1, store);
    router1.authorize({
      version: 1,
      generation: 1,
      agentId: "agent-1",
      channelInstanceId: "telegram-1",
      chatId: "chat-1",
      enabledAt: 100,
    });
    await router1.notify({
      agentId: "agent-1",
      sourceEventId: "dedupe-event",
      generation: 1,
      target: {
        version: 1,
        channelType: "telegram",
        channelInstanceId: "telegram-1",
        chatId: "chat-1",
        visibility: "chat",
      },
      text: "should commit",
    });
    expect(adapter1.send).toHaveBeenCalledTimes(1);

    // Verify committed in DB
    const deliveryKey = JSON.stringify([
      "agent-1",
      "telegram-1",
      "chat-1",
      1,
      "chat",
      null,
      "dedupe-event",
    ]);
    const outbound = store.getOutboundDelivery(deliveryKey);
    expect(outbound?.state).toBe("committed");

    // Second router should not resend
    const adapter2 = {
      channelType: "telegram" as const,
      generation: 1,
      send: vi.fn(),
    } as unknown as ChannelAdapter;
    const router2 = new NotificationRouter(() => adapter2, store);
    router2.initialize();
    router2.authorize({
      version: 1,
      generation: 1,
      agentId: "agent-1",
      channelInstanceId: "telegram-1",
      chatId: "chat-1",
      enabledAt: 100,
    });

    const result = await router2.notify({
      agentId: "agent-1",
      sourceEventId: "dedupe-event",
      generation: 1,
      target: {
        version: 1,
        channelType: "telegram",
        channelInstanceId: "telegram-1",
        chatId: "chat-1",
        visibility: "chat",
      },
      text: "should commit",
    });

    expect(result.outcome).toBe("committed");
    expect(adapter2.send).not.toHaveBeenCalled();
  });

  it("concurrent same-key notifications share one in-flight send", async () => {
    const store = createStore();
    let release: (() => void) | undefined;
    const send = vi.fn(
      () =>
        new Promise<{
          version: 1;
          generation: number;
          accepted: boolean;
          committed: boolean;
          outcome: "committed";
          idempotencyKey: string;
        }>((resolve) => {
          release = () =>
            resolve({
              version: 1,
              generation: 1,
              accepted: true,
              committed: true,
              outcome: "committed",
              idempotencyKey: "ignored",
            });
        }),
    );
    const adapter = {
      channelType: "telegram" as const,
      generation: 1,
      send,
    } as unknown as ChannelAdapter;

    const router = new NotificationRouter(() => adapter, store);
    router.authorize({
      version: 1,
      generation: 1,
      agentId: "agent-1",
      channelInstanceId: "telegram-1",
      chatId: "chat-1",
      enabledAt: 100,
    });

    const request = {
      agentId: "agent-1",
      sourceEventId: "concurrent",
      generation: 1,
      target: {
        version: 1 as const,
        channelType: "telegram" as const,
        channelInstanceId: "telegram-1",
        chatId: "chat-1",
        visibility: "chat" as const,
      },
      text: "concurrent",
    };

    const first = router.notify(request);
    const second = router.notify(request);
    // Wait a microtask for the deferred outbound creation to start.
    await Promise.resolve();
    expect(send).toHaveBeenCalledTimes(1);
    release?.();
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
  });

  it("unknown notification is never automatically resent without lookup", async () => {
    const store = createStore();

    // Create an unknown outbound row directly
    const deliveryKey = JSON.stringify([
      "agent-1",
      "telegram-1",
      "chat-1",
      1,
      "chat",
      null,
      "unknown-event",
    ]);
    store.createOutboundDelivery({
      version: 1,
      generation: 1,
      idempotencyKey: deliveryKey,
      agentId: "agent-1",
      channelInstanceId: "telegram-1",
      chatId: "chat-1",
      targetVisibility: "chat",
      kind: "notification",
      payload: { text: "unknown" },
      state: "pending",
    });
    store.markOutboundUnknown(deliveryKey);

    // Router with un-invoked adapter
    const adapter = {
      channelType: "telegram" as const,
      generation: 1,
      send: vi.fn(),
    } as unknown as ChannelAdapter;
    const router = new NotificationRouter(() => adapter, store);
    router.authorize({
      version: 1,
      generation: 1,
      agentId: "agent-1",
      channelInstanceId: "telegram-1",
      chatId: "chat-1",
      enabledAt: 100,
    });

    // Unknown notification must NOT auto-resend — it throws indeterminate
    await expect(
      router.notify({
        agentId: "agent-1",
        sourceEventId: "unknown-event",
        generation: 1,
        target: {
          version: 1,
          channelType: "telegram",
          channelInstanceId: "telegram-1",
          chatId: "chat-1",
          visibility: "chat",
        },
        text: "unknown",
      }),
    ).rejects.toThrow("NOTIFICATION_OUTCOME_INDETERMINATE");

    // Adapter was never invoked
    expect(adapter.send).not.toHaveBeenCalled();
  });

  it("encrypted notification payload never exposes plaintext", async () => {
    const store = createStore();
    const secret = "super-secret-notification";

    const adapter = {
      channelType: "telegram" as const,
      generation: 1,
      send: vi.fn(async () => ({
        version: 1 as const,
        generation: 1,
        accepted: true,
        committed: true,
        outcome: "committed" as const,
        idempotencyKey: "ignored",
      })),
    } as unknown as ChannelAdapter;

    const router = new NotificationRouter(() => adapter, store);
    router.authorize({
      version: 1,
      generation: 1,
      agentId: "agent-1",
      channelInstanceId: "telegram-1",
      chatId: "chat-1",
      enabledAt: 100,
    });

    await router.notify({
      agentId: "agent-1",
      sourceEventId: "secret-event",
      generation: 1,
      target: {
        version: 1,
        channelType: "telegram",
        channelInstanceId: "telegram-1",
        chatId: "chat-1",
        visibility: "chat",
      },
      text: secret,
    });

    // Verify DB has no plaintext
    const deliveryKey = JSON.stringify([
      "agent-1",
      "telegram-1",
      "chat-1",
      1,
      "chat",
      null,
      "secret-event",
    ]);
    const record = store.getOutboundDelivery(deliveryKey);
    expect(JSON.stringify(record)).not.toContain(secret);

    // Raw DB check
    const raw = database!
      .prepare(
        "SELECT * FROM channel_outbound_deliveries WHERE idempotency_key = ?",
      )
      .get(deliveryKey) as Record<string, unknown>;
    expect(JSON.stringify(raw)).not.toContain(secret);
  });

  it("permanent failure throws NOTIFICATION_PERMANENTLY_FAILED on retry", async () => {
    const store = createStore();

    // First router gets a permanent failure
    const adapter1 = {
      channelType: "telegram" as const,
      generation: 1,
      send: vi.fn(async () => ({
        version: 1 as const,
        generation: 1,
        accepted: false,
        committed: false,
        outcome: "permanent_failure" as const,
        idempotencyKey: "ignored",
      })),
    } as unknown as ChannelAdapter;

    const router1 = new NotificationRouter(() => adapter1, store);
    router1.authorize({
      version: 1,
      generation: 1,
      agentId: "agent-1",
      channelInstanceId: "telegram-1",
      chatId: "chat-1",
      enabledAt: 100,
    });

    await router1.notify({
      agentId: "agent-1",
      sourceEventId: "perm-fail-event",
      generation: 1,
      target: {
        version: 1,
        channelType: "telegram",
        channelInstanceId: "telegram-1",
        chatId: "chat-1",
        visibility: "chat",
      },
      text: "will fail",
    });

    // Second router sees the failed state
    const adapter2 = {
      channelType: "telegram" as const,
      generation: 1,
      send: vi.fn(),
    } as unknown as ChannelAdapter;
    const router2 = new NotificationRouter(() => adapter2, store);
    router2.authorize({
      version: 1,
      generation: 1,
      agentId: "agent-1",
      channelInstanceId: "telegram-1",
      chatId: "chat-1",
      enabledAt: 100,
    });

    await expect(
      router2.notify({
        agentId: "agent-1",
        sourceEventId: "perm-fail-event",
        generation: 1,
        target: {
          version: 1,
          channelType: "telegram",
          channelInstanceId: "telegram-1",
          chatId: "chat-1",
          visibility: "chat",
        },
        text: "will fail",
      }),
    ).rejects.toThrow("NOTIFICATION_PERMANENTLY_FAILED");
    expect(adapter2.send).not.toHaveBeenCalled();
  });
});
