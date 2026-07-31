import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { ChannelRuntimePersistence } from "../persistence";
import type { InboundReceiptRecord } from "../persistence";
import type { ChannelSessionBinding } from "../session-router";

let database: DatabaseSync | undefined;

afterEach(() => {
  database?.close();
  database = undefined;
});

function createStore(): ChannelRuntimePersistence {
  database = new DatabaseSync(":memory:");
  return new ChannelRuntimePersistence(database, Buffer.alloc(32, 7));
}

function receipt(overrides: Partial<InboundReceiptRecord> = {}): InboundReceiptRecord {
  return {
    version: 1,
    generation: 1,
    receiptKey: "channel-a:chat-a:m1",
    messageId: "m1",
    channelInstanceId: "channel-a",
    chatId: "chat-a",
    userId: "user-a",
    agentId: "agent-a",
    state: "received",
    normalizedText: "hello",
    attachmentIds: [],
    receivedAt: 100,
    ...overrides,
  };
}

describe("channel runtime persistence", () => {
  it("migrates legacy receipt tables before claiming messages", () => {
    database = new DatabaseSync(":memory:");
    database.exec(`
      CREATE TABLE channel_inbound_receipts (
        receipt_key TEXT PRIMARY KEY,
        generation INTEGER NOT NULL,
        message_id TEXT NOT NULL,
        channel_instance_id TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        state TEXT NOT NULL,
        normalized_text TEXT NOT NULL,
        attachment_ids TEXT NOT NULL,
        outbound_final_idempotency_key TEXT,
        received_at INTEGER NOT NULL,
        lease_until INTEGER,
        updated_at INTEGER NOT NULL,
        UNIQUE(channel_instance_id, chat_id, message_id)
      );
    `);

    const store = new ChannelRuntimePersistence(
      database,
      Buffer.alloc(32, 7),
    );
    const result = store.claimInboundReceipt(
      receipt({ channelType: "telegram", chatKind: "dm" }),
    );

    expect(result.accepted).toBe(true);
    expect(result.receipt).toMatchObject({
      channelType: "telegram",
      chatKind: "dm",
    });
  });

  it("deduplicates message IDs within a channel chat", () => {
    const store = createStore();
    expect(store.claimInboundReceipt(receipt()).accepted).toBe(true);
    expect(store.claimInboundReceipt(receipt()).accepted).toBe(false);
  });

  it("atomically commits delivery and completes its receipt", () => {
    const store = createStore();
    store.createOutboundDelivery({
      version: 1,
      generation: 1,
      idempotencyKey: "atomic-key",
      agentId: "agent-a",
      channelInstanceId: "channel-a",
      chatId: "chat-a",
      targetVisibility: "chat",
      kind: "reply",
      payload: { text: "done" },
      state: "pending",
    });
    store.claimInboundReceipt(receipt({ outboundFinalIdempotencyKey: "atomic-key" }));

    store.commitOutboundAndReceipt("atomic-key", receipt().receiptKey, "platform-1");

    expect(store.getOutboundDelivery("atomic-key")?.state).toBe("committed");
    expect(store.getInboundReceipt(receipt().receiptKey)?.state).toBe("completed");
  });

  it("creates authorization and stream state tables for recovery", () => {
    createStore();
    const tables = database
      ?.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('channel_notification_authorizations', 'channel_stream_states')",
      )
      .all() as Array<{ name: string }>;
    expect(tables.map((table) => table.name).sort()).toEqual([
      "channel_notification_authorizations",
      "channel_stream_states",
    ]);
  });

  it("deduplicates a message even when a retry uses a different receipt key", () => {
    const store = createStore();
    const first = store.claimInboundReceipt(receipt());
    const retry = store.claimInboundReceipt(
      receipt({ receiptKey: "different-key" }),
    );
    expect(first.accepted).toBe(true);
    expect(retry.accepted).toBe(false);
    expect(retry.receipt?.receiptKey).toBe(first.receipt?.receiptKey);
  });

  it("claimOutboundDelivery returns true on first insert and false on duplicate", () => {
    const store = createStore();
    const input = {
      version: 1 as const,
      generation: 1,
      idempotencyKey: "claim-test",
      agentId: "agent-a",
      channelInstanceId: "channel-a",
      chatId: "chat-a",
      targetVisibility: "chat" as const,
      kind: "reply" as const,
      payload: { text: "hello" },
      state: "pending" as const,
    };

    const first = store.claimOutboundDelivery(input);
    expect(first).toBe(true);

    const second = store.claimOutboundDelivery(input);
    expect(second).toBe(false);
  });

  it("claimOutboundDelivery throws OUTBOUND_IDEMPOTENCY_CONFLICT on payload mismatch", () => {
    const store = createStore();
    store.claimOutboundDelivery({
      version: 1,
      generation: 1,
      idempotencyKey: "conflict-c",
      agentId: "agent-a",
      channelInstanceId: "channel-a",
      chatId: "chat-a",
      targetVisibility: "chat",
      kind: "reply",
      payload: { text: "first" },
      state: "pending",
    });

    expect(() =>
      store.claimOutboundDelivery({
        version: 1,
        generation: 1,
        idempotencyKey: "conflict-c",
        agentId: "agent-a",
        channelInstanceId: "channel-a",
        chatId: "chat-a",
        targetVisibility: "chat",
        kind: "reply",
        payload: { text: "second" },
        state: "pending",
      }),
    ).toThrow("OUTBOUND_IDEMPOTENCY_CONFLICT");
  });

  it("ensureSchema idempotent on second constructor call on same DB", () => {
    database = new DatabaseSync(":memory:");
    // First construction creates all tables
    new ChannelRuntimePersistence(database, Buffer.alloc(32, 7));
    // Second construction on the same DB must not throw
    expect(() =>
      new ChannelRuntimePersistence(database!, Buffer.alloc(32, 7)),
    ).not.toThrow();

    // Tables must still exist and be usable
    const tables = database!
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as Array<{ name: string }>;
    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain("channel_session_bindings");
    expect(tableNames).toContain("channel_inbound_receipts");
    expect(tableNames).toContain("channel_notification_authorizations");
    expect(tableNames).toContain("channel_stream_states");
    expect(tableNames).toContain("channel_outbound_deliveries");
  });

  it("does not expose plaintext outbox payload", () => {
    const store = createStore();
    store.createOutboundDelivery({
      version: 1,
      generation: 1,
      idempotencyKey: "reply-key",
      agentId: "agent-a",
      channelInstanceId: "channel-a",
      chatId: "chat-a",
      targetVisibility: "chat",
      kind: "reply",
      payload: { text: "secret response" },
      state: "pending",
    });

    const raw = database?.prepare("SELECT * FROM channel_outbound_deliveries").get() as Record<string, unknown>;
    expect(JSON.stringify(raw)).not.toContain("secret response");
  });

  it("rejects an idempotency key with a different payload", () => {
    const store = createStore();
    store.createOutboundDelivery({
      version: 1,
      generation: 1,
      idempotencyKey: "same-key",
      agentId: "agent-a",
      channelInstanceId: "channel-a",
      chatId: "chat-a",
      targetVisibility: "chat",
      kind: "reply",
      payload: { text: "first" },
      state: "pending",
    });

    expect(() =>
      store.createOutboundDelivery({
        version: 1,
        generation: 1,
        idempotencyKey: "same-key",
        agentId: "agent-a",
        channelInstanceId: "channel-a",
        chatId: "chat-a",
        targetVisibility: "chat",
        kind: "reply",
        payload: { text: "second" },
        state: "pending",
      }),
    ).toThrow("OUTBOUND_IDEMPOTENCY_CONFLICT");
  });

  it("atomically requeues expired receipt leases", () => {
    const store = createStore();
    store.claimInboundReceipt(receipt({ leaseUntil: 1 }));
    expect(store.requeueExpiredReceipts(2)).toBe(1);
    expect(store.getInboundReceipt("channel-a:chat-a:m1")?.state).toBe("received");
  });

  it("does not requeue a receipt with an unknown outbound delivery", () => {
    const store = createStore();
    store.createOutboundDelivery({
      version: 1,
      generation: 1,
      idempotencyKey: "unknown-key",
      agentId: "agent-a",
      channelInstanceId: "channel-a",
      chatId: "chat-a",
      targetVisibility: "chat",
      kind: "reply",
      payload: { text: "response" },
      state: "pending",
    });
    store.markOutboundUnknown("unknown-key");
    store.claimInboundReceipt(
      receipt({ leaseUntil: 1, outboundFinalIdempotencyKey: "unknown-key" }),
    );

    expect(store.requeueExpiredReceipts(2)).toBe(0);
    expect(store.getInboundReceipt("channel-a:chat-a:m1")?.state).toBe(
      "processing",
    );
  });

  it("does not regress a committed delivery to unknown", () => {
    const store = createStore();
    store.createOutboundDelivery({
      version: 1,
      generation: 1,
      idempotencyKey: "committed-key",
      agentId: "agent-a",
      channelInstanceId: "channel-a",
      chatId: "chat-a",
      targetVisibility: "chat",
      kind: "reply",
      payload: { text: "response" },
      state: "pending",
    });
    store.markOutboundCommitted("committed-key");
    store.markOutboundUnknown("committed-key");

    expect(store.getOutboundDelivery("committed-key")?.state).toBe("committed");
  });

  it("upserts a user-scoped session binding", () => {
    const store = createStore();
    const binding: ChannelSessionBinding = {
      version: 1,
      generation: 1,
      agentId: "agent-a",
      channelInstanceId: "channel-a",
      chatId: "chat-a",
      userId: "user-a",
      sessionId: "session-a",
      createdAt: 1,
      updatedAt: 1,
    };

    store.upsertSessionBinding(binding);
    expect(
      store.getSessionBinding(
        JSON.stringify(["agent-a", "channel-a", "chat-a", "user-a"]),
      ),
    ).toMatchObject(binding);
  });

  it("completes a receipt when its outbound delivery is committed", () => {
    const store = createStore();
    store.claimInboundReceipt(receipt({ state: "processing", outboundFinalIdempotencyKey: "reply-key" }));
    store.createOutboundDelivery({
      version: 1,
      generation: 1,
      idempotencyKey: "reply-key",
      agentId: "agent-a",
      channelInstanceId: "channel-a",
      chatId: "chat-a",
      targetVisibility: "chat",
      kind: "reply",
      payload: { text: "response" },
      state: "pending",
    });
    store.markOutboundCommitted("reply-key", "platform-message-1");

    expect(store.getRecoveryAction("channel-a:chat-a:m1")).toBe("complete-receipt");
  });

  it("does not requeue a receipt with a pending outbound delivery", () => {
    const store = createStore();
    store.createOutboundDelivery({
      version: 1,
      generation: 1,
      idempotencyKey: "pending-key",
      agentId: "agent-a",
      channelInstanceId: "channel-a",
      chatId: "chat-a",
      targetVisibility: "chat",
      kind: "reply",
      payload: { text: "response" },
      state: "pending",
    });
    store.claimInboundReceipt(
      receipt({ leaseUntil: 1, outboundFinalIdempotencyKey: "pending-key" }),
    );

    // A pending outbox row must prevent requeue (any outbox row blocks)
    expect(store.requeueExpiredReceipts(2)).toBe(0);
    expect(store.getInboundReceipt("channel-a:chat-a:m1")?.state).toBe(
      "processing",
    );
  });

  it("persists channelType and chatKind on claim and reads them back", () => {
    const store = createStore();
    store.claimInboundReceipt(
      receipt({
        channelType: "telegram",
        chatKind: "dm",
      }),
    );

    const r = store.getInboundReceipt("channel-a:chat-a:m1");
    expect(r?.channelType).toBe("telegram");
    expect(r?.chatKind).toBe("dm");
  });

  it("returns undefined for channelType/chatKind on legacy rows without those fields", () => {
    const store = createStore();
    // Insert a legacy row without channel_type/chat_kind
    database!
      .prepare(
        `INSERT INTO channel_inbound_receipts
         (receipt_key, generation, message_id, channel_instance_id, chat_id,
          user_id, agent_id, state, normalized_text, attachment_ids,
          received_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "legacy-key",
        1,
        "legacy-msg",
        "ch-1",
        "chat-1",
        "user-1",
        "agent-a",
        "received",
        "hello",
        "[]",
        100,
        100,
      );

    const r = store.getInboundReceipt("legacy-key");
    expect(r?.channelType).toBeUndefined();
    expect(r?.chatKind).toBeUndefined();
  });
});

describe("stream state persistence", () => {
  it("upserts and retrieves a stream state record", () => {
    const store = createStore();
    store.upsertStreamState({
      version: 1,
      generation: 1,
      streamId: "stream-1",
      channelInstanceId: "ch-1",
      chatId: "chat-1",
      lastSequence: 5,
      state: "active",
      committed: false,
      updatedAt: 100,
    });

    const record = store.getStreamState("stream-1");
    expect(record).toMatchObject({
      streamId: "stream-1",
      lastSequence: 5,
      state: "active",
      committed: false,
    });
  });

  it("lists only active streams", () => {
    const store = createStore();
    store.upsertStreamState({
      version: 1,
      generation: 1,
      streamId: "stream-a",
      channelInstanceId: "ch-1",
      chatId: "chat-1",
      lastSequence: 1,
      state: "active",
      committed: false,
      updatedAt: 100,
    });
    store.upsertStreamState({
      version: 1,
      generation: 1,
      streamId: "stream-b",
      channelInstanceId: "ch-1",
      chatId: "chat-2",
      lastSequence: 3,
      state: "completed",
      finalIdempotencyKey: "final-key",
      committed: true,
      updatedAt: 200,
    });
    store.upsertStreamState({
      version: 1,
      generation: 1,
      streamId: "stream-c",
      channelInstanceId: "ch-1",
      chatId: "chat-3",
      lastSequence: 2,
      state: "active",
      committed: false,
      updatedAt: 150,
    });

    const active = store.listActiveStreams();
    expect(active).toHaveLength(2);
    expect(active.map((s) => s.streamId).sort()).toEqual([
      "stream-a",
      "stream-c",
    ]);
  });

  it("marks stream completed with final idempotency key", () => {
    const store = createStore();
    store.upsertStreamState({
      version: 1,
      generation: 1,
      streamId: "stream-x",
      channelInstanceId: "ch-1",
      chatId: "chat-1",
      lastSequence: 10,
      state: "active",
      committed: false,
      updatedAt: 100,
    });

    store.markStreamCompleted("stream-x", "final-ik-1");

    const record = store.getStreamState("stream-x");
    expect(record?.state).toBe("completed");
    expect(record?.finalIdempotencyKey).toBe("final-ik-1");
    expect(record?.committed).toBe(true);
  });

  it("cancels all active streams", () => {
    const store = createStore();
    store.upsertStreamState({
      version: 1,
      generation: 1,
      streamId: "s1",
      channelInstanceId: "ch-1",
      chatId: "chat-1",
      lastSequence: 1,
      state: "active",
      committed: false,
      updatedAt: 100,
    });
    store.upsertStreamState({
      version: 1,
      generation: 1,
      streamId: "s2",
      channelInstanceId: "ch-1",
      chatId: "chat-2",
      lastSequence: 5,
      state: "active",
      committed: false,
      updatedAt: 200,
    });
    store.upsertStreamState({
      version: 1,
      generation: 1,
      streamId: "s3",
      channelInstanceId: "ch-1",
      chatId: "chat-3",
      lastSequence: 0,
      state: "completed",
      finalIdempotencyKey: "k",
      committed: true,
      updatedAt: 300,
    });

    store.cancelActiveStreams();

    expect(store.getStreamState("s1")?.state).toBe("cancelled");
    expect(store.getStreamState("s2")?.state).toBe("cancelled");
    expect(store.getStreamState("s3")?.state).toBe("completed");
    expect(store.listActiveStreams()).toHaveLength(0);
  });

  it("migrates legacy stream state table without final_idempotency_key and committed", () => {
    database = new DatabaseSync(":memory:");
    database.exec(`
      CREATE TABLE channel_stream_states (
        stream_id TEXT PRIMARY KEY,
        generation INTEGER NOT NULL,
        channel_instance_id TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        last_sequence INTEGER NOT NULL,
        state TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO channel_stream_states
        (stream_id, generation, channel_instance_id, chat_id, last_sequence, state, updated_at)
        VALUES ('legacy-stream', 1, 'ch-1', 'chat-1', 3, 'active', 100);
    `);

    const store = new ChannelRuntimePersistence(database, Buffer.alloc(32, 7));

    // Reading the legacy row should return committed=false, finalIdempotencyKey=undefined
    const record = store.getStreamState("legacy-stream");
    expect(record?.streamId).toBe("legacy-stream");
    expect(record?.lastSequence).toBe(3);
    expect(record?.state).toBe("active");
    expect(record?.committed).toBe(false);
    expect(record?.finalIdempotencyKey).toBeUndefined();

    // Should be able to upsert with the new fields
    store.upsertStreamState({
      version: 1,
      generation: 1,
      streamId: "legacy-stream",
      channelInstanceId: "ch-1",
      chatId: "chat-1",
      lastSequence: 4,
      state: "completed",
      finalIdempotencyKey: "fk",
      committed: true,
      updatedAt: 200,
    });
    const updated = store.getStreamState("legacy-stream");
    expect(updated?.committed).toBe(true);
    expect(updated?.finalIdempotencyKey).toBe("fk");
  });
});

describe("notification authorization persistence", () => {
  it("authorizes and retrieves a notification authorization", () => {
    const store = createStore();
    store.authorizeNotification({
      version: 1,
      generation: 1,
      agentId: "agent-a",
      channelInstanceId: "ch-1",
      chatId: "chat-1",
      enabledAt: 100,
    });

    const record = store.getNotificationAuthorization(
      "agent-a",
      "ch-1",
      "chat-1",
    );
    expect(record).toMatchObject({
      agentId: "agent-a",
      channelInstanceId: "ch-1",
      chatId: "chat-1",
      userId: undefined,
    });
  });

  it("preserves user-scoped key semantics [agent, instance, chat, user|null]", () => {
    const store = createStore();
    // Chat-scoped authorization (userId = null)
    store.authorizeNotification({
      version: 1,
      generation: 1,
      agentId: "agent-a",
      channelInstanceId: "ch-1",
      chatId: "chat-1",
      enabledAt: 100,
    });
    // User-scoped authorization
    store.authorizeNotification({
      version: 1,
      generation: 1,
      agentId: "agent-a",
      channelInstanceId: "ch-1",
      chatId: "chat-1",
      userId: "user-x",
      enabledAt: 100,
    });

    expect(
      store.getNotificationAuthorization("agent-a", "ch-1", "chat-1"),
    ).toBeDefined();
    expect(
      store.getNotificationAuthorization(
        "agent-a",
        "ch-1",
        "chat-1",
        "user-x",
      ),
    ).toBeDefined();
    expect(
      store.getNotificationAuthorization(
        "agent-a",
        "ch-1",
        "chat-1",
        "user-y",
      ),
    ).toBeUndefined();
  });

  it("revokes a notification authorization", () => {
    const store = createStore();
    store.authorizeNotification({
      version: 1,
      generation: 1,
      agentId: "agent-a",
      channelInstanceId: "ch-1",
      chatId: "chat-1",
      enabledAt: 100,
    });

    store.revokeNotificationAuthorization("agent-a", "ch-1", "chat-1");

    const record = store.getNotificationAuthorization(
      "agent-a",
      "ch-1",
      "chat-1",
    );
    expect(record?.revokedAt).toBeGreaterThan(0);
  });

  it("lists active (non-revoked, non-expired) authorizations", () => {
    const store = createStore();
    store.authorizeNotification({
      version: 1,
      generation: 1,
      agentId: "agent-a",
      channelInstanceId: "ch-1",
      chatId: "chat-1",
      enabledAt: 100,
    });
    store.authorizeNotification({
      version: 1,
      generation: 1,
      agentId: "agent-a",
      channelInstanceId: "ch-1",
      chatId: "chat-2",
      enabledAt: 200,
      revokedAt: 300,
    });
    store.authorizeNotification({
      version: 1,
      generation: 1,
      agentId: "agent-a",
      channelInstanceId: "ch-1",
      chatId: "chat-3",
      enabledAt: 400,
      expiresAt: 1, // expired
    });

    const active = store.listActiveAuthorizations();
    expect(active).toHaveLength(1);
    expect(active[0].chatId).toBe("chat-1");
  });

  it("migrates legacy notification authorization table without version/generation", () => {
    database = new DatabaseSync(":memory:");
    database.exec(`
      CREATE TABLE channel_notification_authorizations (
        authorization_key TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        channel_instance_id TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        user_id TEXT,
        enabled_at INTEGER NOT NULL,
        revoked_at INTEGER,
        expires_at INTEGER
      );
      INSERT INTO channel_notification_authorizations
        (authorization_key, agent_id, channel_instance_id, chat_id, enabled_at)
        VALUES ('agent-a|ch-1|chat-1|', 'agent-a', 'ch-1', 'chat-1', 100);
    `);

    const store = new ChannelRuntimePersistence(database, Buffer.alloc(32, 7));

    const record = store.getNotificationAuthorization(
      "agent-a",
      "ch-1",
      "chat-1",
    );
    expect(record).toBeDefined();
    expect(record?.version).toBe(1);
    expect(record?.generation).toBe(0);

    // Should be able to upsert with version/generation
    store.authorizeNotification({
      version: 1,
      generation: 5,
      agentId: "agent-a",
      channelInstanceId: "ch-1",
      chatId: "chat-1",
      enabledAt: 200,
    });
    const updated = store.getNotificationAuthorization(
      "agent-a",
      "ch-1",
      "chat-1",
    );
    expect(updated?.generation).toBe(5);

    store.revokeNotificationAuthorization("agent-a", "ch-1", "chat-1");
    expect(store.listActiveAuthorizations()).toEqual([]);
  });
});

describe("notification outbox helpers", () => {
  it("lists notification outbox by state", () => {
    const store = createStore();
    store.createOutboundDelivery({
      version: 1,
      generation: 1,
      idempotencyKey: "notif-committed",
      agentId: "agent-a",
      channelInstanceId: "ch-1",
      chatId: "chat-1",
      targetVisibility: "chat",
      kind: "notification",
      payload: { text: "done" },
      state: "pending",
    });
    store.createOutboundDelivery({
      version: 1,
      generation: 1,
      idempotencyKey: "reply-key",
      agentId: "agent-a",
      channelInstanceId: "ch-1",
      chatId: "chat-1",
      targetVisibility: "chat",
      kind: "reply",
      payload: { text: "reply" },
      state: "pending",
    });
    store.markOutboundCommitted("notif-committed");

    const committed = store.listNotificationOutboxByState("committed");
    expect(committed).toHaveLength(1);
    expect(committed[0].idempotencyKey).toBe("notif-committed");
    expect(committed[0].kind).toBe("notification");
  });

  it("listAllNotificationOutbox returns only notification kind deliveries", () => {
    const store = createStore();
    store.createOutboundDelivery({
      version: 1,
      generation: 1,
      idempotencyKey: "notif-1",
      agentId: "agent-a",
      channelInstanceId: "ch-1",
      chatId: "chat-1",
      targetVisibility: "chat",
      kind: "notification",
      payload: { text: "a" },
      state: "pending",
    });
    store.createOutboundDelivery({
      version: 1,
      generation: 1,
      idempotencyKey: "reply-1",
      agentId: "agent-a",
      channelInstanceId: "ch-1",
      chatId: "chat-1",
      targetVisibility: "chat",
      kind: "reply",
      payload: { text: "b" },
      state: "pending",
    });

    const all = store.listAllNotificationOutbox();
    expect(all).toHaveLength(1);
    expect(all[0].idempotencyKey).toBe("notif-1");
  });

  it("never exposes plaintext notification text in outbox", () => {
    const store = createStore();
    const secretText = "secret-notification-message";
    store.createOutboundDelivery({
      version: 1,
      generation: 1,
      idempotencyKey: "secret-notif",
      agentId: "agent-a",
      channelInstanceId: "ch-1",
      chatId: "chat-1",
      targetVisibility: "chat",
      kind: "notification",
      payload: { text: secretText },
      state: "pending",
    });

    // The outbound record must not have plaintext
    const record = store.getOutboundDelivery("secret-notif");
    expect(JSON.stringify(record)).not.toContain(secretText);

    // Raw DB check — ciphertext present, plaintext absent
    const raw = database!
      .prepare("SELECT * FROM channel_outbound_deliveries WHERE idempotency_key = ?")
      .get("secret-notif") as Record<string, unknown>;
    expect(raw.kind).toBe("notification");
    expect(JSON.stringify(raw)).not.toContain(secretText);
    expect(typeof raw.ciphertext).toBe("string");
    expect((raw.ciphertext as string).length).toBeGreaterThan(0);
  });
});

describe("interaction authorization persistence", () => {
  it("authorizes and atomically consumes an interaction exactly once", () => {
    const store = createStore();
    store.authorizeInteraction("int-1", 1, "ch-1", "chat-1", "user-a", "value-hash", Date.now() + 60_000);

    const consumed = store.consumeInteraction("int-1", 1, "ch-1", "chat-1", "user-a", "value-hash", Date.now());
    expect(consumed).toBeDefined();
    expect(consumed!.consumedAt).toBeGreaterThan(0);

    // Second consumption fails
    const second = store.consumeInteraction("int-1", 1, "ch-1", "chat-1", "user-a", "value-hash", Date.now());
    expect(second).toBeUndefined();
  });

  it("rejects consumption on wrong userId", () => {
    const store = createStore();
    store.authorizeInteraction("int-1", 1, "ch-1", "chat-1", "user-a", "value-hash", Date.now() + 60_000);

    const result = store.consumeInteraction("int-1", 1, "ch-1", "chat-1", "user-b", "value-hash", Date.now());
    expect(result).toBeUndefined();

    // Original authorization still consumable by correct user
    const correct = store.consumeInteraction("int-1", 1, "ch-1", "chat-1", "user-a", "value-hash", Date.now());
    expect(correct).toBeDefined();
  });

  it("rejects consumption on wrong chatId", () => {
    const store = createStore();
    store.authorizeInteraction("int-1", 1, "ch-1", "chat-1", "user-a", "value-hash", Date.now() + 60_000);

    const result = store.consumeInteraction("int-1", 1, "ch-1", "chat-2", "user-a", "value-hash", Date.now());
    expect(result).toBeUndefined();
  });

  it("rejects consumption on wrong channelInstanceId", () => {
    const store = createStore();
    store.authorizeInteraction("int-1", 1, "ch-1", "chat-1", "user-a", "value-hash", Date.now() + 60_000);

    const result = store.consumeInteraction("int-1", 1, "ch-2", "chat-1", "user-a", "value-hash", Date.now());
    expect(result).toBeUndefined();
  });

  it("rejects consumption on wrong generation", () => {
    const store = createStore();
    store.authorizeInteraction("int-1", 1, "ch-1", "chat-1", "user-a", "value-hash", Date.now() + 60_000);

    const result = store.consumeInteraction("int-1", 2, "ch-1", "chat-1", "user-a", "value-hash", Date.now());
    expect(result).toBeUndefined();
  });

  it("rejects consumption when expired", () => {
    const store = createStore();
    store.authorizeInteraction("int-1", 1, "ch-1", "chat-1", "user-a", "value-hash", 100);

    const result = store.consumeInteraction("int-1", 1, "ch-1", "chat-1", "user-a", "value-hash", 200);
    expect(result).toBeUndefined();
  });

  it("handles concurrent consumption (two identical calls)", () => {
    const store = createStore();
    store.authorizeInteraction("int-1", 1, "ch-1", "chat-1", "user-a", "value-hash", Date.now() + 60_000);

    // Simulate two concurrent consumptions
    const a = store.consumeInteraction("int-1", 1, "ch-1", "chat-1", "user-a", "value-hash", Date.now());
    const b = store.consumeInteraction("int-1", 1, "ch-1", "chat-1", "user-a", "value-hash", Date.now());

    // Exactly one must succeed
    const succeeded = [a, b].filter((r) => r !== undefined);
    expect(succeeded).toHaveLength(1);
  });

  it("ensures channel_interaction_authorizations table exists", () => {
    createStore();
    const tables = database!
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'channel_interaction_authorizations'",
      )
      .all() as Array<{ name: string }>;
    expect(tables).toHaveLength(1);
  });

  it("idempotent schema creation does not throw on second construction", () => {
    database = new DatabaseSync(":memory:");
    new ChannelRuntimePersistence(database, Buffer.alloc(32, 7));
    expect(
      () => new ChannelRuntimePersistence(database!, Buffer.alloc(32, 7)),
    ).not.toThrow();

    // Must be usable after second construction
    const store = new ChannelRuntimePersistence(database, Buffer.alloc(32, 7));
    store.authorizeInteraction("int-idem", 1, "ch-1", "chat-1", "user-a", "value-hash", Date.now() + 60_000);
    const consumed = store.consumeInteraction("int-idem", 1, "ch-1", "chat-1", "user-a", "value-hash", Date.now());
    expect(consumed).toBeDefined();
  });

  it("does not persist interaction value or raw event", () => {
    const store = createStore();
    store.authorizeInteraction("int-noval", 1, "ch-1", "chat-1", "user-a", "value-hash", Date.now() + 60_000);

    // Raw DB check — no value column exists
    const raw = database!
      .prepare("SELECT * FROM channel_interaction_authorizations WHERE interaction_id = ?")
      .get("int-noval") as Record<string, unknown>;

    // The record must only contain the authorization metadata
    expect(raw.interaction_id).toBe("int-noval");
    expect(raw.generation).toBe(1);
    expect(raw.channel_instance_id).toBe("ch-1");
    expect(raw.chat_id).toBe("chat-1");
    expect(raw.user_id).toBe("user-a");
    expect(typeof raw.expires_at).toBe("number");
    expect(raw.consumed_at).toBeNull();
    // No value/payload columns
    expect(raw).not.toHaveProperty("value");
    expect(raw).not.toHaveProperty("payload");
    expect(raw).not.toHaveProperty("raw_event");
  });
});
