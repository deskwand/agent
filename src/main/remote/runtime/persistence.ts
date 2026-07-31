import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { RuntimeCryptoStore, type EncryptedPayload } from "./crypto-store";
import type { ChannelSessionBinding } from "./session-router";

export interface InboundReceiptRecord {
  version: 1;
  generation: number;
  receiptKey: string;
  messageId: string;
  channelInstanceId: string;
  chatId: string;
  userId: string;
  agentId: string;
  state: "received" | "processing" | "completed" | "rejected";
  normalizedText: string;
  attachmentIds: string[];
  outboundFinalIdempotencyKey?: string;
  receivedAt: number;
  leaseUntil?: number;
  /** Optional fields persisted on claim for crash-recovery message reconstruction */
  channelType?: string;
  chatKind?: string;
}

export interface OutboundDeliveryRecord {
  version: 1;
  generation: number;
  idempotencyKey: string;
  agentId: string;
  channelInstanceId: string;
  chatId: string;
  targetVisibility: "chat" | "private";
  targetUserId?: string;
  kind: "reply" | "notification" | "interaction" | "error";
  payloadHash: string;
  encryptedPayload: EncryptedPayload;
  state: "pending" | "accepted" | "committed" | "unknown" | "failed";
  platformMessageId?: string;
  updatedAt: number;
}

export interface StreamStateRecord {
  version: 1;
  generation: number;
  streamId: string;
  channelInstanceId: string;
  chatId: string;
  lastSequence: number;
  state: "active" | "completed" | "cancelled";
  finalIdempotencyKey?: string;
  committed: boolean;
  updatedAt: number;
}

export interface InteractionAuthorizationRecord {
  version: 1;
  generation: number;
  interactionId: string;
  channelInstanceId: string;
  chatId: string;
  userId: string;
  valueHash: string;
  expiresAt: number;
  consumedAt: number | null;
}

export interface NotificationAuthorizationRecord {
  version: 1;
  generation: number;
  agentId: string;
  channelInstanceId: string;
  chatId: string;
  userId?: string;
  enabledAt: number;
  revokedAt?: number;
  expiresAt?: number;
}

export interface OutboundDeliveryInput {
  version: 1;
  generation: number;
  idempotencyKey: string;
  agentId: string;
  channelInstanceId: string;
  chatId: string;
  targetVisibility: "chat" | "private";
  targetUserId?: string;
  kind: OutboundDeliveryRecord["kind"];
  payload: unknown;
  state: OutboundDeliveryRecord["state"];
}

function interactionAuthorizationKey(
  interactionId: string,
  generation: number,
  channelInstanceId: string,
  chatId: string,
  userId: string,
): string {
  return JSON.stringify([
    channelInstanceId,
    chatId,
    userId,
    interactionId,
    generation,
  ]);
}

export type ReceiptClaim =
  | { accepted: true; receipt: InboundReceiptRecord }
  | { accepted: false; receipt: InboundReceiptRecord | undefined };

export type RecoveryAction =
  | "complete-receipt"
  | "reconcile-delivery"
  | "requeue-receipt"
  | "wait"
  | "not-found";

export class ChannelRuntimePersistence {
  private readonly crypto: RuntimeCryptoStore;

  constructor(
    private readonly database: DatabaseSync,
    encryptionKey: Buffer,
  ) {
    this.crypto = new RuntimeCryptoStore(encryptionKey);
    this.ensureSchema();
  }

