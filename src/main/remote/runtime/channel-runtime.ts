import { createHash } from "node:crypto";
import type {
  ChannelCommand,
  ChannelInteraction,
  DeliveryResult,
  OutboundMessage,
  UnifiedMessage,
} from "./contracts";
import type { ChannelAdapterConfig } from "./channel-adapter";
import type { ChannelConnectionStatus } from "./connection-manager";
import {
  evaluateMessagePolicy,
  type ChannelPolicyConfig,
  type CommandPolicyDecision,
  evaluateCommandPolicy,
  type PolicyDecision,
} from "./policy-engine";
import {
  SessionRouter,
  type ChannelSessionBinding,
  type SessionPersistencePort,
} from "./session-router";
import type {
  InboundReceiptRecord,
  InteractionAuthorizationRecord,
  OutboundDeliveryInput,
  OutboundDeliveryRecord,
  StreamStateRecord,
} from "./persistence";

// ---------------------------------------------------------------------------
// Execution context
// ---------------------------------------------------------------------------

export interface ReceiptContext {
  /** Deterministic key: `[instance,chat,message]` */
  receiptKey: string;
  /**
   * Deterministic final idempotency key for any outbound reply produced
   * by this Agent execution: `[agent,instance,chat,message,'reply']`
   */
  finalIdempotencyKey: string;
  /**
   * Deterministic turn ID derived from finalIdempotencyKey.
   * Used for routing the outbound assistant response back to the channel
   * and for SessionManager deduplication.
   */
  turnId: string;
}

export interface ExecuteAgentResult {
  /** Actual Agent session ID returned by startSession / continueSession */
  agentSessionId: string;
}

export type ChannelRuntimeExecuteFn = (
  binding: ChannelSessionBinding,
  message: UnifiedMessage,
  context: ReceiptContext,
) => Promise<ExecuteAgentResult | void>;

// ---------------------------------------------------------------------------
// Interaction types
// ---------------------------------------------------------------------------

export interface InteractionResult {
  /** Typed decision describing why the interaction was authorized or denied */
  decision:
    | "authorized"
    | "unauthorized_expired"
    | "unauthorized_wrong_user"
    | "unauthorized_wrong_chat"
    | "unauthorized_wrong_instance"
    | "unauthorized_wrong_generation"
    | "unauthorized_wrong_value"
    | "unauthorized_already_consumed"
    | "unauthorized_not_found"
    | "unhandled"
    | "failed";
}

export type ChannelRuntimeInteractionFn = (
  interaction: ChannelInteraction,
) => Promise<void>;

// ---------------------------------------------------------------------------
// Interaction persistence port
// ---------------------------------------------------------------------------

export interface InteractionPersistencePort {
  authorizeInteraction(
    interactionId: string,
    generation: number,
    channelInstanceId: string,
    chatId: string,
    userId: string,
    valueHash: string,
    expiresAt: number,
  ): void;
  consumeInteraction(
    interactionId: string,
    generation: number,
    channelInstanceId: string,
    chatId: string,
    userId: string,
    valueHash: string,
    now: number,
  ): InteractionAuthorizationRecord | undefined;
  getInteractionAuthorizations?(
    interactionId: string,
  ): InteractionAuthorizationRecord[];
}

// ---------------------------------------------------------------------------
// Persistence port (extended)
// ---------------------------------------------------------------------------

