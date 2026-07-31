import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ChannelRuntime,
  type ChannelRuntimePersistence,
  type ChannelRuntimeExecuteFn,
  type ReconcileUnknownDeliveryFn,
  type ReceiptContext,
} from "../channel-runtime";
import type { ChannelSessionBinding } from "../session-router";
import { ChannelRuntimePersistence as ChannelRuntimePersistenceImpl } from "../persistence";
import type {
  InboundReceiptRecord,
  OutboundDeliveryRecord,
} from "../persistence";
import type { ChannelPolicyConfig } from "../policy-engine";
import type { UnifiedMessage } from "../contracts";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const policy: ChannelPolicyConfig = {
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
    id: "msg-1",
    channelType: "telegram",
    channelInstanceId: "instance-1",
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

// ---------------------------------------------------------------------------
// In-memory persistence double with CAS semantics
// ---------------------------------------------------------------------------

class InMemoryPersistence implements ChannelRuntimePersistence {
  private receipts = new Map<string, InboundReceiptRecord>();
  private deliveries = new Map<string, OutboundDeliveryRecord>();

  claimInboundReceipt(input: InboundReceiptRecord) {
    const existing = this.receipts.get(input.receiptKey);
    if (existing) {
      // CAS: re-claim from `received` → `processing`
      if (existing.state === "received") {
        const reClaimed: InboundReceiptRecord = {
          ...existing,
          state: "processing" as const,
          leaseUntil: input.leaseUntil ?? Date.now() + 60_000,
          outboundFinalIdempotencyKey:
            input.outboundFinalIdempotencyKey ??
            existing.outboundFinalIdempotencyKey,
        };
        this.receipts.set(input.receiptKey, reClaimed);
        return { accepted: true, receipt: reClaimed };
      }
      return { accepted: false, receipt: existing };
    }
    const receipt: InboundReceiptRecord = {
      ...input,
      state: "processing",
      leaseUntil: input.leaseUntil ?? Date.now() + 60_000,
    };
    this.receipts.set(input.receiptKey, receipt);
    return { accepted: true, receipt };
  }

  completeInboundReceipt(receiptKey: string): void {
    const r = this.receipts.get(receiptKey);
    if (r) {
      this.receipts.set(receiptKey, {
        ...r,
        state: "completed",
        leaseUntil: undefined,
      });
    }
  }

  requeueExpiredReceipts(now = Date.now()): number {
    let count = 0;
    for (const [key, r] of this.receipts) {
      const delivery = r.outboundFinalIdempotencyKey
        ? this.deliveries.get(r.outboundFinalIdempotencyKey)
        : undefined;
      // ANY outbound row (including pending) blocks requeue
      if (
        r.state === "processing" &&
        r.leaseUntil !== undefined &&
        r.leaseUntil < now &&
        !delivery
      ) {
        this.receipts.set(key, {
          ...r,
          state: "received",
          leaseUntil: undefined,
        });
        count++;
      }
    }
    return count;
  }

  getInboundReceipt(receiptKey: string): InboundReceiptRecord | undefined {
    return this.receipts.get(receiptKey);
  }

  getOutboundDelivery(
    idempotencyKey: string,
  ): OutboundDeliveryRecord | undefined {
    return this.deliveries.get(idempotencyKey);
  }

  listRecoverableReceipts(): InboundReceiptRecord[] {
    return [...this.receipts.values()].filter(
      (r) => r.state === "received" || r.state === "processing",
    );
  }

  abortProcessingReceipt(receiptKey: string): void {
    const r = this.receipts.get(receiptKey);
    if (r && r.state === "processing") {
      this.receipts.set(receiptKey, {
        ...r,
        state: "received",
        leaseUntil: undefined,
      });
    }
  }

  // Helpers for tests
  setDelivery(record: OutboundDeliveryRecord): void {
    this.deliveries.set(record.idempotencyKey, record);
  }

  setReceipt(record: InboundReceiptRecord): void {
    this.receipts.set(record.receiptKey, record);
  }
}

function stalledReceipt(
  receiptKey: string,
  finalIdempotencyKey?: string,
): InboundReceiptRecord {
  return {
    version: 1,
    generation: 1,
    receiptKey,
    messageId: "msg-1",
    channelInstanceId: "instance-1",
    chatId: "chat-1",
    userId: "user-1",
    agentId: "agent-1",
    state: "processing",
    normalizedText: "hello",
    attachmentIds: [],
    outboundFinalIdempotencyKey: finalIdempotencyKey,
    receivedAt: 1,
    leaseUntil: 1,
  };
}

function committedDelivery(
  idempotencyKey: string,
): OutboundDeliveryRecord {
  return {
    version: 1,
    generation: 1,
    idempotencyKey,
    agentId: "agent-1",
    channelInstanceId: "instance-1",
    chatId: "chat-1",
    targetVisibility: "chat",
    kind: "reply",
    payloadHash: "abc",
    encryptedPayload: { ciphertext: "x", iv: "y", authTag: "z" },
    state: "committed",
    updatedAt: 2,
  };
}

function unknownDelivery(
  idempotencyKey: string,
): OutboundDeliveryRecord {
  return {
    version: 1,
    generation: 1,
    idempotencyKey,
    agentId: "agent-1",
    channelInstanceId: "instance-1",
    chatId: "chat-1",
    targetVisibility: "chat",
    kind: "reply",
    payloadHash: "abc",
    encryptedPayload: { ciphertext: "x", iv: "y", authTag: "z" },
    state: "unknown",
    updatedAt: 2,
  };
}

function createRuntime(
  overrides: {
    execute?: ChannelRuntimeExecuteFn;
    persistence?: ChannelRuntimePersistence;
    reconcileUnknownDelivery?: ReconcileUnknownDeliveryFn;
  } = {},
): ChannelRuntime {
  return new ChannelRuntime({
    agentId: "agent-1",
    policy,
    execute: overrides.execute ?? (vi.fn() as unknown as ChannelRuntimeExecuteFn),
    persistence: overrides.persistence,
    reconcileUnknownDelivery: overrides.reconcileUnknownDelivery,
  });
}

// ---------------------------------------------------------------------------
// Tests: crash recovery (in-memory)
// ---------------------------------------------------------------------------

describe("ChannelRuntime crash recovery", () => {
  it("completes a receipt whose outbound delivery is committed, without calling execute", async () => {
    const finalKey = JSON.stringify([
      "agent-1",
      "instance-1",
      "chat-1",
      "msg-1",
      "reply",
    ]);
    const receiptKey = JSON.stringify(["instance-1", "chat-1", "msg-1"]);

    const persistence = new InMemoryPersistence();
    persistence.setReceipt(stalledReceipt(receiptKey, finalKey));
    persistence.setDelivery(committedDelivery(finalKey));

    const execute = vi.fn(async () => undefined);
    const runtime = createRuntime({ execute, persistence });

    await runtime.start();

    expect(execute).not.toHaveBeenCalled();

    const receipt = persistence.getInboundReceipt(receiptKey);
    expect(receipt?.state).toBe("completed");
  });

  it("invokes reconcile callback for unknown deliveries without calling execute", async () => {
    const finalKey = JSON.stringify([
      "agent-1",
      "instance-1",
      "chat-1",
      "msg-1",
      "reply",
    ]);
    const receiptKey = JSON.stringify(["instance-1", "chat-1", "msg-1"]);

    const persistence = new InMemoryPersistence();
    persistence.setReceipt(stalledReceipt(receiptKey, finalKey));
    persistence.setDelivery(unknownDelivery(finalKey));

    const execute = vi.fn(async () => undefined);
    const reconcile = vi.fn(async () => undefined);

    const runtime = createRuntime({
      execute,
      persistence,
      reconcileUnknownDelivery: reconcile,
    });

    await runtime.start();

    expect(execute).not.toHaveBeenCalled();
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(reconcile).toHaveBeenCalledWith(
      expect.objectContaining({ receiptKey }),
      expect.objectContaining({ idempotencyKey: finalKey, state: "unknown" }),
    );
  });

  it("does not invoke reconcile when no callback is configured", async () => {
    const finalKey = JSON.stringify([
      "agent-1",
      "instance-1",
      "chat-1",
      "msg-1",
      "reply",
    ]);
    const receiptKey = JSON.stringify(["instance-1", "chat-1", "msg-1"]);

    const persistence = new InMemoryPersistence();
    persistence.setReceipt(stalledReceipt(receiptKey, finalKey));
    persistence.setDelivery(unknownDelivery(finalKey));

    const execute = vi.fn(async () => undefined);
    const runtime = createRuntime({ execute, persistence });

    await runtime.start();

    expect(execute).not.toHaveBeenCalled();
    const receipt = persistence.getInboundReceipt(receiptKey);
    expect(receipt?.state).toBe("processing");
  });

  it("requeues receipts with expired leases", async () => {
    const receiptKey = JSON.stringify(["instance-1", "chat-1", "msg-1"]);
    const persistence = new InMemoryPersistence();
    persistence.setReceipt(stalledReceipt(receiptKey));

    const execute = vi.fn(async () => undefined);
    const runtime = createRuntime({ execute, persistence });

    await runtime.start();

    expect(execute).not.toHaveBeenCalled();
    const receipt = persistence.getInboundReceipt(receiptKey);
    expect(receipt?.state).toBe("received");
    expect(receipt?.leaseUntil).toBeUndefined();
  });

  it("aborts a processing receipt with expired lease when delivery is missing", async () => {
    const finalKey = JSON.stringify([
      "agent-1",
      "instance-1",
      "chat-1",
      "msg-1",
      "reply",
    ]);
    const receiptKey = JSON.stringify(["instance-1", "chat-1", "msg-1"]);

    const persistence = new InMemoryPersistence();
    // Receipt references a delivery key that doesn't exist, lease expired
    persistence.setReceipt(stalledReceipt(receiptKey, finalKey));

    const execute = vi.fn(async () => undefined);
    const runtime = createRuntime({ execute, persistence });

    await runtime.start();

    expect(execute).not.toHaveBeenCalled();
    const receipt = persistence.getInboundReceipt(receiptKey);
    expect(receipt?.state).toBe("received");
  });

  it("does NOT abort a processing receipt with unexpired lease when delivery is missing", async () => {
    const finalKey = JSON.stringify([
      "agent-1",
      "instance-1",
      "chat-1",
      "msg-1",
      "reply",
    ]);
    const receiptKey = JSON.stringify(["instance-1", "chat-1", "msg-1"]);

    const persistence = new InMemoryPersistence();
    // Processing receipt, unexpired lease, no outbound delivery yet
    persistence.setReceipt({
      ...stalledReceipt(receiptKey, finalKey),
      leaseUntil: Date.now() + 120_000,
    });

    const execute = vi.fn(async () => undefined);
    const runtime = createRuntime({ execute, persistence });

    await runtime.start();

    expect(execute).not.toHaveBeenCalled();
    const receipt = persistence.getInboundReceipt(receiptKey);
    // Still processing — in-flight, outbound row just not written yet
    expect(receipt?.state).toBe("processing");
  });
});

// ---------------------------------------------------------------------------
// Tests: receipt idempotency during normal operation
// ---------------------------------------------------------------------------

describe("ChannelRuntime receipt idempotency", () => {
  it("skips execution for already completed receipts", async () => {
    const receiptKey = JSON.stringify(["instance-1", "chat-1", "msg-1"]);
    const persistence = new InMemoryPersistence();
    persistence.setReceipt({
      version: 1,
      generation: 1,
      receiptKey,
      messageId: "msg-1",
      channelInstanceId: "instance-1",
      chatId: "chat-1",
      userId: "user-1",
      agentId: "agent-1",
      state: "completed",
      normalizedText: "hello",
      attachmentIds: [],
      receivedAt: 1,
    });

    const execute = vi.fn(async () => undefined);
    const runtime = createRuntime({ execute, persistence });

    await runtime.handleMessage(message());

    expect(execute).not.toHaveBeenCalled();
  });

  it("skips execution for rejected receipts", async () => {
    const receiptKey = JSON.stringify(["instance-1", "chat-1", "msg-1"]);
    const persistence = new InMemoryPersistence();
    persistence.setReceipt({
      version: 1,
      generation: 1,
      receiptKey,
      messageId: "msg-1",
      channelInstanceId: "instance-1",
      chatId: "chat-1",
      userId: "user-1",
      agentId: "agent-1",
      state: "rejected",
      normalizedText: "hello",
      attachmentIds: [],
      receivedAt: 1,
    });

    const execute = vi.fn(async () => undefined);
    const runtime = createRuntime({ execute, persistence });

    await runtime.handleMessage(message());

    expect(execute).not.toHaveBeenCalled();
  });

  it("skips execution for in-flight processing with unexpired lease", async () => {
    const receiptKey = JSON.stringify(["instance-1", "chat-1", "msg-1"]);
    const persistence = new InMemoryPersistence();
    persistence.setReceipt({
      version: 1,
      generation: 1,
      receiptKey,
      messageId: "msg-1",
      channelInstanceId: "instance-1",
      chatId: "chat-1",
      userId: "user-1",
      agentId: "agent-1",
      state: "processing",
      normalizedText: "hello",
      attachmentIds: [],
      receivedAt: 1,
      leaseUntil: Date.now() + 120_000,
    });

    const execute = vi.fn(async () => undefined);
    const runtime = createRuntime({ execute, persistence });

    await runtime.handleMessage(message());

    expect(execute).not.toHaveBeenCalled();
  });

  it("re-claims an expired processing receipt via CAS and executes", async () => {
    const receiptKey = JSON.stringify(["instance-1", "chat-1", "msg-1"]);
    const persistence = new InMemoryPersistence();
    // Simulate an earlier claim that expired
    persistence.setReceipt({
      version: 1,
      generation: 1,
      receiptKey,
      messageId: "msg-1",
      channelInstanceId: "instance-1",
      chatId: "chat-1",
      userId: "user-1",
      agentId: "agent-1",
      state: "received",
      normalizedText: "hello",
      attachmentIds: [],
      receivedAt: 1,
    });

    const execute = vi.fn<ChannelRuntimeExecuteFn>();
    const runtime = createRuntime({ execute, persistence });

    await runtime.handleMessage(message());

    expect(execute).toHaveBeenCalledOnce();
    const contextArg = execute.mock.calls[0]![2];
    expect(contextArg.receiptKey).toBe(receiptKey);
    expect(contextArg.finalIdempotencyKey).toBe(
      JSON.stringify(["agent-1", "instance-1", "chat-1", "msg-1", "reply"]),
    );
  });

  it("passes ReceiptContext with finalIdempotencyKey to execute callback", async () => {
    const persistence = new InMemoryPersistence();
    const execute = vi.fn<ChannelRuntimeExecuteFn>();
    const runtime = createRuntime({ execute, persistence });

    await runtime.handleMessage(message());

    expect(execute).toHaveBeenCalledOnce();
    const contextArg = execute.mock.calls[0]![2];
    expect(contextArg.receiptKey).toBe(
      JSON.stringify(["instance-1", "chat-1", "msg-1"]),
    );
    expect(contextArg.finalIdempotencyKey).toBe(
      JSON.stringify(["agent-1", "instance-1", "chat-1", "msg-1", "reply"]),
    );
  });

  it("leaves receipt in processing state after execution error for lease recovery", async () => {
    const receiptKey = JSON.stringify(["instance-1", "chat-1", "msg-1"]);
    const persistence = new InMemoryPersistence();
    const execute = vi.fn(async () => {
      throw new Error("agent crash");
    });
    const runtime = createRuntime({ execute, persistence });

    await runtime.handleMessage(message()).catch(() => undefined);

    const receipt = persistence.getInboundReceipt(receiptKey);
    expect(receipt?.state).toBe("processing");

    // After lease expires, should be requeued
    persistence.requeueExpiredReceipts(Date.now() + 120_000);
    const requeued = persistence.getInboundReceipt(receiptKey);
    expect(requeued?.state).toBe("received");
  });
});

// ---------------------------------------------------------------------------
// Tests: legacy compatibility (no persistence)
// ---------------------------------------------------------------------------

describe("ChannelRuntime without persistence (legacy)", () => {
  it("invokes execute with context even when no persistence is configured", async () => {
    const execute = vi.fn(async () => undefined);
    const runtime = new ChannelRuntime({
      agentId: "agent-1",
      policy,
      execute,
    });

    await runtime.handleMessage(message());

    expect(execute).toHaveBeenCalledOnce();
    const contextArg = (execute.mock.calls[0] as unknown as [ChannelSessionBinding, UnifiedMessage, ReceiptContext])[2];
    expect(contextArg.receiptKey).toBeDefined();
    expect(contextArg.finalIdempotencyKey).toBeDefined();
  });

  it("start() is a no-op without persistence", async () => {
    const runtime = new ChannelRuntime({
      agentId: "agent-1",
      policy,
      execute: vi.fn(async () => undefined),
    });

    await runtime.start();
    expect(runtime.isStarted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests: SQLite-based crash recovery
// ---------------------------------------------------------------------------

describe("ChannelRuntime crash recovery (SQLite)", () => {
  let database: DatabaseSync | undefined;

  afterEach(() => {
    database?.close();
    database = undefined;
  });

  function createStore(): ChannelRuntimePersistenceImpl {
    database = new DatabaseSync(":memory:");
    return new ChannelRuntimePersistenceImpl(database, Buffer.alloc(32, 7));
  }

  function receiptKey(): string {
    return JSON.stringify(["instance-1", "chat-1", "msg-1"]);
  }

  function finalKey(): string {
    return JSON.stringify([
      "agent-1",
      "instance-1",
      "chat-1",
      "msg-1",
      "reply",
    ]);
  }

  it("committed delivery completes receipt during recovery", async () => {
    const store = createStore();
    const rKey = receiptKey();
    const fKey = finalKey();

    // Simulate: receipt claimed with processing state
    store.claimInboundReceipt({
      version: 1,
      generation: 1,
      receiptKey: rKey,
      messageId: "msg-1",
      channelInstanceId: "instance-1",
      chatId: "chat-1",
      userId: "user-1",
      agentId: "agent-1",
      state: "received",
      normalizedText: "hello",
      attachmentIds: [],
      receivedAt: 1,
      leaseUntil: Date.now() + 60_000,
    });

    // Simulate outbound delivery committed
    store.createOutboundDelivery({
      version: 1,
      generation: 1,
      idempotencyKey: fKey,
      agentId: "agent-1",
      channelInstanceId: "instance-1",
      chatId: "chat-1",
      targetVisibility: "chat",
      kind: "reply",
      payload: { text: "response" },
      state: "pending",
    });
    store.markOutboundCommitted(fKey);

    // Update receipt to link to outbound (simulating post-agent step)
    database!
      .prepare(
        `UPDATE channel_inbound_receipts
         SET outbound_final_idempotency_key = ?
         WHERE receipt_key = ?`,
      )
      .run(fKey, rKey);

    const execute = vi.fn(async () => undefined);
    const runtime = new ChannelRuntime({
      agentId: "agent-1",
      policy,
      execute,
      persistence: store,
    });

    await runtime.start();

    expect(execute).not.toHaveBeenCalled();
    const receipt = store.getInboundReceipt(rKey);
    expect(receipt?.state).toBe("completed");
  });

  it("unknown delivery invokes reconcile once during recovery", async () => {
    const store = createStore();
    const rKey = receiptKey();
    const fKey = finalKey();

    store.claimInboundReceipt({
      version: 1,
      generation: 1,
      receiptKey: rKey,
      messageId: "msg-1",
      channelInstanceId: "instance-1",
      chatId: "chat-1",
      userId: "user-1",
      agentId: "agent-1",
      state: "received",
      normalizedText: "hello",
      attachmentIds: [],
      receivedAt: 1,
      leaseUntil: Date.now() + 60_000,
    });

    store.createOutboundDelivery({
      version: 1,
      generation: 1,
      idempotencyKey: fKey,
      agentId: "agent-1",
      channelInstanceId: "instance-1",
      chatId: "chat-1",
      targetVisibility: "chat",
      kind: "reply",
      payload: { text: "lost" },
      state: "pending",
    });
    store.markOutboundUnknown(fKey);

    database!
      .prepare(
        `UPDATE channel_inbound_receipts
         SET outbound_final_idempotency_key = ?
         WHERE receipt_key = ?`,
      )
      .run(fKey, rKey);

    const execute = vi.fn(async () => undefined);
    const reconcile = vi.fn(async () => undefined);
    const runtime = new ChannelRuntime({
      agentId: "agent-1",
      policy,
      execute,
      persistence: store,
      reconcileUnknownDelivery: reconcile,
    });

    await runtime.start();

    expect(execute).not.toHaveBeenCalled();
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(reconcile).toHaveBeenCalledWith(
      expect.objectContaining({ receiptKey: rKey }),
      expect.objectContaining({ idempotencyKey: fKey, state: "unknown" }),
    );
  });

  it("expired lease requeues during recovery", async () => {
    const store = createStore();
    const rKey = receiptKey();

    store.claimInboundReceipt({
      version: 1,
      generation: 1,
      receiptKey: rKey,
      messageId: "msg-1",
      channelInstanceId: "instance-1",
      chatId: "chat-1",
      userId: "user-1",
      agentId: "agent-1",
      state: "received",
      normalizedText: "hello",
      attachmentIds: [],
      receivedAt: 1,
      leaseUntil: 1, // expired
    });

    const execute = vi.fn(async () => undefined);
    const runtime = new ChannelRuntime({
      agentId: "agent-1",
      policy,
      execute,
      persistence: store,
    });

    await runtime.start();

    expect(execute).not.toHaveBeenCalled();
    const receipt = store.getInboundReceipt(rKey);
    expect(receipt?.state).toBe("received");
    expect(receipt?.leaseUntil).toBeUndefined();
  });

  it("does NOT requeue a receipt with a pending outbound delivery", () => {
    const store = createStore();
    const rKey = receiptKey();
    const fKey = finalKey();

    store.claimInboundReceipt({
      version: 1,
      generation: 1,
      receiptKey: rKey,
      messageId: "msg-1",
      channelInstanceId: "instance-1",
      chatId: "chat-1",
      userId: "user-1",
      agentId: "agent-1",
      state: "received",
      normalizedText: "hello",
      attachmentIds: [],
      outboundFinalIdempotencyKey: fKey,
      receivedAt: 1,
      leaseUntil: 1, // expired
    });

    // Create a pending outbound delivery (not yet sent)
    store.createOutboundDelivery({
      version: 1,
      generation: 1,
      idempotencyKey: fKey,
      agentId: "agent-1",
      channelInstanceId: "instance-1",
      chatId: "chat-1",
      targetVisibility: "chat",
      kind: "reply",
      payload: { text: "pending response" },
      state: "pending",
    });

    // Link receipt to outbound
    database!
      .prepare(
        `UPDATE channel_inbound_receipts
         SET outbound_final_idempotency_key = ?
         WHERE receipt_key = ?`,
      )
      .run(fKey, rKey);

    const count = store.requeueExpiredReceipts(Date.now());
    expect(count).toBe(0);
    const receipt = store.getInboundReceipt(rKey);
    expect(receipt?.state).toBe("processing");
  });
});

// ---------------------------------------------------------------------------
// Tests: recoverInboundMessage / executeAcceptedMessage
// ---------------------------------------------------------------------------

describe("ChannelRuntime executeAcceptedMessage", () => {
  it("executes an accepted message bypassing policy", async () => {
    const execute = vi.fn(async () => undefined);
    const runtime = new ChannelRuntime({
      agentId: "agent-1",
      policy: { ...policy, deniedUsers: ["user-1"] }, // would normally block
      execute,
    });

    const m = message();
    const receipt: InboundReceiptRecord = {
      version: 1,
      generation: 1,
      receiptKey: JSON.stringify(["instance-1", "chat-1", "msg-1"]),
      messageId: "msg-1",
      channelInstanceId: "instance-1",
      chatId: "chat-1",
      userId: "user-1",
      agentId: "agent-1",
      state: "received",
      normalizedText: "hello",
      attachmentIds: [],
      outboundFinalIdempotencyKey: JSON.stringify([
        "agent-1",
        "instance-1",
        "chat-1",
        "msg-1",
        "reply",
      ]),
      receivedAt: 1,
    };

    await runtime.executeAcceptedMessage(m, receipt);

    // Policy denied user-1 but executeAcceptedMessage bypasses policy
    expect(execute).toHaveBeenCalledOnce();
  });

  it("enqueues execution through session binding", async () => {
    const execute = vi.fn(async () => undefined);
    const runtime = new ChannelRuntime({
      agentId: "agent-1",
      policy,
      execute,
    });

    const m = message();
    const receipt: InboundReceiptRecord = {
      version: 1,
      generation: 1,
      receiptKey: JSON.stringify(["instance-1", "chat-1", "msg-1"]),
      messageId: "msg-1",
      channelInstanceId: "instance-1",
      chatId: "chat-1",
      userId: "user-1",
      agentId: "agent-1",
      state: "received",
      normalizedText: "hello",
      attachmentIds: [],
      outboundFinalIdempotencyKey: JSON.stringify([
        "agent-1",
        "instance-1",
        "chat-1",
        "msg-1",
        "reply",
      ]),
      receivedAt: 1,
    };

    await runtime.executeAcceptedMessage(m, receipt);

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1" }),
      m,
      expect.objectContaining({
        receiptKey: receipt.receiptKey,
        finalIdempotencyKey: receipt.outboundFinalIdempotencyKey,
        turnId: receipt.outboundFinalIdempotencyKey,
      }),
    );
  });
});
