import type { ChannelAdapter } from "./channel-adapter";
import type { ChannelTarget, DeliveryResult } from "./contracts";
import type { ChannelRuntimePersistence } from "./persistence";

export interface NotificationAuthorization {
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

export interface NotificationRequest {
  agentId: string;
  sourceEventId: string;
  generation: number;
  target: ChannelTarget;
  text: string;
}

export class NotificationRouter {
  private readonly authorizations = new Map<string, NotificationAuthorization>();
  private readonly committed = new Set<string>();
  private readonly inFlight = new Map<string, Promise<DeliveryResult>>();
  private readonly persistence?: ChannelRuntimePersistence;
  private initialized = false;

  constructor(
    private readonly resolveAdapter: (
      channelInstanceId: string,
    ) => ChannelAdapter | undefined,
    persistence?: ChannelRuntimePersistence,
  ) {
    this.persistence = persistence;
  }

  /**
   * Hydrate active authorizations from persistence. Converts leftover
   * pending notification outbox records to unknown (crash ambiguity)
   * and hydrates committed-only dedupe keys. Unknown/pending records
   * never automatically resend.
   *
   * Idempotent — subsequent calls are no-ops. Must be called explicitly
   * when persistence is used, before ingress is accepted.
   */
  initialize(): void {
    if (this.initialized) return;
    this.initialized = true;
    if (!this.persistence) return;

    // Convert leftover pending notification outbox to unknown.
    // A pending record at startup means a crash happened before we
    // committed the outcome — we cannot know if the platform accepted
    // the message. Mark them unknown so they never auto-resend.
    const pendingNotifications =
      this.persistence.listNotificationOutboxByState("pending");
    for (const delivery of pendingNotifications) {
      this.persistence.markOutboundUnknown(delivery.idempotencyKey);
    }

    // Hydrate active authorizations from persistence.
    const persisted = this.persistence.listActiveAuthorizations();
    for (const record of persisted) {
      const auth: NotificationAuthorization = {
        version: 1,
        generation: record.generation,
        agentId: record.agentId,
        channelInstanceId: record.channelInstanceId,
        chatId: record.chatId,
        userId: record.userId,
        enabledAt: record.enabledAt,
        revokedAt: record.revokedAt,
        expiresAt: record.expiresAt,
      };
      this.authorizations.set(this.authorizationKey(auth), auth);
    }

    // Hydrate committed notification outbox keys for dedupe across
    // restart. Only committed records guarantee the platform accepted
    // the message.
    const committedNotifications =
      this.persistence.listNotificationOutboxByState("committed");
    for (const delivery of committedNotifications) {
      this.committed.add(delivery.idempotencyKey);
    }
  }

  /**
   * Clear all in-memory state (authorizations, committed set, in-flight).
   * Called on bootstrap stop / re-initialize so stale state does not leak
   * across lifecycles.
   */
  clear(): void {
    this.authorizations.clear();
    this.committed.clear();
    this.inFlight.clear();
    this.initialized = false;
  }

  authorize(authorization: NotificationAuthorization): void {
    this.authorizations.set(this.authorizationKey(authorization), authorization);
    if (this.persistence) {
      this.persistence.authorizeNotification({
        version: 1,
        generation: authorization.generation,
        agentId: authorization.agentId,
        channelInstanceId: authorization.channelInstanceId,
        chatId: authorization.chatId,
        userId: authorization.userId,
        enabledAt: authorization.enabledAt,
        revokedAt: authorization.revokedAt,
        expiresAt: authorization.expiresAt,
      });
    }
  }

  revoke(
    agentId: string,
    channelInstanceId: string,
    chatId: string,
    userId?: string,
  ): void {
    const key = this.authorizationKey({
      version: 1,
      generation: 0,
      agentId,
      channelInstanceId,
      chatId,
      userId,
      enabledAt: 0,
    });
    const existing = this.authorizations.get(key);
    if (existing) {
      this.authorizations.set(key, { ...existing, revokedAt: Date.now() });
    }
    if (this.persistence) {
      this.persistence.revokeNotificationAuthorization(
        agentId,
        channelInstanceId,
        chatId,
        userId,
      );
    }
  }