  upsertSessionBinding(binding: ChannelSessionBinding): void {
    this.database
      .prepare(
        `INSERT OR REPLACE INTO channel_session_bindings
         (binding_key, version, generation, agent_id, channel_instance_id,
          chat_id, user_id, session_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        JSON.stringify([
          binding.agentId,
          binding.channelInstanceId,
          binding.chatId,
          binding.userId,
        ]),
        binding.version,
        binding.generation,
        binding.agentId,
        binding.channelInstanceId,
        binding.chatId,
        binding.userId,
        binding.sessionId,
        binding.createdAt,
        binding.updatedAt,
      );
  }

  getSessionBinding(bindingKey: string): ChannelSessionBinding | undefined {
    const row = this.database
      .prepare("SELECT * FROM channel_session_bindings WHERE binding_key = ?")
      .get(bindingKey) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      version: 1,
      generation: Number(row.generation),
      agentId: String(row.agent_id),
      channelInstanceId: String(row.channel_instance_id),
      chatId: String(row.chat_id),
      userId: String(row.user_id),
      sessionId: String(row.session_id),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  claimInboundReceipt(input: InboundReceiptRecord): ReceiptClaim {
    const leaseUntil = input.leaseUntil ?? Date.now() + 60_000;
    const updatedAt = Date.now();

    // Try INSERT first (brand-new receipt).
    const insertResult = this.database
      .prepare(
        `INSERT OR IGNORE INTO channel_inbound_receipts
         (receipt_key, generation, message_id, channel_instance_id, chat_id,
          user_id, agent_id, state, normalized_text, attachment_ids,
          outbound_final_idempotency_key, received_at, lease_until, updated_at,
          channel_type, chat_kind)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'processing', ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.receiptKey,
        input.generation,
        input.messageId,
        input.channelInstanceId,
        input.chatId,
        input.userId,
        input.agentId,
        input.normalizedText,
        JSON.stringify(input.attachmentIds),
        input.outboundFinalIdempotencyKey ?? null,
        input.receivedAt,
        leaseUntil,
        updatedAt,
        input.channelType ?? null,
        input.chatKind ?? null,
      );

    if (insertResult.changes > 0) {
      const receipt = this.getInboundReceipt(input.receiptKey);
      if (!receipt) throw new Error("CHANNEL_RECEIPT_INSERT_FAILED");
      return { accepted: true, receipt };
    }

    // INSERT OR IGNORE hit an existing row — resolve identity for CAS.
    const existing =
      this.getInboundReceipt(input.receiptKey) ??
      this.getInboundReceiptByIdentity(
        input.channelInstanceId,
        input.chatId,
        input.messageId,
      );
    if (!existing) throw new Error("CHANNEL_RECEIPT_INSERT_FAILED");

    // CAS: only re-claim a receipt that is still in `received` state.
    if (existing.state === "received") {
      const casResult = this.database
        .prepare(
          `UPDATE channel_inbound_receipts
           SET state = 'processing',
               lease_until = ?,
               outbound_final_idempotency_key = COALESCE(outbound_final_idempotency_key, ?),
               updated_at = ?
           WHERE receipt_key = ? AND state = 'received'`,
        )
        .run(
          leaseUntil,
          input.outboundFinalIdempotencyKey ?? null,
          updatedAt,
          existing.receiptKey,
        );

      if (casResult.changes > 0) {
        const reClaimed = this.getInboundReceipt(existing.receiptKey);
        if (!reClaimed) throw new Error("CHANNEL_RECEIPT_INSERT_FAILED");
        return { accepted: true, receipt: reClaimed };
      }
      // CAS lost a race — fall through to return the current record.
      const current = this.getInboundReceipt(existing.receiptKey);
      return { accepted: false, receipt: current ?? existing };
    }

    return { accepted: false, receipt: existing };
  }