export interface ChannelRuntimePersistence {
  claimInboundReceipt?(input: InboundReceiptRecord): {
    accepted: boolean;
    receipt: InboundReceiptRecord | undefined;
  };
  completeInboundReceipt?(receiptKey: string): void;
  requeueExpiredReceipts(now?: number): number;
  getInboundReceipt?(receiptKey: string): InboundReceiptRecord | undefined;
  getOutboundDelivery?(
    idempotencyKey: string,
  ): OutboundDeliveryRecord | undefined;
  listRecoverableReceipts?(): InboundReceiptRecord[];
  abortProcessingReceipt?(receiptKey: string): void;
  claimOutboundDelivery?(input: OutboundDeliveryInput): boolean;
  createOutboundDelivery?(input: OutboundDeliveryInput): void;
  commitOutboundAndReceipt?(
    idempotencyKey: string,
    receiptKey: string,
    platformMessageId?: string,
  ): void;
  markOutboundCommitted?(idempotencyKey: string, platformMessageId?: string): void;
  markOutboundUnknown?(idempotencyKey: string): void;
  markOutboundFailed?(idempotencyKey: string): void;
  markOutboundFailedAndRejectReceipt?(idempotencyKey: string, receiptKey: string): void;
  cancelActiveStreams?(): void;
  getStreamState?(streamId: string): StreamStateRecord | undefined;
}

// ---------------------------------------------------------------------------
// Reconciliation callback
// ---------------------------------------------------------------------------

export type ReconcileUnknownDeliveryFn = (
  receipt: InboundReceiptRecord,
  delivery: OutboundDeliveryRecord,
) => Promise<void>;

/**
 * Recover an inbound message from a persisted receipt that was committed
 * (accepted past policy) before a crash. The runtime executes the message
 * through the persisted session binding without waiting for platform
 * redelivery.
 */
export type RecoverInboundMessageFn = (
  receipt: InboundReceiptRecord,
) => Promise<void>;

// ---------------------------------------------------------------------------
// Connection manager port
// ---------------------------------------------------------------------------

export interface ChannelRuntimeConnectionManager {
  connect(config: ChannelAdapterConfig): Promise<unknown>;
  disconnectAll(reason: string): Promise<void>;
  getAllStatus?: () => ChannelConnectionStatus[];
  send?(
    channelInstanceId: string,
    message: OutboundMessage,
  ): Promise<DeliveryResult>;
  lookupDelivery?(
    channelInstanceId: string,
    idempotencyKey: string,
    generation?: number,
  ): Promise<DeliveryResult | undefined>;
  /** Pause inbound message dispatch (gate callbacks until resume). */
  pauseIngress?: () => void;
  /** Resume inbound message dispatch and flush buffered messages. */
  resumeIngress?: () => void;
  /** Whether ingress is currently paused. */
  isIngressPaused?: boolean | (() => boolean);
}

export interface ChannelRuntimeOptions {
  agentId: string;
  policy: ChannelPolicyConfig;
  execute: ChannelRuntimeExecuteFn;
  connectionManager?: ChannelRuntimeConnectionManager;
  persistence?: ChannelRuntimePersistence;
  channels?: ChannelAdapterConfig[];
  /** Optional session-binding persistence (survives restart) */
  sessionPersistence?: SessionPersistencePort;
  /** Optional reconciliation callback for unknown deliveries at startup */
  reconcileUnknownDelivery?: ReconcileUnknownDeliveryFn;
  /**
   * Optional callback to recover and re-execute accepted inbound messages
   * from persisted receipts after a crash restart.
   */
  recoverInboundMessage?: RecoverInboundMessageFn;
  /** Optional interaction persistence for durable authorization/consumption */
  interactionPersistence?: InteractionPersistencePort;
  /** Optional callback to execute an authorized interaction */
  executeInteraction?: ChannelRuntimeInteractionFn;
  /**
   * Optional per-channel-instance policy overrides. When provided,
   * resolvePolicy(channelInstanceId) returns the instance-specific
   * policy, falling back to the default `policy` field.
   */
  instancePolicies?: Record<string, ChannelPolicyConfig>;
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

export class ChannelRuntime {
  private readonly sessions: SessionRouter;
  private started = false;
  private lifecycleQueue: Promise<void> = Promise.resolve();

  constructor(private readonly options: ChannelRuntimeOptions) {
    this.sessions = new SessionRouter({
      agentId: options.agentId,
      persistence: options.sessionPersistence,
    });
  }

