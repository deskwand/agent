import type {
  ChannelAdapter,
  ChannelAdapterConfig,
} from "./channel-adapter";
import type {
  ChannelCommand,
  ChannelInteraction,
  ChannelPairingEvent,
  ChannelStatusEvent,
  DeliveryResult,
  InboundAttachment,
  OutboundMessage,
  ReactionEvent,
  UnifiedMessage,
} from "./contracts";
import type { AttachmentSource } from "./contracts";
import type { ChannelRegistry } from "./channel-registry";
import type { AttachmentStore } from "./attachment-store";

export interface ConnectionManagerHandlers {
  onMessage?: (message: UnifiedMessage) => void;
  onCommand?: (command: ChannelCommand) => void;
  onInteraction?: (interaction: ChannelInteraction) => void;
  onReaction?: (reaction: ReactionEvent) => void;
  onPairing?: (event: ChannelPairingEvent) => void;
  onStatus?: (status: ChannelStatusEvent) => void;
  onError?: (error: Error) => void;
}

export interface ChannelConnectionStatus {
  version: 1;
  channelType: ChannelAdapterConfig["channelType"];
  channelInstanceId: string;
  generation: number;
  state: ChannelStatusEvent["state"];
  errorCode?: string;
  retryAt?: number;
  timestamp: number;
}

interface ActiveConnection {
  adapter: ChannelAdapter;
  config: ChannelAdapterConfig;
  status: ChannelConnectionStatus;
  unsubscribers: Array<() => void>;
}

const DEFAULT_DRAIN_TIMEOUT_MS = 5_000;

export class ConnectionManager {
  private readonly active = new Map<string, ActiveConnection>();
  private readonly generations = new Map<string, number>();
  private ingressPaused = false;
  private readonly pausedInbound: UnifiedMessage[] = [];

  constructor(
    private readonly registry: ChannelRegistry,
    private readonly handlers: ConnectionManagerHandlers = {},
    private readonly attachmentStore?: AttachmentStore,
  ) {}

  /**
   * Pause ingress: inbound messages and commands are buffered until
   * resumeIngress() is called. Use during startup/recovery before
   * the ChannelRuntime is ready to process messages.
   */
  pauseIngress(): void {
    this.ingressPaused = true;
  }

  /**
   * Resume ingress and flush all buffered messages through the handlers.
   * Messages buffered during the pause period are processed in FIFO order
   * after any already-queued microtasks.
   */
  resumeIngress(): void {
    this.ingressPaused = false;
    const buffered = this.pausedInbound.splice(0);
    for (const message of buffered) {
      this.dispatchToHandlers(message);
    }
  }

  private dispatchToHandlers(message: UnifiedMessage): void {
    const parsed = parseCommandFromMessage(message);
    if (parsed) {
      this.handlers.onCommand?.(parsed);
    } else {
      this.handlers.onMessage?.(message);
    }
  }

  get isIngressPaused(): boolean {
    return this.ingressPaused;
  }

  async connect(config: ChannelAdapterConfig): Promise<ChannelConnectionStatus> {
    const existing = this.active.get(config.channelInstanceId);
    if (existing) {
      await this.disconnect(config.channelInstanceId, "reconnect");
    }

    const generation = (this.generations.get(config.channelInstanceId) ?? 0) + 1;
    this.generations.set(config.channelInstanceId, generation);
    const adapter = this.registry.create(config, generation);
    const status = this.makeStatus(config, generation, "starting");
    const connection: ActiveConnection = {
      adapter,
      config,
      status,
      unsubscribers: [],
    };
    this.active.set(config.channelInstanceId, connection);
    this.subscribe(connection);
    this.emitStatus(status);

    try {
      await adapter.connect(new AbortController().signal);
      if (this.active.get(config.channelInstanceId) !== connection) {
        await adapter.disconnect({ reason: "superseded", timeoutMs: 0 });
        throw new Error("CHANNEL_CONNECTION_SUPERSEDED");
      }
      if (adapter.connected) {
        connection.status = this.makeStatus(config, generation, "connected");
        this.emitStatus(connection.status);
      }
      return connection.status;
    } catch (error) {
      if (this.active.get(config.channelInstanceId) !== connection) {
        throw error;
      }
      connection.status = this.makeStatus(config, generation, "failed", {
        errorCode: error instanceof Error ? error.message : "CHANNEL_CONNECT_FAILED",
      });
      this.emitStatus(connection.status);
      throw error;
    }
  }

  async sync(config: ChannelAdapterConfig): Promise<ChannelConnectionStatus> {
    await this.disconnect(config.channelInstanceId, "configuration_changed");
    return this.connect(config);
  }