  /**
   * Atomically claim an outbound delivery slot via INSERT OR IGNORE.
   * Returns true if this call created the row; false if an existing row
   * was found (duplicate idempotency key).
   *
   * Rejects with OUTBOUND_IDEMPOTENCY_CONFLICT when the existing row
   * has different payload identity (paylaodHash / generation / agentId /
   * channelInstanceId / chatId / targetVisibility / targetUserId / kind).
   *
   * Two class instances sharing one database cannot both create a row
   * for the same idempotency key — SQLite INSERT OR IGNORE serialises
   * concurrent writes.
   */
  claimOutboundDelivery(input: OutboundDeliveryInput): boolean {
    const serializedPayload = JSON.stringify(input.payload);
    const encryptedPayload = this.crypto.encryptJson(input.payload);
    const payloadHash = createHash("sha256")
      .update(serializedPayload, "utf8")
      .digest("hex");

    const result = this.database
      .prepare(
        `INSERT OR IGNORE INTO channel_outbound_deliveries
         (idempotency_key, generation, agent_id, channel_instance_id, chat_id,
          target_visibility, target_user_id, kind, payload_hash, ciphertext,
          iv, auth_tag, state, platform_message_id, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.idempotencyKey,
        input.generation,
        input.agentId,
        input.channelInstanceId,
        input.chatId,
        input.targetVisibility,
        input.targetUserId ?? null,
        input.kind,
        payloadHash,
        encryptedPayload.ciphertext,
        encryptedPayload.iv,
        encryptedPayload.authTag,
        input.state,
        null,
        Date.now(),
      );

    // INSERT OR IGNORE with changes === 0 means row already existed.
    if (result.changes === 0) {
      const existing = this.getOutboundDelivery(input.idempotencyKey);
      if (!existing) throw new Error("OUTBOUND_DELIVERY_INSERT_FAILED");
      if (
        existing.payloadHash !== payloadHash ||
        existing.generation !== input.generation ||
        existing.agentId !== input.agentId ||
        existing.channelInstanceId !== input.channelInstanceId ||
        existing.chatId !== input.chatId ||
        existing.targetVisibility !== input.targetVisibility ||
        existing.targetUserId !== input.targetUserId ||
        existing.kind !== input.kind
      ) {
        throw new Error("OUTBOUND_IDEMPOTENCY_CONFLICT");
      }
      return false;
    }

    // Verify the row was actually written (defence in depth).
    const inserted = this.getOutboundDelivery(input.idempotencyKey);
    if (!inserted) throw new Error("OUTBOUND_DELIVERY_INSERT_FAILED");
    return true;
  }

  createOutboundDelivery(input: OutboundDeliveryInput): void {
    // Delegate to claimOutboundDelivery; ignore the boolean result.
    this.claimOutboundDelivery(input);
  }

  markOutboundCommitted(
    idempotencyKey: string,
    platformMessageId?: string,
  ): void {
    this.database
      .prepare(
        `UPDATE channel_outbound_deliveries
         SET state = 'committed', platform_message_id = ?, updated_at = ?
         WHERE idempotency_key = ?`,
      )
      .run(platformMessageId ?? null, Date.now(), idempotencyKey);
  }

  /**
   * Atomically commit a pending outbound delivery and complete its
   * linked inbound receipt. Strict CAS: each UPDATE must affect exactly
   * 1 row. Rolls back and throws if either count is 0 or >1.
   *
   * Validates that the receipt references the supplied delivery via
   * outbound_final_idempotency_key.
   */
  commitOutboundAndReceipt(
    idempotencyKey: string,
    receiptKey: string,
    platformMessageId?: string,
  ): void {
    const updatedAt = Date.now();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      // Validate receipt references this delivery and is in processing state
      const receiptCheck = this.database
        .prepare(
          `SELECT outbound_final_idempotency_key, state
           FROM channel_inbound_receipts
           WHERE receipt_key = ?`,
        )
        .get(receiptKey) as
        | { outbound_final_idempotency_key: string | null; state: string }
        | undefined;
      if (!receiptCheck) {
        throw new Error("COMMIT_RECEIPT_CHECK_FAILED");
      }
      if (receiptCheck.outbound_final_idempotency_key !== idempotencyKey) {
        throw new Error("COMMIT_UNRELATED_DELIVERY");
      }
      if (receiptCheck.state !== "processing") {
        throw new Error("COMMIT_RECEIPT_NOT_PROCESSING");
      }

      // CAS: pending/unknown -> committed (exactly 1 row). Unknown may be
      // promoted only after platform lookup confirms the original send.
      const deliveryResult = this.database
        .prepare(
          `UPDATE channel_outbound_deliveries
           SET state = 'committed', platform_message_id = ?, updated_at = ?
           WHERE idempotency_key = ? AND state IN ('pending', 'unknown')`,
        )
        .run(platformMessageId ?? null, updatedAt, idempotencyKey);

      if (deliveryResult.changes !== 1) {
        throw new Error("COMMIT_DELIVERY_CAS_FAILED");
      }

      // CAS: processing -> completed (exactly 1 row)
      const receiptResult = this.database
        .prepare(
          `UPDATE channel_inbound_receipts
           SET state = 'completed', lease_until = NULL, updated_at = ?
           WHERE receipt_key = ? AND state = 'processing'`,
        )
        .run(updatedAt, receiptKey);

      if (receiptResult.changes !== 1) {
        throw new Error("COMMIT_RECEIPT_CAS_FAILED");
      }

      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  markOutboundUnknown(idempotencyKey: string): void {
    this.database
      .prepare(
        `UPDATE channel_outbound_deliveries
         SET state = 'unknown', updated_at = ?
         WHERE idempotency_key = ? AND state = 'pending'`,
      )
      .run(Date.now(), idempotencyKey);
  }

  /**
   * Mark an outbound delivery as failed (permanent failure).
   * Only transitions from pending/unknown states to prevent
   * regressing committed deliveries.
   */
  markOutboundFailed(idempotencyKey: string): void {
    this.database
      .prepare(
        `UPDATE channel_outbound_deliveries
         SET state = 'failed', updated_at = ?
         WHERE idempotency_key = ? AND state IN ('pending', 'unknown')`,
      )
      .run(Date.now(), idempotencyKey);
  }

  /**
   * Atomically mark an outbound delivery as permanently failed AND
   * reject its linked inbound receipt. Strict CAS: the outbound row
   * must be in pending/unknown (exactly 1 row affected) AND the
   * receipt must be in processing state with
   * outbound_final_idempotency_key matching the delivery idempotency
   * key (exactly 1 row affected). Rolls back if either CAS fails.
   *
   * Use this for permanent failures of built-in command responses
   * so that duplicate processing does not leave the receipt
   * indefinitely in processing state.
   */
  markOutboundFailedAndRejectReceipt(
    idempotencyKey: string,
    receiptKey: string,
  ): void {
    const updatedAt = Date.now();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      // Validate receipt references this delivery and is in processing state
      const receiptCheck = this.database
        .prepare(
          `SELECT outbound_final_idempotency_key, state
           FROM channel_inbound_receipts
           WHERE receipt_key = ?`,
        )
        .get(receiptKey) as
        | { outbound_final_idempotency_key: string | null; state: string }
        | undefined;
      if (!receiptCheck) {
        throw new Error("FAIL_REJECT_RECEIPT_CHECK_FAILED");
      }
      if (receiptCheck.outbound_final_idempotency_key !== idempotencyKey) {
        throw new Error("FAIL_REJECT_UNRELATED_DELIVERY");
      }
      if (receiptCheck.state !== "processing") {
        throw new Error("FAIL_REJECT_RECEIPT_NOT_PROCESSING");
      }

      // CAS: pending/unknown -> failed (exactly 1 row)
      const deliveryResult = this.database
        .prepare(
          `UPDATE channel_outbound_deliveries
           SET state = 'failed', updated_at = ?
           WHERE idempotency_key = ? AND state IN ('pending', 'unknown')`,
        )
        .run(updatedAt, idempotencyKey);

      if (deliveryResult.changes !== 1) {
        throw new Error("FAIL_REJECT_DELIVERY_CAS_FAILED");
      }

      // CAS: processing -> rejected (exactly 1 row)
      const receiptResult = this.database
        .prepare(
          `UPDATE channel_inbound_receipts
           SET state = 'rejected', lease_until = NULL, updated_at = ?
           WHERE receipt_key = ? AND state = 'processing'`,
        )
        .run(updatedAt, receiptKey);

      if (receiptResult.changes !== 1) {
        throw new Error("FAIL_REJECT_RECEIPT_CAS_FAILED");
      }

      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  requeueExpiredReceipts(now = Date.now()): number {
    const result = this.database
      .prepare(
        `UPDATE channel_inbound_receipts
         SET state = 'received', lease_until = NULL, updated_at = ?
         WHERE state = 'processing'
           AND lease_until IS NOT NULL
           AND lease_until < ?
           AND NOT EXISTS (
             SELECT 1 FROM channel_outbound_deliveries
             WHERE idempotency_key = channel_inbound_receipts.outbound_final_idempotency_key
           )`,
      )
      .run(now, now);
    return Number(result.changes);
  }

  completeInboundReceipt(receiptKey: string): void {
    this.database
      .prepare(
        `UPDATE channel_inbound_receipts
         SET state = 'completed', lease_until = NULL, updated_at = ?
         WHERE receipt_key = ?`,
      )
      .run(Date.now(), receiptKey);
  }

  getRecoveryAction(receiptKey: string, now = Date.now()): RecoveryAction {
    const receipt = this.getInboundReceipt(receiptKey);
    if (!receipt) return "not-found";
    if (receipt.state === "completed" || receipt.state === "rejected") {
      return "wait";
    }

    const key = receipt.outboundFinalIdempotencyKey;
    if (key) {
      const delivery = this.getOutboundDelivery(key);
      if (delivery?.state === "committed") return "complete-receipt";
      if (delivery?.state === "unknown") return "reconcile-delivery";
    }

    return receipt.leaseUntil !== undefined && receipt.leaseUntil < now
      ? "requeue-receipt"
      : "wait";
  }

  private getInboundReceiptByIdentity(
    channelInstanceId: string,
    chatId: string,
    messageId: string,
  ): InboundReceiptRecord | undefined {
    const row = this.database
      .prepare(
        `SELECT receipt_key FROM channel_inbound_receipts
         WHERE channel_instance_id = ? AND chat_id = ? AND message_id = ?`,
      )
      .get(channelInstanceId, chatId, messageId) as
      | { receipt_key: string }
      | undefined;
    return row ? this.getInboundReceipt(row.receipt_key) : undefined;
  }

  listRecoverableReceipts(): InboundReceiptRecord[] {
    const rows = this.database
      .prepare(
        `SELECT receipt_key FROM channel_inbound_receipts
         WHERE state IN ('received', 'processing')
         ORDER BY received_at ASC`,
      )
      .all() as Array<{ receipt_key: string }>;
    return rows
      .map((r) => this.getInboundReceipt(r.receipt_key))
      .filter((r): r is InboundReceiptRecord => r !== undefined);
  }

  abortProcessingReceipt(receiptKey: string): void {
    this.database
      .prepare(
        `UPDATE channel_inbound_receipts
         SET state = 'received', lease_until = NULL, updated_at = ?
         WHERE receipt_key = ? AND state = 'processing'`,
      )
      .run(Date.now(), receiptKey);
  }

  getInboundReceipt(receiptKey: string): InboundReceiptRecord | undefined {
    const row = this.database
      .prepare("SELECT * FROM channel_inbound_receipts WHERE receipt_key = ?")
      .get(receiptKey) as Record<string, unknown> | undefined;
    if (!row) return undefined;

    return {
      version: 1,
      generation: Number(row.generation),
      receiptKey: String(row.receipt_key),
      messageId: String(row.message_id),
      channelInstanceId: String(row.channel_instance_id),
      chatId: String(row.chat_id),
      userId: String(row.user_id),
      agentId: String(row.agent_id),
      state: row.state as InboundReceiptRecord["state"],
      normalizedText: String(row.normalized_text),
      attachmentIds: JSON.parse(String(row.attachment_ids)) as string[],
      outboundFinalIdempotencyKey:
        row.outbound_final_idempotency_key === null
          ? undefined
          : String(row.outbound_final_idempotency_key),
      receivedAt: Number(row.received_at),
      leaseUntil: row.lease_until === null ? undefined : Number(row.lease_until),
      channelType:
        row.channel_type === null ? undefined : String(row.channel_type),
      chatKind:
        row.chat_kind === null ? undefined : String(row.chat_kind),
    };
  }

  getOutboundDelivery(
    idempotencyKey: string,
  ): OutboundDeliveryRecord | undefined {
    const row = this.database
      .prepare(
        "SELECT * FROM channel_outbound_deliveries WHERE idempotency_key = ?",
      )
      .get(idempotencyKey) as Record<string, unknown> | undefined;
    if (!row) return undefined;

    return {
      version: 1,
      generation: Number(row.generation),
      idempotencyKey: String(row.idempotency_key),
      agentId: String(row.agent_id),
      channelInstanceId: String(row.channel_instance_id),
      chatId: String(row.chat_id),
      targetVisibility: row.target_visibility as "chat" | "private",
      targetUserId:
        row.target_user_id === null ? undefined : String(row.target_user_id),
      kind: row.kind as OutboundDeliveryRecord["kind"],
      payloadHash: String(row.payload_hash),
      encryptedPayload: {
        ciphertext: String(row.ciphertext),
        iv: String(row.iv),
        authTag: String(row.auth_tag),
      },
      state: row.state as OutboundDeliveryRecord["state"],
      platformMessageId:
        row.platform_message_id === null
          ? undefined
          : String(row.platform_message_id),
      updatedAt: Number(row.updated_at),
    };
  }

  decryptOutboundPayload(idempotencyKey: string): unknown {
    const record = this.getOutboundDelivery(idempotencyKey);
    if (!record) throw new Error("OUTBOUND_DELIVERY_NOT_FOUND");
    return this.crypto.decryptJson(record.encryptedPayload);
  }

  // -------------------------------------------------------------------------
  // Interaction Authorization CRUD
  // -------------------------------------------------------------------------

  /**
   * Persist an interaction authorization. Interaction value/raw event is
   * never persisted — only the authorization metadata.
   */
  authorizeInteraction(
    interactionId: string,
    generation: number,
    channelInstanceId: string,
    chatId: string,
    userId: string,
    valueHash: string,
    expiresAt: number,
  ): void {
    const authorizationKey = interactionAuthorizationKey(
      interactionId,
      generation,
      channelInstanceId,
      chatId,
      userId,
    );
    this.database
      .prepare(
        `INSERT OR IGNORE INTO channel_interaction_authorizations
         (authorization_key, interaction_id, generation, channel_instance_id,
          chat_id, user_id, value_hash, expires_at, consumed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        authorizationKey,
        interactionId,
        generation,
        channelInstanceId,
        chatId,
        userId,
        valueHash,
        expiresAt,
      );
  }

  /**
   * Atomically consume an interaction authorization exactly once.
   * Succeeds only when ALL of:
   *  - instance/chat/user/interaction/generation match the stored row
   *  - expires_at > now
   *  - consumed_at IS NULL
   *
   * On success, sets consumed_at = now and returns the record.
   * On any failure, returns undefined.
   */
  consumeInteraction(
    interactionId: string,
    generation: number,
    channelInstanceId: string,
    chatId: string,
    userId: string,
    valueHash: string,
    now: number,
  ): InteractionAuthorizationRecord | undefined {
    // Atomic CAS: update consumed_at only when all conditions match.
    const result = this.database
      .prepare(
        `UPDATE channel_interaction_authorizations
         SET consumed_at = ?
         WHERE authorization_key = ?
           AND value_hash = ?
           AND expires_at > ?
           AND consumed_at IS NULL`,
      )
      .run(
        now,
        interactionAuthorizationKey(
          interactionId,
          generation,
          channelInstanceId,
          chatId,
          userId,
        ),
        valueHash,
        now,
      );

    if (result.changes === 0) return undefined;

    return this.getInteractionAuthorizations(interactionId).find(
      (record) =>
        record.generation === generation &&
        record.channelInstanceId === channelInstanceId &&
        record.chatId === chatId &&
        record.userId === userId && record.valueHash === valueHash,
    );
  }

  getInteractionAuthorizations(
    interactionId: string,
  ): InteractionAuthorizationRecord[] {
    const rows = this.database
      .prepare(
        "SELECT * FROM channel_interaction_authorizations WHERE interaction_id = ?",
      )
      .all(interactionId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      version: 1,
      generation: Number(row.generation),
      interactionId: String(row.interaction_id),
      channelInstanceId: String(row.channel_instance_id),
      chatId: String(row.chat_id),
      userId: String(row.user_id),
      valueHash: String(row.value_hash),
      expiresAt: Number(row.expires_at),
      consumedAt: row.consumed_at === null ? null : Number(row.consumed_at),
    }));
  }

  private ensureSchema(): void {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.exec(`
        CREATE TABLE IF NOT EXISTS channel_session_bindings (
          binding_key TEXT PRIMARY KEY,
          version INTEGER NOT NULL,
          generation INTEGER NOT NULL,
          agent_id TEXT NOT NULL,
          channel_instance_id TEXT NOT NULL,
          chat_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS channel_inbound_receipts (
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
          channel_type TEXT,
          chat_kind TEXT,
          UNIQUE(channel_instance_id, chat_id, message_id)
        );
        CREATE TABLE IF NOT EXISTS channel_interaction_authorizations (
          authorization_key TEXT PRIMARY KEY,
          interaction_id TEXT NOT NULL,
          generation INTEGER NOT NULL,
          channel_instance_id TEXT NOT NULL,
          chat_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          value_hash TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          consumed_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_channel_interaction_id
          ON channel_interaction_authorizations(interaction_id);
        CREATE TABLE IF NOT EXISTS channel_notification_authorizations (
          authorization_key TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL,
          channel_instance_id TEXT NOT NULL,
          chat_id TEXT NOT NULL,
          user_id TEXT,
          enabled_at INTEGER NOT NULL,
          revoked_at INTEGER,
          expires_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS channel_stream_states (
          stream_id TEXT PRIMARY KEY,
          generation INTEGER NOT NULL,
          channel_instance_id TEXT NOT NULL,
          chat_id TEXT NOT NULL,
          last_sequence INTEGER NOT NULL,
          state TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS channel_outbound_deliveries (
          idempotency_key TEXT PRIMARY KEY,
          generation INTEGER NOT NULL,
          agent_id TEXT NOT NULL,
          channel_instance_id TEXT NOT NULL,
          chat_id TEXT NOT NULL,
          target_visibility TEXT NOT NULL,
          target_user_id TEXT,
          kind TEXT NOT NULL,
          payload_hash TEXT NOT NULL,
          ciphertext TEXT NOT NULL,
          iv TEXT NOT NULL,
          auth_tag TEXT NOT NULL,
          state TEXT NOT NULL,
          platform_message_id TEXT,
          updated_at INTEGER NOT NULL
        );
      `);

      // CREATE TABLE does not alter an existing installation. Keep these
      // additive migrations idempotent for databases created by earlier
      // Channel Runtime builds.
      const receiptColumns = this.database
        .prepare("PRAGMA table_info(channel_inbound_receipts)")
        .all() as Array<{ name: string }>;
      const names = new Set(receiptColumns.map((column) => column.name));
      if (!names.has("channel_type")) {
        this.database.exec(
          "ALTER TABLE channel_inbound_receipts ADD COLUMN channel_type TEXT",
        );
      }
      if (!names.has("chat_kind")) {
        this.database.exec(
          "ALTER TABLE channel_inbound_receipts ADD COLUMN chat_kind TEXT",
        );
      }

      // Additive migrations for channel_stream_states: final_idempotency_key, committed
      const streamColumns = this.database
        .prepare("PRAGMA table_info(channel_stream_states)")
        .all() as Array<{ name: string }>;
      const streamNames = new Set(streamColumns.map((c) => c.name));
      if (!streamNames.has("final_idempotency_key")) {
        this.database.exec(
          "ALTER TABLE channel_stream_states ADD COLUMN final_idempotency_key TEXT",
        );
      }
      if (!streamNames.has("committed")) {
        this.database.exec(
          "ALTER TABLE channel_stream_states ADD COLUMN committed INTEGER NOT NULL DEFAULT 0",
        );
      }

      // Additive migrations for channel_notification_authorizations: version, generation
      const authColumns = this.database
        .prepare("PRAGMA table_info(channel_notification_authorizations)")
        .all() as Array<{ name: string }>;
      const authNames = new Set(authColumns.map((c) => c.name));
      if (!authNames.has("version")) {
        this.database.exec(
          "ALTER TABLE channel_notification_authorizations ADD COLUMN version INTEGER NOT NULL DEFAULT 1",
        );
      }
      if (!authNames.has("generation")) {
        this.database.exec(
          "ALTER TABLE channel_notification_authorizations ADD COLUMN generation INTEGER NOT NULL DEFAULT 0",
        );
      }

      // Re-key rows created by pre-JSON authorization builds. If both a
      // legacy and canonical row exist, any revocation wins and the earliest
      // expiry is retained so migration cannot broaden authorization.
      const legacyAuthorizations = this.database
        .prepare("SELECT * FROM channel_notification_authorizations")
        .all() as Array<Record<string, unknown>>;
      for (const row of legacyAuthorizations) {
        const oldKey = String(row.authorization_key);
        const userId = row.user_id === null ? undefined : String(row.user_id);
        const canonicalKey = ChannelRuntimePersistence.notificationAuthorizationKey(
          String(row.agent_id),
          String(row.channel_instance_id),
          String(row.chat_id),
          userId,
        );
        if (oldKey === canonicalKey) continue;

        const canonical = this.database
          .prepare(
            "SELECT revoked_at, expires_at FROM channel_notification_authorizations WHERE authorization_key = ?",
          )
          .get(canonicalKey) as
          | { revoked_at: number | null; expires_at: number | null }
          | undefined;
        if (!canonical) {
          this.database
            .prepare(
              "UPDATE channel_notification_authorizations SET authorization_key = ? WHERE authorization_key = ?",
            )
            .run(canonicalKey, oldKey);
          continue;
        }

        const revokedValues = [canonical.revoked_at, row.revoked_at]
          .filter((value): value is number => typeof value === "number");
        const expiryValues = [canonical.expires_at, row.expires_at]
          .filter((value): value is number => typeof value === "number");
        this.database
          .prepare(
            `UPDATE channel_notification_authorizations
             SET revoked_at = ?, expires_at = ?
             WHERE authorization_key = ?`,
          )
          .run(
            revokedValues.length > 0 ? Math.max(...revokedValues) : null,
            expiryValues.length > 0 ? Math.min(...expiryValues) : null,
            canonicalKey,
          );
        this.database
          .prepare(
            "DELETE FROM channel_notification_authorizations WHERE authorization_key = ?",
          )
          .run(oldKey);
      }

      // Additive migrations for channel_interaction_authorizations: none required yet.
      // Future version/generation columns will be added here idempotently.

      this.database.exec("COMMIT");
    } catch {
      this.database.exec("ROLLBACK");
      throw new Error("CHANNEL_SCHEMA_INIT_FAILED");
    }
  }

  // -------------------------------------------------------------------------
  // Stream State CRUD
  // -------------------------------------------------------------------------

  upsertStreamState(record: StreamStateRecord): void {
    this.database
      .prepare(
        `INSERT OR REPLACE INTO channel_stream_states
         (stream_id, generation, channel_instance_id, chat_id,
          last_sequence, state, final_idempotency_key, committed, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.streamId,
        record.generation,
        record.channelInstanceId,
        record.chatId,
        record.lastSequence,
        record.state,
        record.finalIdempotencyKey ?? null,
        record.committed ? 1 : 0,
        record.updatedAt,
      );
  }

  getStreamState(streamId: string): StreamStateRecord | undefined {
    const row = this.database
      .prepare("SELECT * FROM channel_stream_states WHERE stream_id = ?")
      .get(streamId) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      version: 1,
      generation: Number(row.generation),
      streamId: String(row.stream_id),
      channelInstanceId: String(row.channel_instance_id),
      chatId: String(row.chat_id),
      lastSequence: Number(row.last_sequence),
      state: row.state as StreamStateRecord["state"],
      finalIdempotencyKey:
        row.final_idempotency_key === null
          ? undefined
          : String(row.final_idempotency_key),
      committed: Boolean(row.committed),
      updatedAt: Number(row.updated_at),
    };
  }

  listActiveStreams(): StreamStateRecord[] {
    const rows = this.database
      .prepare(
        "SELECT stream_id FROM channel_stream_states WHERE state = 'active' ORDER BY updated_at ASC",
      )
      .all() as Array<{ stream_id: string }>;
    return rows
      .map((r) => this.getStreamState(r.stream_id))
      .filter((s): s is StreamStateRecord => s !== undefined);
  }

  markStreamCompleted(
    streamId: string,
    finalIdempotencyKey: string,
  ): void {
    this.database
      .prepare(
        `UPDATE channel_stream_states
         SET state = 'completed', final_idempotency_key = ?, committed = 1, updated_at = ?
         WHERE stream_id = ?`,
      )
      .run(finalIdempotencyKey, Date.now(), streamId);
  }

  cancelActiveStreams(): void {
    this.database
      .prepare(
        `UPDATE channel_stream_states
         SET state = 'cancelled', updated_at = ?
         WHERE state = 'active'`,
      )
      .run(Date.now());
  }

  // -------------------------------------------------------------------------
  // Notification Authorization CRUD
  // -------------------------------------------------------------------------

  static notificationAuthorizationKey(
    agentId: string,
    channelInstanceId: string,
    chatId: string,
    userId?: string,
  ): string {
    return JSON.stringify([agentId, channelInstanceId, chatId, userId ?? null]);
  }

  authorizeNotification(record: NotificationAuthorizationRecord): void {
    this.database
      .prepare(
        `INSERT OR REPLACE INTO channel_notification_authorizations
         (authorization_key, version, generation, agent_id, channel_instance_id,
          chat_id, user_id, enabled_at, revoked_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        ChannelRuntimePersistence.notificationAuthorizationKey(
          record.agentId,
          record.channelInstanceId,
          record.chatId,
          record.userId,
        ),
        record.version,
        record.generation,
        record.agentId,
        record.channelInstanceId,
        record.chatId,
        record.userId ?? null,
        record.enabledAt,
        record.revokedAt ?? null,
        record.expiresAt ?? null,
      );
  }

  revokeNotificationAuthorization(
    agentId: string,
    channelInstanceId: string,
    chatId: string,
    userId?: string,
  ): void {
    const key = ChannelRuntimePersistence.notificationAuthorizationKey(
      agentId,
      channelInstanceId,
      chatId,
      userId,
    );
    this.database
      .prepare(
        `UPDATE channel_notification_authorizations
         SET revoked_at = ?
         WHERE authorization_key = ?`,
      )
      .run(Date.now(), key);
  }

  getNotificationAuthorization(
    agentId: string,
    channelInstanceId: string,
    chatId: string,
    userId?: string,
  ): NotificationAuthorizationRecord | undefined {
    const key = ChannelRuntimePersistence.notificationAuthorizationKey(
      agentId,
      channelInstanceId,
      chatId,
      userId,
    );
    const row = this.database
      .prepare(
        "SELECT * FROM channel_notification_authorizations WHERE authorization_key = ?",
      )
      .get(key) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      version: 1 as const,
      generation: Number(row.generation),
      agentId: String(row.agent_id),
      channelInstanceId: String(row.channel_instance_id),
      chatId: String(row.chat_id),
      userId: row.user_id === null ? undefined : String(row.user_id),
      enabledAt: Number(row.enabled_at),
      revokedAt:
        row.revoked_at === null ? undefined : Number(row.revoked_at),
      expiresAt:
        row.expires_at === null ? undefined : Number(row.expires_at),
    };
  }

  listActiveAuthorizations(): NotificationAuthorizationRecord[] {
    const now = Date.now();
    const rows = this.database
      .prepare(
        `SELECT authorization_key FROM channel_notification_authorizations
         WHERE revoked_at IS NULL
           AND (expires_at IS NULL OR expires_at > ?)
         ORDER BY enabled_at ASC`,
      )
      .all(now) as Array<{ authorization_key: string }>;
    return rows
      .map((r) => {
        const row = this.database
          .prepare(
            "SELECT * FROM channel_notification_authorizations WHERE authorization_key = ?",
          )
          .get(r.authorization_key) as Record<string, unknown> | undefined;
        if (!row) return undefined;
        const record: NotificationAuthorizationRecord = {
          version: 1 as const,
          generation: Number(row.generation),
          agentId: String(row.agent_id),
          channelInstanceId: String(row.channel_instance_id),
          chatId: String(row.chat_id),
          userId: row.user_id === null ? undefined : String(row.user_id),
          enabledAt: Number(row.enabled_at),
          revokedAt:
            row.revoked_at === null ? undefined : Number(row.revoked_at),
          expiresAt:
            row.expires_at === null ? undefined : Number(row.expires_at),
        };
        return record;
      })
      .filter((a): a is NotificationAuthorizationRecord => a !== undefined);
  }

  // -------------------------------------------------------------------------
  // Notification Outbox Helpers
  // -------------------------------------------------------------------------

  /**
   * List outbound deliveries of kind "notification" in a given state.
   * Used for outbox recovery — never returns plaintext.
   */
  listNotificationOutboxByState(
    state: OutboundDeliveryRecord["state"],
  ): OutboundDeliveryRecord[] {
    const rows = this.database
      .prepare(
        `SELECT idempotency_key FROM channel_outbound_deliveries
         WHERE kind = 'notification' AND state = ?
         ORDER BY updated_at ASC`,
      )
      .all(state) as Array<{ idempotency_key: string }>;
    return rows
      .map((r) => this.getOutboundDelivery(r.idempotency_key))
      .filter((d): d is OutboundDeliveryRecord => d !== undefined);
  }

  /**
   * List all notification outbound deliveries regardless of state.
   * Never returns plaintext — only encrypted payload references.
   */
  listAllNotificationOutbox(): OutboundDeliveryRecord[] {
    const rows = this.database
      .prepare(
        `SELECT idempotency_key FROM channel_outbound_deliveries
         WHERE kind = 'notification'
         ORDER BY updated_at ASC`,
      )
      .all() as Array<{ idempotency_key: string }>;
    return rows
      .map((r) => this.getOutboundDelivery(r.idempotency_key))
      .filter((d): d is OutboundDeliveryRecord => d !== undefined);
  }
}