  /**
   * Resolve the effective policy for a channel instance. When an
   * instance-specific override exists in `instancePolicies`, it is
   * returned; otherwise the runtime-wide default policy is used.
   */
  resolvePolicy(channelInstanceId: string): ChannelPolicyConfig {
    return this.options.instancePolicies?.[channelInstanceId] ?? this.options.policy;
  }

  /**
   * Serialize start and stop through a mutex queue so that concurrent
   * start/stop calls never race and stop always waits for any in-flight
   * startup to settle.
   */
  private enqueueLifecycle(op: () => Promise<void>): Promise<void> {
    const next = this.lifecycleQueue.then(op, op);
    this.lifecycleQueue = next.catch(() => undefined);
    return next;
  }

  async start(): Promise<void> {
    return this.enqueueLifecycle(async () => {
      if (this.started) return;
      await this.doStart();
    });
  }

  private async doStart(): Promise<void> {
    // 0. Pause ingress before connecting adapters so messages received
    //    during connection/recovery are buffered until recovery completes.
    this.options.connectionManager?.pauseIngress?.();

    if (this.options.persistence) {
      // 1. Cancel any active stream state left over from a previous crash.
      //    Incomplete active streams are marked cancelled — not resent.
      this.options.persistence.cancelActiveStreams?.();

      // 2. Reconcile processing receipts first (committed irrespective
      //    of lease; unknown callback irrespective of lease). Only abort
      //    when the lease has already expired AND no outbound row exists.
      if (this.options.persistence.listRecoverableReceipts) {
        const recoverable = this.options.persistence.listRecoverableReceipts();
        for (const receipt of recoverable) {
          if (
            receipt.outboundFinalIdempotencyKey &&
            receipt.state === "processing"
          ) {
            if (this.options.persistence.getOutboundDelivery) {
              const delivery = this.options.persistence.getOutboundDelivery(
                receipt.outboundFinalIdempotencyKey,
              );
              if (delivery) {
                if (delivery.state === "committed") {
                  this.options.persistence.completeInboundReceipt?.(
                    receipt.receiptKey,
                  );
                }
              } else {
                // Outbound row not created yet. Only abort back to
                // received when the lease has actually expired — never
                // abort a non-expired processing receipt merely because
                // its outbound row hasn't been written.
                if (
                  receipt.leaseUntil !== undefined &&
                  receipt.leaseUntil < Date.now()
                ) {
                  this.options.persistence.abortProcessingReceipt?.(
                    receipt.receiptKey,
                  );
                }
              }
            }
          }
        }
      }

      // 3. Requeue remaining expired receipts for lease recovery.
      this.options.persistence.requeueExpiredReceipts(Date.now());
    }

    try {
      if (this.options.connectionManager) {
        await Promise.all(
          (this.options.channels ?? []).map((channel) =>
            this.options.connectionManager?.connect(channel),
          ),
        );
      }
      await this.reconcileUnknownDeliveries();

      // 4. After adapters connect and expired receipts are requeued,
      //    recover accepted (received) receipts through persisted session.
      if (this.options.recoverInboundMessage && this.options.persistence?.listRecoverableReceipts) {
        const recoverable = this.options.persistence.listRecoverableReceipts();
        for (const receipt of recoverable) {
          if (receipt.state !== "received") continue;
          const claim = this.options.persistence.claimInboundReceipt?.({
            ...receipt,
            leaseUntil: Date.now() + 60_000,
          });
          if (claim?.accepted && claim.receipt) {
            await this.options.recoverInboundMessage(claim.receipt);
          }
        }
      }

      // 5. Resume ingress: flush any messages buffered during
      //    connection/recovery through the handlers now that the
      //    runtime is ready.
      this.options.connectionManager?.resumeIngress?.();

      this.started = true;
    } catch (error) {
      // Resume ingress even on failure so buffered messages are not lost.
      this.options.connectionManager?.resumeIngress?.();
      await this.options.connectionManager?.disconnectAll(
        "runtime_start_failed",
      );
      throw error;
    }
  }

