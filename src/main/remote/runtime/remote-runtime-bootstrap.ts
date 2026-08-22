/**
 * RemoteRuntimeBootstrap
 *
 * Production bootstrap for the ChannelRuntime stack. It is the sole IM
 * channel path (the legacy Gateway / WebSocket path was removed).
 *
 * This bootstrap:
 * - Builds ChannelRegistry → ConnectionManager → ChannelRuntime
 * - Registers only adapters whose dependencies can be safely constructed
 *   from existing protocols
 * - Routes inbound runtime messages through the configured AgentExecutor
 * - Exposes explicit capability errors for unsupported adapters
 */

import { app } from "electron";
import { basename, join } from "node:path";
import { ChannelRegistry } from "./channel-registry";
import { ConnectionManager } from "./connection-manager";
import {
  ChannelRuntime,
  type ReceiptContext,
} from "./channel-runtime";
import { SessionRouter } from "./session-router";
import { AttachmentStore, AttachmentError, MAX_MESSAGE_ATTACHMENT_BYTES } from "./attachment-store";
import type {
  ChannelAdapter,
  ChannelAdapterFactory,
  ChannelAdapterConfig,
} from "./channel-adapter";
import type { ChannelPolicyConfig } from "./policy-engine";
import type { ChannelConnectionStatus } from "./connection-manager";
import type {
  ChannelInteraction,
  ChannelCommand,
  UnifiedMessage,
  RuntimeChannelType,
  ChannelPairingEvent,
  ChannelStatusEvent,
  DeliveryResult,
} from "./contracts";
import type { ChannelSessionBinding } from "./session-router";
import type { AgentExecutor } from "../remote-manager";
import type { ContentBlock } from "../../../renderer/types";
import { remoteConfigStore, type ChannelInstanceRecord } from "../remote-config-store";
import { buildRemoteSessionTitle } from "../remote-title";
import { log, logError, logWarn } from "../../utils/logger";
import {
  ChannelRuntimePersistence,
  type InboundReceiptRecord,
  type OutboundDeliveryRecord,
} from "./persistence";
import { RuntimeKeyStore } from "./runtime-key-store";
import { getDatabase } from "../../db/database";
import { NotificationRouter, type NotificationAuthorization, type NotificationRequest } from "./notification-router";
import { StreamDelivery } from "./stream-delivery";

/** Timeout bounding all Agent session stops during shutdown (5 seconds). */
const SHUTDOWN_STOP_SESSION_TIMEOUT_MS = 5_000;

// ---------------------------------------------------------------------------
// Capability Gap Report
// ---------------------------------------------------------------------------

export type GapSeverity = "ready" | "blocked" | "unavailable";

export interface AdapterCapability {
  channelType: RuntimeChannelType;
  severity: GapSeverity;
  reason: string;
  /** The instance ID if the adapter could be registered */
  instanceId?: string;
}

export interface BootstrapGapReport {
  flag: boolean;
  /** Per-type capability assessment */
  capabilities: AdapterCapability[];
  /** Adapters that were successfully registered */
  registered: RuntimeChannelType[];
  /** Adapters that could not be registered and why */
  unsupported: AdapterCapability[];
}

// ---------------------------------------------------------------------------
// Supported adapter factories
// ---------------------------------------------------------------------------

/**
 * Feishu factory: wraps the legacy FeishuChannel inside a FeishuAdapter.
 * Requires appId + appSecret from channel config.
 */
async function createFeishuFactory(): Promise<ChannelAdapterFactory | null> {
  try {
    const { FeishuChannel } = await import("../channels/feishu/index");
    const { FeishuAdapter } = await import("../channels/feishu/feishu-adapter");
    return (config: ChannelAdapterConfig, generation: number) => {
      const appId = String(config.settings.appId ?? "");
      const appSecret = String(config.settings.appSecret ?? "");
      // DM policy is controlled by the per-instance ChannelPolicyConfig
      // resolved at runtime. The legacy channel is constructed with permissive
      // defaults — policy enforcement happens in ChannelRuntime, not the adapter.
      const feishuChannel = new FeishuChannel({
        type: "feishu",
        appId,
        appSecret,
        useWebSocket: true,
        dm: { policy: "open" },
      });
      return new FeishuAdapter(config, generation, feishuChannel);
    };
  } catch (err) {
    logError("[RemoteRuntimeBootstrap] Failed to create Feishu factory:", err);
    return null;
  }
}

/**
 * Telegram factory: uses TelegramChannel which implements ChannelAdapter
 * directly. Requires botToken from channel config.
 */
async function createTelegramFactory(): Promise<ChannelAdapterFactory | null> {
  try {
    const { TelegramChannel } = await import("../channels/telegram/telegram-channel");
    return (config: ChannelAdapterConfig, generation: number) => {
      return new TelegramChannel(config, generation);
    };
  } catch (err) {
    logError("[RemoteRuntimeBootstrap] Failed to create Telegram factory:", err);
    return null;
  }
}

/**
 * Discord factory: uses DiscordChannel which implements ChannelAdapter.
 * Requires botToken.
 */
async function createDiscordFactory(): Promise<ChannelAdapterFactory | null> {
  try {
    const { DiscordChannel } = await import("../channels/discord/discord-channel");
    const { DiscordGateway } = await import("../channels/discord/discord-gateway");
    const { DiscordRestClient } = await import("../channels/discord/discord-rest");
    return (config: ChannelAdapterConfig, generation: number) => {
      const token = String(config.settings.botToken ?? "");
      return new DiscordChannel(
        config,
        generation,
        new DiscordRestClient(token),
        new DiscordGateway(),
      );
    };
  } catch (err) {
    logError("[RemoteRuntimeBootstrap] Failed to create Discord factory:", err);
    return null;
  }
}

async function createQqFactory(): Promise<ChannelAdapterFactory | null> {
  try {
    const { QqChannel } = await import("../channels/qq/qq-channel");
    const { QqGateway } = await import("../channels/qq/qq-gateway");
    return (config: ChannelAdapterConfig, generation: number) => {
      const gateway = new QqGateway({
        appId: String(config.settings.appId ?? ""),
        clientSecret: String(config.settings.clientSecret ?? ""),
        baseUrl: String(config.settings.baseUrl ?? "https://api.sgroup.qq.com"),
        gatewayUrl:
          typeof config.settings.gatewayUrl === "string"
            ? config.settings.gatewayUrl
            : undefined,
      });
      return new QqChannel(config, generation, gateway);
    };
  } catch (err) {
    logError("[RemoteRuntimeBootstrap] Failed to create QQ factory:", err);
    return null;
  }
}

async function createWeChatFactory(): Promise<ChannelAdapterFactory | null> {
  try {
    const { WeChatChannel } = await import("../channels/wechat/wechat-channel");
    const { WeChatILinkPuppet } = await import("../channels/wechat/wechat-ilink-puppet");
    const { SecureWeChatTokenStore } = await import("../channels/wechat/wechat-token-store");
    return (config: ChannelAdapterConfig, generation: number) => {
      const puppet = new WeChatILinkPuppet({
        baseUrl: String(config.settings.baseUrl ?? "https://ilinkai.weixin.qq.com"),
      });
      const tokenStore = new SecureWeChatTokenStore(
        join(app.getPath("userData"), "channel-secrets"),
      );
      return new WeChatChannel(config, generation, puppet, tokenStore);
    };
  } catch (err) {
    logError("[RemoteRuntimeBootstrap] Failed to create WeChat factory:", err);
    return null;
  }
}