  async disconnect(
    channelInstanceId: string,
    reason: string,
    timeoutMs = DEFAULT_DRAIN_TIMEOUT_MS,
  ): Promise<void> {
    const connection = this.active.get(channelInstanceId);
    if (!connection) return;

    connection.status = this.makeStatus(
      connection.config,
      connection.adapter.generation,
      "draining",
    );
    this.emitStatus(connection.status);
    for (const unsubscribe of connection.unsubscribers.splice(0)) {
      unsubscribe();
    }

    this.attachmentStore?.unregisterGeneration(
      channelInstanceId,
      connection.adapter.generation,
    );

    const disconnectPromise = connection.adapter.disconnect({ reason, timeoutMs });
    await Promise.race([
      disconnectPromise,
      new Promise<void>((resolve) => {
        setTimeout(resolve, timeoutMs);
      }),
    ]);
    if (this.active.get(channelInstanceId) !== connection) return;
    connection.status = this.makeStatus(
      connection.config,
      connection.adapter.generation,
      "stopped",
    );
    this.emitStatus(connection.status);
    this.active.delete(channelInstanceId);
  }

  async disconnectAll(reason: string): Promise<void> {
    await Promise.all(
      [...this.active.keys()].map((channelInstanceId) =>
        this.disconnect(channelInstanceId, reason),
      ),
    );
  }

  getStatus(channelInstanceId: string): ChannelConnectionStatus | undefined {
    return this.active.get(channelInstanceId)?.status;
  }

  getAllStatus(): ChannelConnectionStatus[] {
    return [...this.active.values()].map((connection) => connection.status);
  }

  /**
   * Send an outbound message through the active adapter for the given
   * channel instance. Throws if the instance is not connected.
   *
   * Generation-safe: validates that the current active connection matches
   * the generation expected by the caller.
   */
  async send(
    channelInstanceId: string,
    message: OutboundMessage,
  ): Promise<DeliveryResult> {
    const connection = this.active.get(channelInstanceId);
    if (!connection) {
      return {
        version: 1,
        generation: message.generation,
        accepted: false,
        committed: false,
        outcome: "permanent_failure",
        idempotencyKey: message.idempotencyKey,
        errorCode: "CHANNEL_NOT_CONNECTED",
      };
    }

    // Generation check: reject if the message's generation doesn't match
    if (message.generation !== connection.adapter.generation) {
      return {
        version: 1,
        generation: message.generation,
        accepted: false,
        committed: false,
        outcome: "permanent_failure",
        idempotencyKey: message.idempotencyKey,
        errorCode: "CHANNEL_GENERATION_MISMATCH",
      };
    }

    try {
      const result = await connection.adapter.send(message);

      // Revalidate that the connection hasn't been superseded during send
      if (this.active.get(channelInstanceId) !== connection) {
        return {
          version: 1,
          generation: message.generation,
          accepted: false,
          committed: false,
          outcome: "unknown",
          idempotencyKey: message.idempotencyKey,
          errorCode: "CHANNEL_CONNECTION_SUPERSEDED",
        };
      }

      return result;
    } catch {
      return {
        version: 1,
        generation: message.generation,
        accepted: false,
        committed: false,
        outcome: "unknown",
        idempotencyKey: message.idempotencyKey,
        errorCode: "CHANNEL_SEND_OUTCOME_UNKNOWN",
      };
    }
  }

  /**
   * Resolve the currently active ChannelAdapter for a given instance.
   * Returns undefined when the instance is not connected. This is a narrow
   * generation-safe accessor — the caller receives the current adapter
   * snapshot. Used by NotificationRouter for delivery dispatch.
   */
  resolveAdapter(channelInstanceId: string): ChannelAdapter | undefined {
    return this.active.get(channelInstanceId)?.adapter;
  }

  /**
   * Look up a delivery result by idempotency key using the current active
   * adapter. Generation-safe: only considers the currently active connection.
   */
  async lookupDelivery(
    channelInstanceId: string,
    idempotencyKey: string,
    generation?: number,
  ): Promise<DeliveryResult | undefined> {
    const connection = this.active.get(channelInstanceId);
    if (!connection) return undefined;
    if (
      generation !== undefined &&
      connection.adapter.generation !== generation
    ) {
      return undefined;
    }
    if (!connection.adapter.lookupDelivery) return undefined;

    try {
      const result = await connection.adapter.lookupDelivery(idempotencyKey);
      if (this.active.get(channelInstanceId) !== connection) return undefined;
      return result;
    } catch {
      return undefined;
    }
  }