  async reconcileUnknownDeliveries(): Promise<void> {
    const persistence = this.options.persistence;
    const reconcile = this.options.reconcileUnknownDelivery;
    if (!persistence?.listRecoverableReceipts || !persistence.getOutboundDelivery || !reconcile) {
      return;
    }
    for (const receipt of persistence.listRecoverableReceipts()) {
      if (receipt.state !== "processing" || !receipt.outboundFinalIdempotencyKey) {
        continue;
      }
      const delivery = persistence.getOutboundDelivery(
        receipt.outboundFinalIdempotencyKey,
      );
      if (delivery?.state === "unknown") {
        await reconcile(receipt, delivery);
      }
    }
  }

  async stop(): Promise<void> {
    return this.enqueueLifecycle(async () => {
      if (!this.started) return;
      // Pause ingress first so no new inbound messages are dispatched
      // while adapters disconnect.
      this.options.connectionManager?.pauseIngress?.();
      await this.options.connectionManager?.disconnectAll("runtime_stop");
      this.started = false;
    });
  }

  get isStarted(): boolean {
    return this.started;
  }

  getStatus(): ChannelConnectionStatus[] {
    return this.options.connectionManager?.getAllStatus?.() ?? [];
  }

  private get builtInCommands(): ReadonlySet<string> {
    return new Set(["whoami", "help"]);
  }

  async handleCommand(
    command: ChannelCommand,
  ): Promise<CommandPolicyDecision | PolicyDecision> {
    // Resolve per-instance policy
    const instancePolicy = this.resolvePolicy(
      command.message.channelInstanceId,
    );

    // Command policy applies to all commands (including built-ins)
    const commandDecision = evaluateCommandPolicy(
      command.name,
      instancePolicy,
    );
    if (!commandDecision.allowed) return commandDecision;

    // Message policy also applies to built-ins
    const messageDecision = evaluateMessagePolicy(
      command.message,
      instancePolicy,
    );
    if (!messageDecision.allowed) return messageDecision;

    // Built-ins handled without Agent execution
    if (this.builtInCommands.has(command.name)) {
      return this.handleBuiltInCommand(command);
    }

    // Unsupported commands may continue through normal Agent path
    return this.handleMessage(command.message);
  }