  async notify(request: NotificationRequest): Promise<DeliveryResult> {
    const authorization = this.findAuthorization(request);
    if (
      !authorization ||
      authorization.generation !== request.generation ||
      authorization.revokedAt !== undefined ||
      (authorization.expiresAt !== undefined &&
        authorization.expiresAt <= Date.now())
    ) {
      throw new Error("NOTIFICATION_TARGET_UNAUTHORIZED");
    }
    if (
      request.target.visibility === "private" &&
      authorization.userId !== request.target.userId
    ) {
      throw new Error("NOTIFICATION_TARGET_UNAUTHORIZED");
    }

    const adapter = this.resolveAdapter(request.target.channelInstanceId);
    if (!adapter) throw new Error("CHANNEL_INSTANCE_UNAVAILABLE");
    if (
      adapter.generation !== request.generation ||
      adapter.channelType !== request.target.channelType
    ) {
      throw new Error("STALE_CHANNEL_GENERATION");
    }

    const deliveryIdempotencyKey = this.deliveryKey(request);

    // Check durable committed state from persistence (survives restart).
    if (this.committed.has(deliveryIdempotencyKey)) {
      return {
        version: 1,
        generation: request.generation,
        accepted: true,
        committed: true,
        outcome: "committed",
        idempotencyKey: deliveryIdempotencyKey,
      };
    }

    // Concurrent same-key notifications share one in-flight send.
    // Must check before persistence to allow active in-flight coalesce.
    const inFlight = this.inFlight.get(deliveryIdempotencyKey);
    if (inFlight) return inFlight;

    if (this.persistence?.claimOutboundDelivery) {
      // Atomic claim: two routers sharing one DB cannot both claim.
      const claimed = this.persistence.claimOutboundDelivery({
        version: 1,
        generation: request.generation,
        idempotencyKey: deliveryIdempotencyKey,
        agentId: request.agentId,
        channelInstanceId: request.target.channelInstanceId,
        chatId: request.target.chatId,
        targetVisibility: request.target.visibility,
        targetUserId:
          request.target.visibility === "private"
            ? request.target.userId
            : undefined,
        kind: "notification",
        payload: { text: request.text },
        state: "pending",
      });

      if (!claimed) {
        // Another router (or a previous lifecycle) already claimed this key.
        const existing = this.persistence.getOutboundDelivery(
          deliveryIdempotencyKey,
        );
        if (existing?.state === "committed") {
          this.committed.add(deliveryIdempotencyKey);
          return {
            version: 1,
            generation: request.generation,
            accepted: true,
            committed: true,
            outcome: "committed",
            idempotencyKey: deliveryIdempotencyKey,
            platformMessageId: existing.platformMessageId,
          };
        }
        if (existing?.state === "failed") {
          throw new Error("NOTIFICATION_PERMANENTLY_FAILED");
        }
        // pending, unknown — never automatically resent
        throw new Error("NOTIFICATION_OUTCOME_INDETERMINATE");
      }
    } else if (this.persistence) {
      // Non-atomic fallback: check then create.
      const existing = this.persistence.getOutboundDelivery(
        deliveryIdempotencyKey,
      );
      if (existing) {
        if (existing.state === "committed") {
          this.committed.add(deliveryIdempotencyKey);
          return {
            version: 1,
            generation: request.generation,
            accepted: true,
            committed: true,
            outcome: "committed",
            idempotencyKey: deliveryIdempotencyKey,
            platformMessageId: existing.platformMessageId,
          };
        }
        if (existing.state === "failed") {
          throw new Error("NOTIFICATION_PERMANENTLY_FAILED");
        }
        // pending, unknown — never automatically resent without
        // explicit adapter lookup confirmation.
        throw new Error("NOTIFICATION_OUTCOME_INDETERMINATE");
      }
      // Create pending record before send (non-atomic window between
      // check and create, but single-bootstrap-owner is the common case).
      this.persistence.createOutboundDelivery({
        version: 1,
        generation: request.generation,
        idempotencyKey: deliveryIdempotencyKey,
        agentId: request.agentId,
        channelInstanceId: request.target.channelInstanceId,
        chatId: request.target.chatId,
        targetVisibility: request.target.visibility,
        targetUserId:
          request.target.visibility === "private"
            ? request.target.userId
            : undefined,
        kind: "notification",
        payload: { text: request.text },
        state: "pending",
      });
    }

    if (this.persistence) {
      // Outbound row already created (via atomic claim or fallback).
      // Defer the send so concurrent same-key requests share one operation.
      const delivery = Promise.resolve().then(() =>
        this.sendIfCurrent(request, deliveryIdempotencyKey, adapter),
      );
      this.inFlight.set(deliveryIdempotencyKey, delivery);

      try {
        const result = await delivery;
        await this.handleNotifyResult(
          request,
          deliveryIdempotencyKey,
          result,
        );
        return result;
      } catch {
        this.persistence.markOutboundUnknown(deliveryIdempotencyKey);
        throw new Error("NOTIFICATION_DELIVERY_UNKNOWN");
      } finally {
        if (this.inFlight.get(deliveryIdempotencyKey) === delivery) {
          this.inFlight.delete(deliveryIdempotencyKey);
        }
      }
    }

    // Without persistence: direct adapter.send with in-flight coalesce.
    const delivery = this.sendIfCurrent(
      request,
      deliveryIdempotencyKey,
      adapter,
    );
    this.inFlight.set(deliveryIdempotencyKey, delivery);
    try {
      const result = await delivery;
      if (result.outcome === "committed") this.committed.add(deliveryIdempotencyKey);
      return result;
    } finally {
      if (this.inFlight.get(deliveryIdempotencyKey) === delivery) {
        this.inFlight.delete(deliveryIdempotencyKey);
      }
    }
  }