  private subscribe(connection: ActiveConnection): void {
    const isCurrent = (): boolean =>
      this.active.get(connection.config.channelInstanceId) === connection &&
      connection.adapter.generation === connection.status.generation;

    connection.unsubscribers.push(
      connection.adapter.onMessage((message) => {
        if (isCurrent() && message.generation === connection.status.generation) {
          this.registerAttachmentDownloaders(connection, message);
          if (this.ingressPaused) {
            this.pausedInbound.push(message);
          } else {
            // Centralized command parsing: messages beginning with "/" are
            // parsed into ChannelCommand and dispatched via onCommand so
            // adapters never need to implement their own command detection.
            const parsed = parseCommandFromMessage(message);
            if (parsed) {
              this.handlers.onCommand?.(parsed);
            } else {
              this.handlers.onMessage?.(message);
            }
          }
        }
      }),
      connection.adapter.onCommand((command) => {
        if (isCurrent() && command.generation === connection.status.generation) {
          this.handlers.onCommand?.(command);
        }
      }),
      connection.adapter.onInteraction((interaction) => {
        if (
          isCurrent() &&
          interaction.generation === connection.status.generation
        ) {
          this.handlers.onInteraction?.({
            ...interaction,
            channelType: connection.config.channelType,
            channelInstanceId: connection.config.channelInstanceId,
          });
        }
      }),
      connection.adapter.onStatus((status) => {
        if (isCurrent() && status.generation === connection.status.generation) {
          connection.status = status;
          this.emitStatus(status);
        }
      }),
      connection.adapter.onError((error) => {
        if (isCurrent()) this.handlers.onError?.(error);
      }),
    );

    if (connection.adapter.onReaction) {
      connection.unsubscribers.push(
        connection.adapter.onReaction((reaction) => {
          if (
            isCurrent() &&
            reaction.generation === connection.status.generation
          ) {
            this.handlers.onReaction?.(reaction);
          }
        }),
      );
    }

    if (connection.adapter.onPairing) {
      connection.unsubscribers.push(
        connection.adapter.onPairing((event) => {
          if (
            isCurrent() &&
            event.generation === connection.status.generation
          ) {
            this.handlers.onPairing?.(event);
          }
        }),
      );
    }
  }

  private registerAttachmentDownloaders(
    connection: ActiveConnection,
    message: UnifiedMessage,
  ): void {
    for (const attachment of message.attachments) {
      if (!connection.adapter.downloadAttachment || !this.attachmentStore) continue;
      const source = toAttachmentSource(message, attachment);
      this.attachmentStore.registerDownloader(source, (signal) =>
        connection.adapter.downloadAttachment!(attachment.sourceRef, signal),
      );
    }
  }

  private emitStatus(status: ChannelStatusEvent): void {
    this.handlers.onStatus?.(status);
  }

  private makeStatus(
    config: ChannelAdapterConfig,
    generation: number,
    state: ChannelStatusEvent["state"],
    extra: Pick<ChannelStatusEvent, "errorCode" | "retryAt"> = {},
  ): ChannelConnectionStatus {
    return {
      version: 1,
      channelType: config.channelType,
      channelInstanceId: config.channelInstanceId,
      generation,
      state,
      timestamp: Date.now(),
      ...extra,
    };
  }
}

/**
 * Parse a UnifiedMessage whose text begins with "/" into a ChannelCommand.
 * Returns undefined when the message is not a command (text does not start
 * with "/"). The command name is lowercased; args are whitespace-split
 * tokens after the command name. The original message is preserved as-is
 * so handlers (e.g. ChannelRuntime) have policy context.
 */
function parseCommandFromMessage(
  message: UnifiedMessage,
): ChannelCommand | undefined {
  const text = message.text;
  if (!text.startsWith("/")) return undefined;

  // Split on whitespace: first token is the command name
  const trimmed = text.slice(1).trimStart();
  if (trimmed.length === 0) return undefined;

  const spaceIdx = trimmed.indexOf(" ");
  const name = (spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx))
    .toLowerCase();
  if (name.length === 0) return undefined;

  const args =
    spaceIdx === -1
      ? []
      : trimmed
          .slice(spaceIdx + 1)
          .split(/\s+/)
          .filter((token) => token.length > 0);

  return {
    version: 1,
    generation: message.generation,
    id: message.id,
    name,
    args,
    message,
  };
}

function toAttachmentSource(
  message: UnifiedMessage,
  attachment: InboundAttachment,
): AttachmentSource {
  return {
    version: 1,
    generation: message.generation,
    id: attachment.id,
    channelInstanceId: message.channelInstanceId,
    sourceKind: attachment.sourceKind,
    filename: attachment.filename,
    mediaType: attachment.mediaType,
    declaredSize: attachment.size,
    platformRef: attachment.sourceRef,
    sourceRef: attachment.sourceRef,
  };
}