  private async handleBuiltInCommand(
    command: ChannelCommand,
  ): Promise<PolicyDecision> {
    const message = command.message;
    const cm = this.options.connectionManager;

    const receiptKey = JSON.stringify([
      message.channelInstanceId,
      message.chatId,
      message.id,
    ]);

    // Deterministic idempotency key for built-in reply
    const idempotencyKey = JSON.stringify([
      this.options.agentId,
      message.channelInstanceId,
      message.chatId,
      message.id,
      "builtin-reply",
    ]);

    const responseText = this.buildBuiltInResponse(command);
    const persistence = this.options.persistence;
    if (!cm?.send) return { allowed: true };

    if (persistence?.claimInboundReceipt) {
      const claim = persistence.claimInboundReceipt({
        version: 1,
        generation: message.generation,
        receiptKey,
        messageId: message.id,
        channelInstanceId: message.channelInstanceId,
        chatId: message.chatId,
        userId: message.userId,
        agentId: this.options.agentId,
        state: "received",
        normalizedText: message.text,
        attachmentIds: [],
        outboundFinalIdempotencyKey: idempotencyKey,
        receivedAt: message.timestamp,
        leaseUntil: Date.now() + 60_000,
        channelType: message.channelType,
        chatKind: message.chatKind,
      });
      if (!claim.accepted) return { allowed: true };
    }

    if (persistence?.claimOutboundDelivery) {
      const claimed = persistence.claimOutboundDelivery({
        version: 1,
        generation: message.generation,
        idempotencyKey,
        agentId: this.options.agentId,
        channelInstanceId: message.channelInstanceId,
        chatId: message.chatId,
        targetVisibility: "chat",
        kind: "reply",
        payload: { text: responseText },
        state: "pending",
      });
      if (!claimed) return { allowed: true };
    }

    if (cm?.send) {
      try {
        const result = await cm.send(message.channelInstanceId, {
          version: 1,
          generation: message.generation,
          idempotencyKey,
          target: {
            version: 1,
            channelType: message.channelType,
            channelInstanceId: message.channelInstanceId,
            chatId: message.chatId,
            visibility: "chat",
          },
          text: responseText,
          kind: "reply",
        });

        if (result.outcome === "committed") {
          persistence?.commitOutboundAndReceipt?.(
            idempotencyKey,
            receiptKey,
            result.platformMessageId,
          );
        } else if (result.outcome === "permanent_failure") {
          // Atomically mark outbound failed AND receipt rejected so the
          // duplicate detection path in handleMessage does not see a
          // lingering processing receipt.
          if (persistence?.markOutboundFailedAndRejectReceipt) {
            try {
              persistence.markOutboundFailedAndRejectReceipt(
                idempotencyKey,
                receiptKey,
              );
            } catch {
              // Fall back to independent operations on CAS failure.
              persistence?.markOutboundFailed?.(idempotencyKey);
              persistence?.completeInboundReceipt?.(receiptKey);
            }
          } else {
            persistence?.markOutboundFailed?.(idempotencyKey);
          }
        } else {
          persistence?.markOutboundUnknown?.(idempotencyKey);
        }
      } catch {
        persistence?.markOutboundUnknown?.(idempotencyKey);
      }
    }

    return { allowed: true };
  }

  private buildBuiltInResponse(command: ChannelCommand): string {
    if (command.name === "whoami") {
      return this.buildWhoamiResponse(command.message);
    }
    if (command.name === "help") {
      return this.buildHelpResponse();
    }
    return "Unknown built-in command.";
  }

  private buildWhoamiResponse(message: UnifiedMessage): string {
    const mask = (value: string): string => {
      if (value.length <= 4) return "****";
      return `****${value.slice(-4)}`;
    };
    return [
      `channel: ${message.channelType}`,
      `instance: ${mask(message.channelInstanceId)}`,
      `chat: ${mask(message.chatId)}`,
      `user: ${mask(message.userId)}`,
    ].join("\n");
  }

  private buildHelpResponse(): string {
    const builtIns = [...this.builtInCommands].sort();
    const allowed = [...(this.options.policy.allowedCommands ?? [])].sort();
    const lines = ["Built-in commands:"];
    for (const name of builtIns) {
      lines.push(`  /${name}`);
    }
    if (allowed.length > 0) {
      lines.push("");
      lines.push("Configured commands:");
      for (const name of allowed) {
        if (!this.builtInCommands.has(name)) {
          lines.push(`  /${name}`);
        }
      }
    }
    return lines.join("\n");
  }