  private async sendIfCurrent(
    request: NotificationRequest,
    key: string,
    adapter: ChannelAdapter,
  ): Promise<DeliveryResult> {
    if (this.resolveAdapter(request.target.channelInstanceId) !== adapter) {
      throw new Error("STALE_CHANNEL_GENERATION");
    }
    const result = await adapter.send({
      version: 1,
      generation: request.generation,
      idempotencyKey: key,
      target: request.target,
      text: request.text,
      kind: "notification",
    });
    if (this.resolveAdapter(request.target.channelInstanceId) !== adapter) {
      return {
        version: 1,
        generation: request.generation,
        accepted: false,
        committed: false,
        outcome: "unknown",
        idempotencyKey: key,
        errorCode: "CHANNEL_CONNECTION_SUPERSEDED",
      };
    }
    return result;
  }

  private async handleNotifyResult(
    request: NotificationRequest,
    key: string,
    result: DeliveryResult,
  ): Promise<void> {
    if (result.outcome === "committed") {
      this.committed.add(key);
      if (this.persistence) {
        this.persistence.markOutboundCommitted(key, result.platformMessageId);
      }
      return;
    }

    if (result.outcome === "permanent_failure") {
      if (this.persistence) this.persistence.markOutboundFailed(key);
      return;
    }

    if (result.outcome === "retryable_failure") {
      // Revalidate authorization before retry: authorization may have been
      // revoked, expired, or the adapter generation may have changed since
      // the initial send.
      const auth = this.findAuthorization(request);
      if (
        !auth ||
        auth.generation !== request.generation ||
        auth.revokedAt !== undefined ||
        (auth.expiresAt !== undefined && auth.expiresAt <= Date.now())
      ) {
        if (this.persistence) this.persistence.markOutboundFailed(key);
        return;
      }
      if (
        request.target.visibility === "private" &&
        auth.userId !== request.target.userId
      ) {
        if (this.persistence) this.persistence.markOutboundFailed(key);
        return;
      }

      const adapter = this.resolveAdapter(request.target.channelInstanceId);
      if (
        !adapter ||
        adapter.generation !== request.generation ||
        adapter.channelType !== request.target.channelType
      ) {
        if (this.persistence) this.persistence.markOutboundFailed(key);
        return;
      }

      try {
        const retry = await this.sendIfCurrent(request, key, adapter);
        if (retry.outcome === "committed") {
          this.committed.add(key);
          if (this.persistence) {
            this.persistence.markOutboundCommitted(
              key,
              retry.platformMessageId,
            );
          }
          return;
        }
        if (retry.outcome === "permanent_failure") {
          if (this.persistence) this.persistence.markOutboundFailed(key);
          return;
        }
      } catch {
        // Retry threw — fall through to unknown.
      }
    }

    // accepted, unknown, or a second retryable failure: indeterminate outcome.
    if (this.persistence) this.persistence.markOutboundUnknown(key);
  }

  private findAuthorization(
    request: NotificationRequest,
  ): NotificationAuthorization | undefined {
    const exact = this.authorizations.get(
      this.authorizationKey({
        version: 1,
        generation: request.generation,
        agentId: request.agentId,
        channelInstanceId: request.target.channelInstanceId,
        chatId: request.target.chatId,
        userId:
          request.target.visibility === "private"
            ? request.target.userId
            : undefined,
        enabledAt: 0,
      }),
    );
    if (exact) return exact;
    if (request.target.visibility === "chat") {
      return this.authorizations.get(
        this.authorizationKey({
          version: 1,
          generation: request.generation,
          agentId: request.agentId,
          channelInstanceId: request.target.channelInstanceId,
          chatId: request.target.chatId,
          enabledAt: 0,
        }),
      );
    }
    return undefined;
  }

  private authorizationKey(authorization: NotificationAuthorization): string {
    return JSON.stringify([
      authorization.agentId,
      authorization.channelInstanceId,
      authorization.chatId,
      authorization.userId ?? null,
    ]);
  }

  private deliveryKey(request: NotificationRequest): string {
    return JSON.stringify([
      request.agentId,
      request.target.channelInstanceId,
      request.target.chatId,
      request.generation,
      request.target.visibility,
      request.target.visibility === "private" ? request.target.userId : null,
      request.sourceEventId,
    ]);
  }
}