async function createSlackFactory(): Promise<ChannelAdapterFactory | null> {
  try {
    const { WebClient } = await import("@slack/web-api");
    const { App } = await import("@slack/bolt");
    const { SlackRuntimeChannel } = await import("../channels/slack/slack-runtime-channel");
    return (config: ChannelAdapterConfig, generation: number) => {
      const botToken = String(config.settings.botToken ?? "");
      const client = new WebClient(botToken) as unknown as {
        chat: {
          postMessage(args: {
            channel: string;
            text: string;
            thread_ts?: string;
            mrkdwn?: boolean;
          }): Promise<{ ts?: string; channel?: string }>;
        };
        auth: { test(): Promise<{ user_id?: string }> };
      };
      const appToken = String(config.settings.appToken ?? "");
      const app = new App({
        token: botToken,
        appToken,
        socketMode: true,
        signingSecret: String(config.settings.signingSecret ?? "runtime"),
      });
      const eventSource = {
        start: async (handler: (event: Record<string, unknown>) => void) => {
          app.message(async ({ message }: { message: unknown }) => {
            handler(message as Record<string, unknown>);
          });
          await app.start();
        },
        stop: async () => {
          await app.stop();
        },
      };
      return new SlackRuntimeChannel(config, generation, client, eventSource);
    };
  } catch (err) {
    logError("[RemoteRuntimeBootstrap] Failed to create Slack factory:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Bootstrap state
// ---------------------------------------------------------------------------

export interface BootstrapOptions {
  /** AgentExecutor for routing inbound runtime messages */
  agentExecutor: AgentExecutor;
  /** Default working directory for remote sessions */
  defaultWorkingDirectory?: string;
  /** Policy config for the ChannelRuntime (defaults to permissive) */
  policy?: ChannelPolicyConfig;
  /** Optional callback for channel pairing events (e.g. WeChat QR) */
  onPairing?: (event: ChannelPairingEvent) => void;
  /** Optional callback for channel connection status events. */
  onStatus?: (event: ChannelStatusEvent) => void;
  /** Handler registered by the producer of an authorized interaction. */
  onInteraction?: (interaction: ChannelInteraction) => Promise<void>;
  /**
   * Optional pre-built ChannelRuntimePersistence.
   * When not provided and feature is enabled, automatically built from
   * DB + RuntimeKeyStore.loadOrCreate().
   */
  persistence?: ChannelRuntimePersistence;
  /**
   * Optional pre-built RuntimeKeyStore (allows injection for tests).
   * When not provided and feature is enabled, `app.getPath('userData')` is used.
   */
  runtimeKeyStore?: RuntimeKeyStore;
}

const DEFAULT_POLICY: ChannelPolicyConfig = {
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

const IMAGE_MEDIA_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
] as const;
type ImageMediaType = (typeof IMAGE_MEDIA_TYPES)[number];

function isSupportedImageType(
  value: string | undefined,
): value is ImageMediaType {
  return IMAGE_MEDIA_TYPES.some((type) => type === value);
}

export class RemoteRuntimeBootstrap {
  private registry: ChannelRegistry | null = null;
  private connectionManager: ConnectionManager | null = null;
  private channelRuntime: ChannelRuntime | null = null;
  private started = false;
  private stopping = false;
  private gapReport: BootstrapGapReport | null = null;
  private options: BootstrapOptions | null = null;
  private readonly pairingSnapshots = new Map<string, ChannelPairingEvent>();
  private readonly generationWatermarks = new Map<string, number>();
  private attachmentStore: AttachmentStore | null = null;
  private persistence: ChannelRuntimePersistence | null = null;
  private lifecycleTail: Promise<void> = Promise.resolve();
  private notificationRouter: NotificationRouter | null = null;
  private readonly streamDeliveries = new Map<
    string,
    { adapter: ChannelAdapter; delivery: StreamDelivery }
  >();

  /** In-flight executeAgent promises, keyed by turnId. */
  private readonly pendingAgentExecutions = new Map<string, Promise<unknown>>();

  // -----------------------------------------------------------------------
  // Outbound response routing (production outbox path)
  // -----------------------------------------------------------------------

  /** Runtime response routes, keyed by deterministic turnId */
  private readonly responseRoutes = new Map<
    string,
    {
      binding: ChannelSessionBinding;
      message: UnifiedMessage;
      context: ReceiptContext;
      /** Actual Agent session ID (set after startSession returns) */
      agentSessionId?: string;
    }
  >();

  /** Reverse lookup: agentSessionId -> turnId */
  private readonly sessionToTurnId = new Map<string, string>();

  /**
   * Build the full Runtime stack (registry, connection manager, channel runtime)
   * and assess adapter capabilities. Does NOT start connections.
   *
   * With zero enabled instances this returns a gap report with no registered
   * adapters — a safe no-op for fresh installs.
   */
  initialize(options: BootstrapOptions): Promise<BootstrapGapReport> {
    return this.queueLifecycle(() => this.initializeNow(options));
  }

  private async initializeNow(
    options: BootstrapOptions,
  ): Promise<BootstrapGapReport> {
    this.options = options;

    // Re-initialization always requires a fresh start. Without this reset,
    // a refresh that skips stop() (e.g. concurrent IPC mutations) could leave
    // `started` true and cause start() to no-op after the stack is rebuilt.
    this.started = false;

    // Clear stale state on re-initialization
    this.pairingSnapshots.clear();
    this.generationWatermarks.clear();
    this.responseRoutes.clear();
    this.sessionToTurnId.clear();
    this.streamDeliveries.clear();
    this.notificationRouter?.clear();
    this.notificationRouter = null;

    log("[RemoteRuntimeBootstrap] Building Runtime stack...");

    // Build registry
    this.registry = new ChannelRegistry();

    // Assess and register adapters
    const capabilities = await this.assessAdapters();

    // Build production persistence (or use injected test persistence)
    const persistence =
      options.persistence ??
      (await this.buildProductionPersistence(options.runtimeKeyStore));
    this.persistence = persistence;

    // Build attachment store (one per bootstrap lifecycle)
    this.attachmentStore = new AttachmentStore({
      workspaceRoot: options.defaultWorkingDirectory ?? app.getPath("userData"),
    });

    // Build connection manager
    this.connectionManager = new ConnectionManager(
      this.registry,
      {
        onMessage: (message) => {
          void this.handleInboundMessage(message);
        },
        onCommand: (command) => {
          void this.handleInboundCommand(command);
        },
        onInteraction: (interaction) => {
          this.handleInteraction(interaction);
        },
        onPairing: (event) => {
          this.handlePairing(event);
        },
        onStatus: (status) => {
          this.handleConnectionStatus(status);
          this.options?.onStatus?.(status);
        },
        onError: (err) => {
          logError("[RemoteRuntimeBootstrap] Connection manager error:", err);
        },
      },
      this.attachmentStore,
    );

    // Resolve per-instance policies from channel instances.
    // Each instance may carry a `policy` blob from migration or config.
    const instancePolicies = this.resolveInstancePolicies(capabilities);

    // Build channel runtime
    this.channelRuntime = new ChannelRuntime({
      agentId: "remote-runtime",
      policy: options.policy ?? DEFAULT_POLICY,
      execute: async (binding, message, context: ReceiptContext) =>
        this.executeAgent(binding, message, context),
      persistence: persistence ?? undefined,
      sessionPersistence: persistence ?? undefined,
      interactionPersistence: persistence ?? undefined,
      executeInteraction: options.onInteraction,
      instancePolicies,
      reconcileUnknownDelivery: async (receipt, delivery) => {
        await this.reconcileUnknownDelivery(receipt, delivery);
      },
      recoverInboundMessage: async (receipt) => {
        await this.recoverInboundMessage(receipt);
      },
      connectionManager: {
        connect: async (config) => {
          return this.connectionManager?.connect(config);
        },
        disconnectAll: async (reason) => {
          await this.connectionManager?.disconnectAll(reason);
        },
        getAllStatus: () => {
          return this.connectionManager?.getAllStatus() ?? [];
        },
        send: async (channelInstanceId, message) => {
          if (!this.connectionManager) {
            return {
              version: 1 as const,
              generation: message.generation,
              accepted: false,
              committed: false,
              outcome: "permanent_failure" as const,
              idempotencyKey: message.idempotencyKey,
            };
          }
          return this.connectionManager.send(channelInstanceId, message);
        },
        lookupDelivery: async (channelInstanceId, idempotencyKey, generation) => {
          return this.connectionManager?.lookupDelivery(
            channelInstanceId,
            idempotencyKey,
            generation,
          );
        },
        pauseIngress: () => {
          this.connectionManager?.pauseIngress?.();
        },
        resumeIngress: () => {
          this.connectionManager?.resumeIngress?.();
        },
        isIngressPaused: () => {
          return this.connectionManager?.isIngressPaused ?? false;
        },
      },
      channels: capabilities
        .filter((c) => c.severity === "ready" && c.instanceId)
        .map((c) => ({
          channelType: c.channelType,
          channelInstanceId: c.instanceId!,
          agentId: "remote-runtime",
          settings: this.getChannelSettings(c.instanceId!),
        })),
    });

    // Build NotificationRouter with shared persistence and the
    // ConnectionManager adapter resolver. Initialize immediately so
    // authorizations and committed outbox keys are hydrated before
    // ChannelRuntime accepts ingress.
    this.notificationRouter = new NotificationRouter(
      (instanceId) => this.connectionManager?.resolveAdapter(instanceId),
      persistence,
    );
    this.notificationRouter.initialize();

    const registered = capabilities
      .filter((c) => c.severity === "ready")
      .map((c) => c.channelType);

    const unsupported = capabilities.filter(
      (c) => c.severity !== "ready",
    );

    const report: BootstrapGapReport = {
      flag: true,
      capabilities,
      registered,
      unsupported,
    };

    this.gapReport = report;

    log(
      "[RemoteRuntimeBootstrap] Runtime stack built.",
      `Registered: [${registered.join(", ") || "none"}]`,
      `Unsupported: [${unsupported.map((u) => `${u.channelType}(${u.reason})`).join(", ") || "none"}]`,
    );

    return report;
  }

  /**
   * Start all registered channel connections.
   * Requires initialize() to have been called first.
   */
  start(): Promise<void> {
    return this.queueLifecycle(() => this.startNow());
  }

  private async startNow(): Promise<void> {
    if (!this.channelRuntime) return;
    if (this.started) {
      logWarn("[RemoteRuntimeBootstrap] Runtime already started, skipping");
      return;
    }

    log("[RemoteRuntimeBootstrap] Starting ChannelRuntime...");
    try {
      await this.channelRuntime.start();
      this.started = true;
      log("[RemoteRuntimeBootstrap] ChannelRuntime started");
    } catch (error) {
      await this.stopNow().catch(() => undefined);
      throw error;
    }
  }

  stop(): Promise<void> {
    return this.queueLifecycle(() => this.stopNow());
  }

  private async stopNow(): Promise<void> {
    // Set stopping flag first to prevent new Agent executions from
    // registering routes.
    this.stopping = true;

    // Pause ingress before disconnecting adapters so no inbound
    // messages are dispatched during shutdown.
    this.connectionManager?.pauseIngress?.();

    try {
      // Finish sends that already claimed an outbox row while adapters are
      // still connected. New sends are rejected by the stopping guard.
      await this.drainOutboundInFlight();

      if (this.channelRuntime) {
        log("[RemoteRuntimeBootstrap] Stopping ChannelRuntime...");
        await this.channelRuntime.stop();
      }

      // Wait for in-flight Agent executions bounded by a deadline.
      await this.drainAgentExecutions();

      // Stop tracked Agent sessions after ingress is drained.
      // Bounded at SHUTDOWN_STOP_SESSION_TIMEOUT_MS total across all sessions.
      await this.stopAgentSessions();
    } finally {
      this.responseRoutes.clear();
      this.sessionToTurnId.clear();
      this.pendingAgentExecutions.clear();
      this.pairingSnapshots.clear();
      this.generationWatermarks.clear();
      this.streamDeliveries.clear();
      this.notificationRouter?.clear();
      this.started = false;
      this.stopping = false;
      log("[RemoteRuntimeBootstrap] ChannelRuntime stopped");
    }
  }

  /**
   * Wait for all in-flight Agent executions to complete, bounded by
   * SHUTDOWN_STOP_SESSION_TIMEOUT_MS. Late resolutions that arrive
   * after the deadline have their session immediately stopped.
   */
  private async drainAgentExecutions(): Promise<void> {
    const pending = [...this.pendingAgentExecutions.entries()];
    if (pending.length === 0) return;

    const deadline = Date.now() + SHUTDOWN_STOP_SESSION_TIMEOUT_MS;
    for (const [turnId, promise] of pending) {
      try {
        const remaining = Math.max(1, deadline - Date.now());
        await Promise.race([
          promise,
          new Promise<void>((resolve) => setTimeout(resolve, remaining)),
        ]);
      } catch {
        // Swallow: execution errors are logged elsewhere.
      }

      // If the promise still hasn't resolved after the timeout,
      // the late resolution callback will stop the returned session.
      // Set up a trailing handler to catch late resolutions.
      promise.then(
        (result) => {
          // Late resolution: immediately stop the returned session.
          const executor = this.options?.agentExecutor;
          if (
            executor &&
            result &&
            typeof result === "object" &&
            "agentSessionId" in result &&
            typeof (result as { agentSessionId: string }).agentSessionId ===
              "string"
          ) {
            const sid = (result as { agentSessionId: string })
              .agentSessionId;
            executor.stopSession(sid).catch(() => undefined);
            if (this.sessionToTurnId.get(sid) === turnId) {
              this.sessionToTurnId.delete(sid);
            }
          }
          // The response route may have been registered mid-shutdown;
          // clean it up.
          this.responseRoutes.delete(turnId);
        },
        () => {
          this.responseRoutes.delete(turnId);
        },
      );
    }
  }

  /**
   * Drain bounded outboundInFlight operations before disconnect.
   * Blocks up to SHUTDOWN_STOP_SESSION_TIMEOUT_MS total.
   */
  private async drainOutboundInFlight(): Promise<void> {
    const pending = [...this.outboundInFlight.values()];
    if (pending.length === 0) return;

    const deadline = Date.now() + SHUTDOWN_STOP_SESSION_TIMEOUT_MS;
    for (const promise of pending) {
      try {
        const remaining = Math.max(1, deadline - Date.now());
        await Promise.race([
          promise,
          new Promise<void>((resolve) => setTimeout(resolve, remaining)),
        ]);
      } catch {
        // Swallow.
      }
    }
  }

  /**
   * Stop all tracked Agent sessions via AgentExecutor.stopSession.
   * Bounded by SHUTDOWN_STOP_SESSION_TIMEOUT_MS across all sessions;
   * errors and timeouts for individual sessions are swallowed so cleanup
   * continues. Session IDs are never logged.
   */
  private async stopAgentSessions(): Promise<void> {
    const executor = this.options?.agentExecutor;
    if (!executor) return;

    const sessionIds = [...this.sessionToTurnId.keys()];
    if (sessionIds.length === 0) return;

    const deadline = Date.now() + SHUTDOWN_STOP_SESSION_TIMEOUT_MS;
    for (const _sessionId of sessionIds) {
      if (Date.now() >= deadline) break;
      try {
        await Promise.race([
          executor.stopSession(_sessionId),
          new Promise<void>((resolve) =>
            setTimeout(resolve, Math.max(1, deadline - Date.now())),
          ),
        ]);
      } catch {
        // Swallow: per-session stop failures must not block other sessions
      }
    }
  }

  private queueLifecycle<T>(task: () => Promise<T>): Promise<T> {
    const operation = this.lifecycleTail.then(task, task);
    this.lifecycleTail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  /**
   * Get current connection status for all channels.
   */
  getConnectionStatus(): ChannelConnectionStatus[] {
    return this.channelRuntime?.getStatus() ?? [];
  }

  /**
   * Get the most recent gap report.
   */
  getGapReport(): BootstrapGapReport | null {
    return this.gapReport;
  }

  /**
   * Check if the runtime stack is currently started.
   */
  isStarted(): boolean {
    return this.started;
  }

  /**
   * Return a read-only snapshot of the currently cached pairing events.
   * Each call returns a new array with shallow copies of the events.
   */
  getPairingSnapshots(): ChannelPairingEvent[] {
    return [...this.pairingSnapshots.values()].map((event) => ({ ...event }));
  }

  // -----------------------------------------------------------------------
  // Public: outbound response routing (production outbox path)
  // -----------------------------------------------------------------------

  /** Returns true when the given session ID is a remote-runtime Agent session. */
  isAgentSession(sessionId: string): boolean {
    return this.sessionToTurnId.has(sessionId);
  }

  /** In-flight send operations keyed by outbound idempotency key */
  private readonly outboundInFlight = new Map<string, Promise<void>>();

  /**
   * Deliver an assistant text response to the channel for the given session.
   * This is the production outbound delivery path:
   *  1. Look up the response route by sessionId + turnId
   *  2. Create encrypted pending outbound delivery
   *  3. Send via ConnectionManager (adapter.send)
   *  4. On committed: atomically commit receipt + delivery
   *
   * Concurrent duplicate assistant events for the same final idempotency
   * key share one in-flight operation; the durable outbox row blocks any
   * later send.
   *
   * The turnId comes from stream.message.turnId which was set by
   * SessionManager using the turnId we passed to startSession/continueSession.
   */
  async deliverAgentResponse(
    sessionId: string,
    turnId: string,
    text: string,
    messageId?: string,
  ): Promise<void> {
    if (this.stopping) return;
    if (!this.channelRuntime || !this.connectionManager) {
      logError(
        "[RemoteRuntimeBootstrap] deliverAgentResponse called before start",
      );
      return;
    }

    const route = this.responseRoutes.get(turnId);
    if (!route) {
      return;
    }

    // Ensure sessionId matches (defense-in-depth)
    if (
      route.agentSessionId !== undefined &&
      route.agentSessionId !== sessionId
    ) {
      return;
    }

    // Each assistant message within a turn gets its own outbound idempotency
    // key. The turn-level key (finalIdempotencyKey) identifies the turn; a
    // per-message suffix distinguishes the multiple assistant messages an
    // agent may emit (multi-step / tool-use). Without this, every round shares
    // one key and only the first is delivered.
    const turnKey = route.context.finalIdempotencyKey;
    const outboundKey = messageId ? `${turnKey}:${messageId}` : turnKey;

    // Deduplicate concurrent duplicate assistant events: if an operation
    // for this outbound key is already in-flight, share it.
    const inflight = this.outboundInFlight.get(outboundKey);
    if (inflight) {
      await inflight;
      return;
    }

    const op = this.doSendResponse(route, text, turnId, outboundKey);
    this.outboundInFlight.set(outboundKey, op);
    try {
      await op;
    } finally {
      this.outboundInFlight.delete(outboundKey);
    }
  }

  private async doSendResponse(
    route: NonNullable<ReturnType<typeof this.responseRoutes.get>>,
    text: string,
    turnId: string,
    outboundKey: string,
  ): Promise<void> {
    const { message, context } = route;
    const persistence = this.persistence;

    // 1. Atomic outbox claim: if two bootstraps share one DB, only one
    //    creates the row. claim=false means the row already existed —
    //    inspect the durable row and never send.
    let claimed = true;
    if (persistence?.claimOutboundDelivery) {
      claimed = persistence.claimOutboundDelivery({
        version: 1,
        generation: message.generation,
        idempotencyKey: outboundKey,
        agentId: "remote-runtime",
        channelInstanceId: message.channelInstanceId,
        chatId: message.chatId,
        targetVisibility: "chat",
        kind: "reply",
        payload: { text },
        state: "pending",
      });
    } else if (persistence) {
      // Fallback: check existing, then create (non-atomic between check
      // and create but single-bootstrap-owner is the common case).
      const existing = persistence.getOutboundDelivery(outboundKey);
      if (existing) {
        if (existing.state === "committed") {
          persistence.completeInboundReceipt(context.receiptKey);
        }
        return;
      }
      persistence.createOutboundDelivery({
        version: 1,
        generation: message.generation,
        idempotencyKey: outboundKey,
        agentId: "remote-runtime",
        channelInstanceId: message.channelInstanceId,
        chatId: message.chatId,
        targetVisibility: "chat",
        kind: "reply",
        payload: { text },
        state: "pending",
      });
    }

    // claim=false: the row already existed. Inspect durable row and
    // never send. Preserve in-flight joining (existing coalesce already
    // handled in deliverAgentResponse).
    if (!claimed) {
      const durable = persistence?.getOutboundDelivery(outboundKey);
      if (durable?.state === "committed") {
        persistence?.completeInboundReceipt(context.receiptKey);
      }
      return;
    }

    // 2. Send final response through StreamDelivery (streamId=turnId)
    //    so that the persisted stream completed state is exercised in
    //    production, while the existing encrypted outbox / receipt commit
    //    remains authoritative.
    let streamResult: DeliveryResult;
    try {
      streamResult = await this.streamComplete(
        message.channelInstanceId,
        turnId,
        text,
        outboundKey,
        message.generation,
        message.chatId,
      );
    } catch {
      persistence?.markOutboundUnknown(outboundKey);
      return;
    }

    // 3. Handle stream result. The stream delivery already attempted
    //    adapter.send or streamComplete internally. We now reconcile
    //    the outbox state.
    let finalOutcome = streamResult.outcome;
    let finalPlatformMessageId = streamResult.platformMessageId;

    if (finalOutcome === "retryable_failure") {
      const manager = this.connectionManager;
      if (manager) {
        try {
          const retry = await manager.send(message.channelInstanceId, {
            version: 1,
            generation: message.generation,
            idempotencyKey: outboundKey,
            target: {
              version: 1 as const,
              channelType: message.channelType,
              channelInstanceId: message.channelInstanceId,
              chatId: message.chatId,
              visibility: "chat" as const,
            },
            text,
            kind: "reply",
          });
          finalOutcome = retry.outcome;
          finalPlatformMessageId = retry.platformMessageId;
        } catch {
          persistence?.markOutboundUnknown(outboundKey);
          return;
        }
      }
    }

    if (finalOutcome === "committed") {
      // A turn may produce several assistant messages; each commits its own
      // outbound row. The inbound receipt is completed exactly once (by the
      // first segment) — later segments fall back to a segment-level commit so
      // they are still recorded as delivered.
      if (persistence?.commitOutboundAndReceipt) {
        try {
          persistence.commitOutboundAndReceipt(
            outboundKey,
            context.receiptKey,
            finalPlatformMessageId,
          );
        } catch {
          persistence.markOutboundCommitted(outboundKey, finalPlatformMessageId);
        }
      } else {
        persistence?.markOutboundCommitted?.(outboundKey, finalPlatformMessageId);
      }
    } else if (finalOutcome === "permanent_failure") {
      // Atomically mark outbound failed AND receipt rejected so the
      // duplicate-detection path in handleMessage does not see a
      // lingering processing receipt. A segment-level failure only marks its
      // own row; the receipt is still completed so the turn is not re-run
      // spuriously (which would duplicate already-delivered segments).
      if (persistence?.markOutboundFailedAndRejectReceipt) {
        try {
          persistence.markOutboundFailedAndRejectReceipt(
            outboundKey,
            context.receiptKey,
          );
        } catch {
          persistence?.markOutboundFailed?.(outboundKey);
          persistence?.completeInboundReceipt?.(context.receiptKey);
        }
      } else {
        persistence?.markOutboundFailed?.(outboundKey);
        persistence?.completeInboundReceipt?.(context.receiptKey);
      }
    } else {
      // accepted, unknown, or a second retryable failure all have an
      // inconclusive external outcome and must never be sent automatically.
      persistence?.markOutboundUnknown(outboundKey);
    }
  }

  private async reconcileUnknownDelivery(
    receipt: InboundReceiptRecord,
    delivery: OutboundDeliveryRecord,
  ): Promise<void> {
    const manager = this.connectionManager;
    const persistence = this.persistence;
    if (!manager || !persistence) return;

    const result = await manager.lookupDelivery(
      delivery.channelInstanceId,
      delivery.idempotencyKey,
      delivery.generation,
    );
    if (result?.outcome === "committed") {
      persistence.commitOutboundAndReceipt(
        delivery.idempotencyKey,
        receipt.receiptKey,
        result.platformMessageId,
      );
      return;
    }

    // Unsupported or inconclusive lookup stays unknown. Never rerun the
    // Agent or resend without an explicit platform confirmation of absence.
    logWarn("[RemoteRuntimeBootstrap] Unknown delivery requires review");
  }

  /**
   * Recover an accepted (received) inbound message from a persisted receipt
   * after crash restart. Reconstructs text and IDs; attachment IDs become
   * an unavailable placeholder. Legacy rows missing channelType/chatKind
   * remain received and are not guessed.
   */
  private async recoverInboundMessage(
    receipt: InboundReceiptRecord,
  ): Promise<void> {
    if (!this.channelRuntime) return;

    // Only recover receipts that have the optional fields needed to
    // reconstruct the inbound message.
    if (!receipt.channelType || !receipt.chatKind) {
      return;
    }

    const runtimeChannelTypes: RuntimeChannelType[] = [
      "feishu", "telegram", "discord", "qq", "slack", "wechat",
    ];
    const channelType = runtimeChannelTypes.includes(
      receipt.channelType as RuntimeChannelType,
    )
      ? (receipt.channelType as RuntimeChannelType)
      : undefined;
    if (!channelType) return;

    const chatKind = ["dm", "group", "channel"].includes(receipt.chatKind)
      ? (receipt.chatKind as "dm" | "group" | "channel")
      : undefined;
    if (!chatKind) return;

    // Reconstruct inbound message from receipt fields.
    // Recovered attachments (which may no longer be downloadable) are
    // represented as a plain-text placeholder to avoid failing
    // buildAgentContent with an unavailable attachment source.
    const attachmentPlaceholder =
      receipt.attachmentIds.length > 0
        ? `\n\n[Recovered message had ${receipt.attachmentIds.length} attachment(s) no longer available]`
        : "";

    const message: UnifiedMessage = {
      version: 1,
      generation: receipt.generation,
      id: receipt.messageId,
      channelType,
      channelInstanceId: receipt.channelInstanceId,
      chatId: receipt.chatId,
      userId: receipt.userId,
      chatKind,
      text: `${receipt.normalizedText}${attachmentPlaceholder}`,
      // Recovered messages do not register fake attachments — the
      // placeholder text above informs the Agent that attachments
      // were present but are no longer available for download.
      attachments: [],
      mentions: [],
      timestamp: receipt.receivedAt,
    };

    // Bypass policy for already-accepted receipts; route directly to
    // the execute path. The policy was already evaluated and passed
    // before the receipt was persisted.
    try {
      await this.channelRuntime.executeAcceptedMessage(message, receipt);
    } catch {
      // Recovery execution failures leave receipt in received state
      // for the next recovery cycle.
    }
  }

  // -----------------------------------------------------------------------
  // Public: NotificationRouter pass-through
  // -----------------------------------------------------------------------

  /**
   * Authorize a notification target. Persists to durable storage.
   * Safe to call before the router is fully initialized — authorization
   * is written to persistence and will be hydrated on the next
   * initialize() call.
   */
  authorizeNotification(auth: NotificationAuthorization): void {
    if (this.notificationRouter) {
      this.notificationRouter.authorize(auth);
    } else if (this.persistence) {
      this.persistence.authorizeNotification({
        version: 1,
        generation: auth.generation,
        agentId: auth.agentId,
        channelInstanceId: auth.channelInstanceId,
        chatId: auth.chatId,
        userId: auth.userId,
        enabledAt: auth.enabledAt,
        revokedAt: auth.revokedAt,
        expiresAt: auth.expiresAt,
      });
    }
  }

  /**
   * Revoke a notification authorization. Persisted immediately.
   */
  revokeNotification(
    agentId: string,
    channelInstanceId: string,
    chatId: string,
    userId?: string,
  ): void {
    if (this.notificationRouter) {
      this.notificationRouter.revoke(agentId, channelInstanceId, chatId, userId);
    } else if (this.persistence) {
      this.persistence.revokeNotificationAuthorization(
        agentId,
        channelInstanceId,
        chatId,
        userId,
      );
    }
  }

  /**
   * Send a notification through the NotificationRouter.
   * Requires the router to be initialized (runtime started).
   */
  async notify(request: NotificationRequest): Promise<DeliveryResult> {
    if (!this.notificationRouter) {
      throw new Error("NOTIFICATION_ROUTER_UNAVAILABLE");
    }
    return this.notificationRouter.notify(request);
  }

  // -----------------------------------------------------------------------
  // Public: StreamDelivery pass-through
  // -----------------------------------------------------------------------

  /**
   * Stream an update through the StreamDelivery for the given channel
   * instance. The StreamDelivery is lazily created per active connection.
   * Generation-safe: uses the current active adapter.
   */
  async streamUpdate(
    channelInstanceId: string,
    streamId: string,
    sequence: number,
    text: string,
    idempotencyKey: string,
    generation: number,
    chatId: string,
    isFinal: boolean,
  ): Promise<DeliveryResult | undefined> {
    const adapter = this.connectionManager?.resolveAdapter(channelInstanceId);
    if (!adapter || adapter.generation !== generation) return undefined;
    const delivery = this.getOrCreateStreamDelivery(channelInstanceId, chatId);
    if (!delivery) return undefined;

    const target = {
      version: 1 as const,
      channelType: adapter.channelType,
      channelInstanceId: adapter.channelInstanceId,
      chatId,
      visibility: "chat" as const,
    };

    return delivery.update({
      version: 1,
      generation,
      streamId,
      sequence,
      target,
      fullText: text,
      idempotencyKey,
      isFinal,
    });
  }

  /**
   * Complete a stream through the StreamDelivery for the given channel
   * instance. This is the preferred path for Bootstrap final response
   * delivery — it exercises the persisted stream state dedupe in
   * production.
   */
  async streamComplete(
    channelInstanceId: string,
    streamId: string,
    text: string,
    idempotencyKey: string,
    generation: number,
    chatId: string,
  ): Promise<DeliveryResult> {
    const adapter = this.connectionManager?.resolveAdapter(channelInstanceId);
    const delivery =
      adapter?.generation === generation
        ? this.getOrCreateStreamDelivery(channelInstanceId, chatId)
        : undefined;
    if (!adapter || !delivery) {
      return {
        version: 1,
        generation,
        accepted: false,
        committed: false,
        outcome: "permanent_failure",
        idempotencyKey,
        errorCode: "STREAM_DELIVERY_UNAVAILABLE",
      };
    }

    const target = {
      version: 1 as const,
      channelType: adapter.channelType,
      channelInstanceId,
      chatId,
      visibility: "chat" as const,
    };

    return delivery.complete(streamId, target, text, idempotencyKey, generation);
  }

  private getOrCreateStreamDelivery(
    channelInstanceId: string,
    chatId?: string,
  ): StreamDelivery | undefined {
    const adapter = this.connectionManager?.resolveAdapter(channelInstanceId);
    if (!adapter) return undefined;

    const existing = this.streamDeliveries.get(channelInstanceId);
    if (existing?.adapter === adapter) return existing.delivery;

    const delivery = new StreamDelivery(adapter, this.persistence ?? undefined);
    if (chatId !== undefined) {
      delivery.setChatId(chatId);
    }
    this.streamDeliveries.set(channelInstanceId, { adapter, delivery });
    return delivery;
  }

  /**
   * Check if the runtime stack has been initialized.
   */
  isInitialized(): boolean {
    return this.registry !== null;
  }

  /**
   * Resolve per-instance ChannelPolicyConfig overrides from channel
   * instance records. Only instances with a valid policy blob contribute.
   * Fail-closed: malformed policy blobs are silently ignored — the
   * runtime-wide default policy applies for those instances.
   */
  private resolveInstancePolicies(
    capabilities: AdapterCapability[],
  ): Record<string, ChannelPolicyConfig> {
    const result: Record<string, ChannelPolicyConfig> = {};
    if (!this.options) return result;

    const instances = remoteConfigStore.listChannelInstances(false);
    for (const cap of capabilities) {
      if (cap.severity !== "ready" || !cap.instanceId) continue;
      const instance = instances.find((i) => i.id === cap.instanceId);
      if (!instance?.policy) continue;
      const parsed = parseInstancePolicy(instance.policy);
      result[cap.instanceId] = parsed ?? {
        ...DEFAULT_POLICY,
        enabled: false,
      };
    }
    return result;
  }

  // -----------------------------------------------------------------------
  // Private: adapter assessment
  // -----------------------------------------------------------------------

  /**
   * For each channel type, determine if a safe factory can be built.
   * Returns per-type capability assessments.
   */
  private async assessAdapters(): Promise<AdapterCapability[]> {
    const instances = remoteConfigStore.listChannelInstances(false);
    const enabledInstances = instances.filter((i) => i.enabled);

    if (enabledInstances.length === 0) {
      // No channel instances configured — still report all type capabilities
      return this.allTypeCapabilities([]);
    }

    const results: AdapterCapability[] = [];

    for (const instance of enabledInstances) {
      const cap = await this.assessInstance(instance);
      results.push(cap);
    }

    return results;
  }

  private async assessInstance(
    instance: ChannelInstanceRecord,
  ): Promise<AdapterCapability> {
    switch (instance.type) {
      case "feishu": {
        const hasCredentials =
          typeof instance.config.appId === "string" &&
          instance.config.appId.length > 0 &&
          typeof instance.config.appSecret === "string" &&
          instance.config.appSecret.length > 0;

        if (!hasCredentials) {
          return {
            channelType: "feishu",
            severity: "blocked",
            reason: "FEISHU_MISSING_CREDENTIALS: appId or appSecret not configured",
            instanceId: instance.id,
          };
        }

        const factory = await createFeishuFactory();
        if (!factory) {
          return {
            channelType: "feishu",
            severity: "blocked",
            reason: "FEISHU_FACTORY_FAILED: Unable to load FeishuAdapter dependencies",
            instanceId: instance.id,
          };
        }

        // Register the factory
        try {
          if (!this.registry!.has("feishu")) this.registry!.register("feishu", factory);
        } catch {
          return {
            channelType: "feishu",
            severity: "blocked",
            reason: "FEISHU_ALREADY_REGISTERED: Duplicate feishu adapter registration",
            instanceId: instance.id,
          };
        }

        return {
          channelType: "feishu",
          severity: "ready",
          reason: "Feishu adapter ready with appId/appSecret",
          instanceId: instance.id,
        };
      }

      case "telegram": {
        const hasToken =
          typeof instance.config.botToken === "string" &&
          instance.config.botToken.length > 0;

        if (!hasToken) {
          return {
            channelType: "telegram",
            severity: "blocked",
            reason: "TELEGRAM_MISSING_TOKEN: botToken not configured",
            instanceId: instance.id,
          };
        }

        const factory = await createTelegramFactory();
        if (!factory) {
          return {
            channelType: "telegram",
            severity: "blocked",
            reason: "TELEGRAM_FACTORY_FAILED: Unable to load TelegramChannel dependencies",
            instanceId: instance.id,
          };
        }

        try {
          if (!this.registry!.has("telegram")) this.registry!.register("telegram", factory);
        } catch {
          return {
            channelType: "telegram",
            severity: "blocked",
            reason: "TELEGRAM_ALREADY_REGISTERED: Duplicate telegram adapter registration",
            instanceId: instance.id,
          };
        }

        return {
          channelType: "telegram",
          severity: "ready",
          reason: "Telegram adapter ready with botToken",
          instanceId: instance.id,
        };
      }

      case "slack": {
        const hasToken =
          typeof instance.config.botToken === "string" &&
          instance.config.botToken.length > 0;

        const hasAppToken =
          typeof instance.config.appToken === "string" &&
          instance.config.appToken.length > 0;

        if (!hasToken || !hasAppToken) {
          return {
            channelType: "slack",
            severity: "blocked",
            reason: "SLACK_MISSING_SOCKET_MODE_CREDENTIALS: botToken and appToken are required",
            instanceId: instance.id,
          };
        }

        const factory = await createSlackFactory();
        if (!factory) {
          return {
            channelType: "slack",
            severity: "blocked",
            reason: "SLACK_FACTORY_FAILED: Unable to load SlackRuntimeChannel dependencies",
            instanceId: instance.id,
          };
        }

        try {
          if (!this.registry!.has("slack")) this.registry!.register("slack", factory);
        } catch {
          return {
            channelType: "slack",
            severity: "blocked",
            reason: "SLACK_ALREADY_REGISTERED: Duplicate slack adapter registration",
            instanceId: instance.id,
          };
        }

        return {
          channelType: "slack",
          severity: "ready",
          reason: "Slack adapter ready with botToken",
          instanceId: instance.id,
        };
      }

      case "discord": {
        if (typeof instance.config.botToken !== "string" || !instance.config.botToken) {
          return { channelType: "discord", severity: "blocked", reason: "DISCORD_MISSING_TOKEN", instanceId: instance.id };
        }
        const factory = await createDiscordFactory();
        if (!factory) {
          return { channelType: "discord", severity: "blocked", reason: "DISCORD_FACTORY_FAILED", instanceId: instance.id };
        }
        if (!this.registry!.has("discord")) this.registry!.register("discord", factory);
        return { channelType: "discord", severity: "ready", reason: "Discord REST and Gateway adapters ready", instanceId: instance.id };
      }

      case "qq": {
        if (
          typeof instance.config.appId !== "string" || !instance.config.appId ||
          typeof instance.config.clientSecret !== "string" || !instance.config.clientSecret
        ) {
          return { channelType: "qq", severity: "blocked", reason: "QQ_MISSING_APP_CREDENTIALS", instanceId: instance.id };
        }
        const factory = await createQqFactory();
        if (!factory) {
          return { channelType: "qq", severity: "blocked", reason: "QQ_FACTORY_FAILED", instanceId: instance.id };
        }
        if (!this.registry!.has("qq")) this.registry!.register("qq", factory);
        return { channelType: "qq", severity: "ready", reason: "QQ Gateway adapter ready", instanceId: instance.id };
      }

      case "wechat": {
        const factory = await createWeChatFactory();
        if (!factory) {
          return {
            channelType: "wechat",
            severity: "blocked",
            reason: "WECHAT_FACTORY_FAILED: Unable to load iLink protocol dependencies",
            instanceId: instance.id,
          };
        }
        if (!this.registry!.has("wechat")) this.registry!.register("wechat", factory);
        return {
          channelType: "wechat",
          severity: "ready",
          reason: "WeChat iLink adapter ready; QR login is performed on connect",
          instanceId: instance.id,
        };
      }

      default: {
        const _exhaustive: never = instance.type;
        return {
          channelType: _exhaustive,
          severity: "unavailable",
          reason: `UNKNOWN_CHANNEL_TYPE: ${String(instance.type)} is not a recognized RuntimeChannelType`,
          instanceId: instance.id,
        };
      }
    }
  }

  /**
   * Returns capability assessments for all known channel types,
   * even ones without configured instances.
   */
  private allTypeCapabilities(
    existing: AdapterCapability[],
  ): AdapterCapability[] {
    const covered = new Set(existing.map((c) => c.channelType));
    const allTypes: RuntimeChannelType[] = [
      "feishu",
      "telegram",
      "discord",
      "qq",
      "slack",
      "wechat",
    ];

    for (const t of allTypes) {
      if (!covered.has(t)) {
        existing.push({
          channelType: t,
          severity: "unavailable",
          reason: `NO_INSTANCE_CONFIGURED: No enabled channel instance for type '${t}'`,
        });
      }
    }

    return existing;
  }

  // -----------------------------------------------------------------------
  // Private: production persistence construction
  // -----------------------------------------------------------------------

  /**
   * Build the production ChannelRuntimePersistence using the app database
   * and a RuntimeKeyStore-derived encryption key. Does NOT touch
   * DB or safeStorage when feature flag is disabled.
   */
  private async buildProductionPersistence(
    injectedKeyStore?: RuntimeKeyStore,
  ): Promise<ChannelRuntimePersistence> {
    const keyStore =
      injectedKeyStore ?? new RuntimeKeyStore(app.getPath("userData"));
    const encryptionKey = await keyStore.loadOrCreate();
    return new ChannelRuntimePersistence(getDatabase().raw, encryptionKey);
  }

  // -----------------------------------------------------------------------
  // Private: channel settings for ChannelAdapterConfig
  // -----------------------------------------------------------------------

  private getChannelSettings(instanceId: string): Record<string, unknown> {
    const instances = remoteConfigStore.listChannelInstances(false);
    const instance = instances.find((i) => i.id === instanceId);
    return instance?.config ?? {};
  }

  // -----------------------------------------------------------------------
  // Private: agent execution
  // -----------------------------------------------------------------------

  /**
   * Route an inbound runtime message through the configured AgentExecutor.
   * Returns the actual Agent session ID so ChannelRuntime can persist the
   * binding. Errors are logged (non-sensitive) then re-thrown so the runtime
   * leaves the receipt in processing state for lease recovery.
   */
  private async executeAgent(
    binding: ChannelSessionBinding,
    message: UnifiedMessage,
    context: ReceiptContext,
  ): Promise<{ agentSessionId: string }> {
    if (!this.options?.agentExecutor) {
      const err = new Error(
        "[RemoteRuntimeBootstrap] No AgentExecutor configured",
      );
      logError(err.message);
      throw err;
    }

    const { agentExecutor, defaultWorkingDirectory } = this.options;

    const cwd = defaultWorkingDirectory;

    if (cwd && agentExecutor.validateWorkingDirectory) {
      const reason = await agentExecutor.validateWorkingDirectory(cwd);
      if (reason) {
        const err = new Error(
          `[RemoteRuntimeBootstrap] Working directory validation failed: ${reason}`,
        );
        logError(err.message);
        throw err;
      }
    }

    // Build content blocks from attachments before calling AgentExecutor.
    const content = await this.buildAgentContent(message);

    // Register the response route BEFORE calling the Agent, keyed by turnId.
    // The agentSessionId will be set after the session is created.
    // During shutdown, reject new registrations immediately.
    if (this.stopping) {
      throw new Error(
        "[RemoteRuntimeBootstrap] Bootstrap is shutting down — rejecting new Agent execution",
      );
    }
    this.responseRoutes.set(context.turnId, {
      binding,
      message,
      context,
    });

    // Track this execution for shutdown drain. On completion or failure,
    // the tracking entry is cleaned up automatically.
    const executionPromise = this.doExecuteAgent(
      binding,
      message,
      context,
      content,
      cwd,
    );
    this.pendingAgentExecutions.set(context.turnId, executionPromise);
    void executionPromise.then(
      () => this.pendingAgentExecutions.delete(context.turnId),
      () => this.pendingAgentExecutions.delete(context.turnId),
    );
    return executionPromise;
  }

  private async doExecuteAgent(
    binding: ChannelSessionBinding,
    message: UnifiedMessage,
    context: ReceiptContext,
    content: ContentBlock[],
    cwd: string | undefined,
  ): Promise<{ agentSessionId: string }> {
    const { agentExecutor } = this.options!;

    // Check if the binding's sessionId is a persisted (non-placeholder) ID.
    if (!SessionRouter.isPlaceholderSessionId(binding.sessionId)) {
      // Persisted session: use continueSession with the actual ID.
      this.responseRoutes.get(context.turnId)!.agentSessionId =
        binding.sessionId;
      this.sessionToTurnId.set(binding.sessionId, context.turnId);

      try {
        await agentExecutor.continueSession(
          binding.sessionId,
          message.text,
          content.length > 0 ? content : undefined,
          cwd,
          context.turnId,
        );
      } catch (error) {
        this.responseRoutes.delete(context.turnId);
        if (this.sessionToTurnId.get(binding.sessionId) === context.turnId) {
          this.sessionToTurnId.delete(binding.sessionId);
        }
        throw error;
      }

      return { agentSessionId: binding.sessionId };
    }

    // Placeholder session: start a new Agent session.
    const title = buildRemoteSessionTitle(message.text);
    let session: Awaited<ReturnType<AgentExecutor["startSession"]>>;
    try {
      session = await agentExecutor.startSession(
        title,
        message.text,
        cwd,
        content.length > 0 ? content : undefined,
        context.turnId,
      );
    } catch (error) {
      this.responseRoutes.delete(context.turnId);
      throw error;
    }

    // Update the response route with the actual agent session ID
    const route = this.responseRoutes.get(context.turnId);
    if (!route) {
      // The route was cleared during a shutdown race. Immediately stop
      // the started session and do not dereference cleared state.
      agentExecutor.stopSession(session.id).catch(() => undefined);
      throw new Error(
        "[RemoteRuntimeBootstrap] Response route cleared during shutdown",
      );
    }
    route.agentSessionId = session.id;
    this.sessionToTurnId.set(session.id, context.turnId);

    return { agentSessionId: session.id };
  }

  /**
   * Download all inbound attachments sequentially and convert them to
   * ContentBlock values. Supported image MIME types become `image` blocks;
   * everything else becomes `file_attachment` with inline base-64 data.
   *
   * Throws AttachmentError when the aggregate inbound size exceeds the
   * 50 MiB limit or when a single download fails.
   */
  private async buildAgentContent(
    message: UnifiedMessage,
  ): Promise<ContentBlock[]> {
    if (!this.attachmentStore) {
      return [];
    }

    const content: ContentBlock[] = [];
    let totalBytes = 0;

    for (const attachment of message.attachments) {
      const data = await this.attachmentStore.downloadInbound({
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
      });

      totalBytes += data.byteLength;
      if (totalBytes > MAX_MESSAGE_ATTACHMENT_BYTES) {
        throw new AttachmentError(
          "ATTACHMENT_MESSAGE_TOO_LARGE",
          `Message exceeds ${MAX_MESSAGE_ATTACHMENT_BYTES} bytes`,
        );
      }

      if (isSupportedImageType(attachment.mediaType)) {
        content.push({
          type: "image",
          source: {
            type: "base64",
            media_type: attachment.mediaType,
            data: data.toString("base64"),
          },
        });
      } else {
        const fallbackFilename = `attachment-${attachment.id}`;
        const filename = basename(attachment.filename ?? fallbackFilename) || fallbackFilename;
        content.push({
          type: "file_attachment",
          filename,
          relativePath: "",
          size: data.byteLength,
          mimeType: attachment.mediaType,
          inlineDataBase64: data.toString("base64"),
        });
      }
    }

    return content;
  }

  /**
   * Cache or clear a pairing event and forward to the optional callback.
   * Events newer than the cached generation overwrite; stale events are ignored.
   * Terminal states (confirmed, expired, failed) remove the snapshot.
   */
  private handlePairing(event: ChannelPairingEvent): void {
    const safeEvent =
      event.state === "pending" || event.state === "scanned"
        ? event
        : { ...event, imageUrl: undefined };
    // Per-instance generation watermark: reject stale events even after
    // terminal/status cleanup cleared the snapshot.
    const watermark =
      this.generationWatermarks.get(safeEvent.channelInstanceId) ?? 0;
    if (safeEvent.generation < watermark) return;

    if (safeEvent.generation > watermark) {
      this.generationWatermarks.set(
        safeEvent.channelInstanceId,
        safeEvent.generation,
      );
    }

    if (safeEvent.state === "pending" || safeEvent.state === "scanned") {
      this.pairingSnapshots.set(safeEvent.channelInstanceId, {
        ...safeEvent,
      });
    } else {
      this.pairingSnapshots.delete(safeEvent.channelInstanceId);
    }

    this.options?.onPairing?.(safeEvent);
  }

  /**
   * Clear a pairing snapshot when the connection status changes.
   * A newer generation starting or the current generation stopping/failing
   * removes the snapshot without persisting terminal state.
   */
  private handleConnectionStatus(status: ChannelStatusEvent): void {
    // Update generation watermark on status changes (Task 1)
    const currentWatermark = this.generationWatermarks.get(status.channelInstanceId) ?? 0;
    if (status.generation > currentWatermark) {
      this.generationWatermarks.set(status.channelInstanceId, status.generation);
    }

    // Clear snapshot on same-generation terminal/transitional states,
    // and always on newer-generation status (Task 3)
    const current = this.pairingSnapshots.get(status.channelInstanceId);
    if (!current) return;

    if (status.generation > current.generation) {
      this.pairingSnapshots.delete(status.channelInstanceId);
      return;
    }

    if (status.generation === current.generation) {
      const clearingStates = new Set<string>([
        "connected",
        "reconnecting",
        "draining",
        "stopping",
        "stopped",
        "failed",
      ]);
      if (clearingStates.has(status.state)) {
        this.pairingSnapshots.delete(status.channelInstanceId);
      }
    }
  }

  /**
   * Handle an inbound UnifiedMessage from a connected adapter.
   */
  private async handleInboundMessage(message: UnifiedMessage): Promise<void> {
    if (!this.channelRuntime) return;

    try {
      const decision = await this.channelRuntime.handleMessage(message);
      if (!decision.allowed) {
        log(
          "[RemoteRuntimeBootstrap] Message rejected by policy:",
          decision.reason,
        );
      }
    } catch (err) {
      logError("[RemoteRuntimeBootstrap] Inbound handler error");
    }
  }

  /**
   * Handle an inbound ChannelCommand from the central ConnectionManager
   * parser. Dispatches to ChannelRuntime.handleCommand with stable error
   * logging — command execution errors are caught and logged so the
   * adapter event loop can continue.
   */
  private async handleInboundCommand(
    command: ChannelCommand,
  ): Promise<void> {
    if (!this.channelRuntime) return;

    try {
      const decision = await this.channelRuntime.handleCommand(command);
      if (!decision.allowed) {
        log(
          "[RemoteRuntimeBootstrap] Command rejected by policy:",
          (decision as { reason?: string }).reason ?? "unknown",
        );
      }
    } catch (err) {
      logError("[RemoteRuntimeBootstrap] Command handler error");
    }
  }

  /**
   * Handle an inbound ChannelInteraction from a connected adapter.
   * Authorizes and atomically consumes the interaction through
   * ChannelRuntime, logging the decision as stable code.
   */
  private handleInteraction(
    interaction: ChannelInteraction,
  ): void {
    if (!this.channelRuntime) return;

    void this.channelRuntime.handleInteraction(interaction).catch(() => {
      // handleInteraction is internally robust; errors here are defensive.
    });
  }

  /**
   * Public: authorize an interaction for later atomic consumption.
   * Delegates to ChannelRuntime.authorizeInteraction. Throws when
   * the runtime is not initialized instead of silently succeeding.
   */
  authorizeInteraction(
    interaction: ChannelInteraction,
  ): void {
    if (!this.channelRuntime) {
      throw new Error("BOOTSTRAP_UNAVAILABLE");
    }
    this.channelRuntime.authorizeInteraction(interaction);
  }
}

/**
 * Parse a raw policy blob (from a channel instance's `policy` field) into
 * a validated ChannelPolicyConfig. Returns undefined when the blob is
 * malformed or missing required fields — fail closed.
 */
function parseInstancePolicy(
  blob: Record<string, unknown>,
): ChannelPolicyConfig | undefined {
  if (typeof blob.enabled !== "boolean") return undefined;
  if (!Array.isArray(blob.allowedChatKinds)) return undefined;
  const chatKinds = blob.allowedChatKinds.filter(
    (k: unknown): k is "dm" | "group" | "channel" =>
      k === "dm" || k === "group" || k === "channel",
  );
  if (chatKinds.length === 0) return undefined;

  const policy: ChannelPolicyConfig = {
    enabled: blob.enabled,
    allowedChatKinds: chatKinds,
    dmEnabled: typeof blob.dmEnabled === "boolean" ? blob.dmEnabled : chatKinds.includes("dm"),
    groupEnabled: typeof blob.groupEnabled === "boolean" ? blob.groupEnabled : chatKinds.includes("group"),
    channelEnabled: typeof blob.channelEnabled === "boolean" ? blob.channelEnabled : chatKinds.includes("channel"),
    deniedUsers: Array.isArray(blob.deniedUsers) ? blob.deniedUsers.filter((u: unknown): u is string => typeof u === "string") : [],
    deniedChats: Array.isArray(blob.deniedChats) ? blob.deniedChats.filter((c: unknown): c is string => typeof c === "string") : [],
    allowedUsers: Array.isArray(blob.allowedUsers) ? blob.allowedUsers.filter((u: unknown): u is string => typeof u === "string") : [],
    allowedChats: Array.isArray(blob.allowedChats) ? blob.allowedChats.filter((c: unknown): c is string => typeof c === "string") : [],
    requireMention: typeof blob.requireMention === "boolean" ? blob.requireMention : false,
    allowBots: typeof blob.allowBots === "boolean" ? blob.allowBots : false,
    allowedCommands: Array.isArray(blob.allowedCommands) ? blob.allowedCommands.filter((c: unknown): c is string => typeof c === "string") : [],
    groupRequireMention: isStringBoolMap(blob.groupRequireMention) ? blob.groupRequireMention : undefined,
    groupAllowFrom: isStringStrArrMap(blob.groupAllowFrom) ? blob.groupAllowFrom : undefined,
    defaultRequireMention: typeof blob.defaultRequireMention === "boolean" ? blob.defaultRequireMention : undefined,
    dmPolicy:
      blob.dmPolicy === "open" ||
      blob.dmPolicy === "allowlist" ||
      blob.dmPolicy === "deny"
        ? blob.dmPolicy
        : undefined,
    dmAllowFrom: Array.isArray(blob.dmAllowFrom)
      ? blob.dmAllowFrom.filter(
          (value: unknown): value is string => typeof value === "string",
        )
      : undefined,
    groupAllowedChats: Array.isArray(blob.groupAllowedChats)
      ? blob.groupAllowedChats.filter(
          (value: unknown): value is string => typeof value === "string",
        )
      : undefined,
  };
  return policy;
}

function isStringBoolMap(
  value: unknown,
): value is Record<string, boolean> {
  if (typeof value !== "object" || value === null) return false;
  for (const v of Object.values(value as Record<string, unknown>)) {
    if (typeof v !== "boolean") return false;
  }
  return true;
}

function isStringStrArrMap(
  value: unknown,
): value is Record<string, string[]> {
  if (typeof value !== "object" || value === null) return false;
  for (const v of Object.values(value as Record<string, unknown>)) {
    if (!Array.isArray(v) || v.some((e: unknown) => typeof e !== "string")) return false;
  }
  return true;
}

// Singleton instance
export const remoteRuntimeBootstrap = new RemoteRuntimeBootstrap();