  async handleMessage(message: UnifiedMessage): Promise<PolicyDecision> {
    const instancePolicy = this.resolvePolicy(message.channelInstanceId);
    const decision = evaluateMessagePolicy(message, instancePolicy);
    if (!decision.allowed) return decision;

    const binding = await this.sessions.resolveSession(message);

    // Derive deterministic receipt key: [instance, chat, message]
    const receiptKey = JSON.stringify([
      message.channelInstanceId,
      message.chatId,
      message.id,
    ]);

    // Derive deterministic final idempotency key for agent reply
    const finalIdempotencyKey = JSON.stringify([
      this.options.agentId,
      message.channelInstanceId,
      message.chatId,
      message.id,
      "reply",
    ]);

    // Atomically claim before execution
    if (this.options.persistence?.claimInboundReceipt) {
      const claim = this.options.persistence.claimInboundReceipt({
        version: 1,
        generation: message.generation,
        receiptKey,
        messageId: message.id,
        channelInstanceId: message.channelInstanceId,
        chatId: message.chatId,
        userId: message.userId,
        agentId: this.options.agentId,
        state: "received",
        normalizedText: message.text,
        attachmentIds: message.attachments.map((a) => a.id),
        outboundFinalIdempotencyKey: finalIdempotencyKey,
        receivedAt: message.timestamp,
        leaseUntil: Date.now() + 60_000,
        channelType: message.channelType,
        chatKind: message.chatKind,
      });

      const receipt = claim.receipt;
      if (!claim.accepted && receipt) {
        // Duplicate: skip if completed or rejected
        if (receipt.state === "completed" || receipt.state === "rejected") {
          return decision;
        }
        // If processing with unexpired lease, skip
        if (
          receipt.state === "processing" &&
          receipt.leaseUntil !== undefined &&
          receipt.leaseUntil >= Date.now()
        ) {
          return decision;
        }
        // Once an outbound record exists, never rerun the Agent. Committed
        // and unknown outcomes are recovered from the outbox; pending/failed
        // records require delivery handling or operator review.
        const existingDelivery = receipt.outboundFinalIdempotencyKey
          ? this.options.persistence.getOutboundDelivery?.(
              receipt.outboundFinalIdempotencyKey,
            )
          : undefined;
        if (existingDelivery) {
          if (existingDelivery.state === "committed") {
            this.options.persistence.completeInboundReceipt?.(
              receipt.receiptKey,
            );
          } else if (
            existingDelivery.state === "unknown" &&
            this.options.reconcileUnknownDelivery
          ) {
            await this.options.reconcileUnknownDelivery(
              receipt,
              existingDelivery,
            );
          }
          return decision;
        }

        // No outbound side effect exists and the lease expired: re-claim.
        this.options.persistence.abortProcessingReceipt?.(receipt.receiptKey);
        const reClaim = this.options.persistence.claimInboundReceipt({
          ...receipt,
          state: "received",
          receiptKey,
          leaseUntil: Date.now() + 60_000,
        });
        if (!reClaim.accepted) return decision;
      }
    }

    const turnId = finalIdempotencyKey;
    const context: ReceiptContext = { receiptKey, finalIdempotencyKey, turnId };

    await this.sessions.enqueue(binding, async () => {
      // A previous queued turn may have replaced the placeholder with the
      // persisted Agent session ID while this turn was waiting.
      const currentBinding = await this.sessions.resolveSession(message);
      const result = await this.options.execute(
        currentBinding,
        message,
        context,
      );
      if (
        result?.agentSessionId &&
        result.agentSessionId !== currentBinding.sessionId
      ) {
        this.sessions.replaceSessionBinding(
          currentBinding,
          result.agentSessionId,
        );
      }
    });
    return decision;
  }

  /**
   * Execute an already-accepted message from a persisted receipt during
   * crash recovery. Bypasses policy evaluation (already passed) and
   * uses the pre-existing receipt identity.
   */
  async executeAcceptedMessage(
    message: UnifiedMessage,
    receipt: InboundReceiptRecord,
  ): Promise<void> {
    const binding = await this.sessions.resolveSession(message);

    const context: ReceiptContext = {
      receiptKey: receipt.receiptKey,
      finalIdempotencyKey: receipt.outboundFinalIdempotencyKey ?? JSON.stringify([
        this.options.agentId,
        message.channelInstanceId,
        message.chatId,
        message.id,
        "reply",
      ]),
      turnId: receipt.outboundFinalIdempotencyKey ?? JSON.stringify([
        this.options.agentId,
        message.channelInstanceId,
        message.chatId,
        message.id,
        "reply",
      ]),
    };

    await this.sessions.enqueue(binding, async () => {
      const currentBinding = await this.sessions.resolveSession(message);
      const result = await this.options.execute(
        currentBinding,
        message,
        context,
      );
      if (
        result?.agentSessionId &&
        result.agentSessionId !== currentBinding.sessionId
      ) {
        this.sessions.replaceSessionBinding(
          currentBinding,
          result.agentSessionId,
        );
      }
    });
  }

  async resolveSession(
    message: UnifiedMessage,
  ): Promise<ChannelSessionBinding> {
    return this.sessions.resolveSession(message);
  }

  // -------------------------------------------------------------------------
  // Interaction authorization
  // -------------------------------------------------------------------------

  /**
   * Persist an interaction authorization. Does NOT store the interaction
   * value or raw event — only the authorization metadata (id, instance,
   * chat, user, generation, expiry).
   */
  authorizeInteraction(interaction: ChannelInteraction): void {
    this.options.interactionPersistence?.authorizeInteraction(
      interaction.id,
      interaction.generation,
      interaction.channelInstanceId,
      interaction.chatId,
      interaction.userId,
      hashInteractionValue(interaction.value),
      interaction.expiresAt,
    );
  }

  /**
   * Atomically consume an interaction authorization exactly once, then
   * call the executeInteraction callback when authorized. Returns a typed
   * decision/result without Agent execution when unauthorized.
   *
   * Authorized only when ALL of:
   *  - instance/chat/user/interaction/generation match the persisted row
   *  - expiresAt > now
   *  - consumed_at is NULL
   */
  async handleInteraction(
    interaction: ChannelInteraction,
  ): Promise<InteractionResult> {
    const ip = this.options.interactionPersistence;
    if (!ip) return { decision: "unauthorized_not_found" };
    if (!this.options.executeInteraction) return { decision: "unhandled" };

    const now = Date.now();
    const record = ip.consumeInteraction(
      interaction.id,
      interaction.generation,
      interaction.channelInstanceId,
      interaction.chatId,
      interaction.userId,
      hashInteractionValue(interaction.value),
      now,
    );

    if (!record) {
      // Determine why consumption failed. Check for the row to produce a
      // precise decision.
      const records = ip.getInteractionAuthorizations?.(interaction.id) ?? [];
      if (records.length === 0) return { decision: "unauthorized_not_found" };
      const sameInstance = records.find(
        (item) => item.channelInstanceId === interaction.channelInstanceId,
      );
      if (!sameInstance) return { decision: "unauthorized_wrong_instance" };
      const sameChat = records.find(
        (item) =>
          item.channelInstanceId === interaction.channelInstanceId &&
          item.chatId === interaction.chatId,
      );
      if (!sameChat) return { decision: "unauthorized_wrong_chat" };
      const sameUser = records.find(
        (item) =>
          item.channelInstanceId === interaction.channelInstanceId &&
          item.chatId === interaction.chatId &&
          item.userId === interaction.userId,
      );
      if (!sameUser) return { decision: "unauthorized_wrong_user" };
      const sameGeneration = records.find(
        (item) =>
          item.channelInstanceId === interaction.channelInstanceId &&
          item.chatId === interaction.chatId &&
          item.userId === interaction.userId &&
          item.generation === interaction.generation,
      );
      if (!sameGeneration) {
        return { decision: "unauthorized_wrong_generation" };
      }
      if (sameGeneration.valueHash !== hashInteractionValue(interaction.value)) {
        return { decision: "unauthorized_wrong_value" };
      }
      if (sameGeneration.consumedAt !== null) {
        return { decision: "unauthorized_already_consumed" };
      }
      if (sameGeneration.expiresAt <= now) {
        return { decision: "unauthorized_expired" };
      }
      return { decision: "unauthorized_not_found" };
    }

    try {
      await this.options.executeInteraction(interaction);
      return { decision: "authorized" };
    } catch {
      // The authorization remains consumed: callback failure may have an
      // ambiguous side effect and must not be replayed automatically.
      return { decision: "failed" };
    }
  }
}

function hashInteractionValue(value: unknown): string {
  const serialized = JSON.stringify(value) ?? "undefined";
  return createHash("sha256").update(serialized, "utf8").digest("hex");
}
