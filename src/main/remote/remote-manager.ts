/**
 * Remote Manager
 * 远程控制系统管理器，整合 ChannelRuntime 和 RemoteRuntimeBootstrap
 */

import { EventEmitter } from "events";
import { log, logError } from "../utils/logger";
import {
  ChannelRuntime,
  type ChannelRuntimeOptions,
} from "./runtime/channel-runtime";
import type {
  ChannelSessionBinding,
} from "./runtime/session-router";
import type { ChannelConnectionStatus } from "./runtime/connection-manager";
import type {
  PolicyDecision,
} from "./runtime/policy-engine";
import type {
  UnifiedMessage,
} from "./runtime/contracts";
import { remoteRuntimeBootstrap } from "./runtime/remote-runtime-bootstrap";
import { remoteConfigStore } from "./remote-config-store";
import type {
  ContentBlock,
  ServerEvent,
  Session,
} from "../../renderer/types/index";

// Agent executor interface - exported for use in main process
export interface AgentExecutor {
  startSession(
    title: string,
    prompt: string,
    cwd?: string,
    content?: ContentBlock[],
    turnId?: string,
  ): Promise<Session>;
  continueSession(
    sessionId: string,
    prompt: string,
    content?: ContentBlock[],
    cwd?: string,
    turnId?: string,
  ): Promise<void>;
  stopSession(sessionId: string): Promise<void>;
  validateWorkingDirectory?(
    cwd: string,
  ): Promise<string | null> | string | null;
}

export class RemoteManager extends EventEmitter {
  private agentExecutor?: AgentExecutor;
  private sendToRenderer?: (event: ServerEvent) => void;

  // 远程默认工作目录（用于未指定 cwd 的会话）
  private defaultWorkingDirectory?: string;

  // ChannelRuntime compatibility bridge (Task 8)
  private runtime?: ChannelRuntime;

  constructor() {
    super();
  }

  /**
   * Configure the ChannelRuntime compatibility bridge.
   * When set, start/stop delegates to the runtime.
   */
  configureRuntime(options: ChannelRuntimeOptions): void {
    this.runtime = new ChannelRuntime(options);
  }

  /**
   * Check if a ChannelRuntime has been configured.
   */
  isRuntimeConfigured(): boolean {
    return this.runtime !== undefined;
  }

  // ---------------------------------------------------------------------------
  // Pass-through APIs that delegate to RemoteRuntimeBootstrap so production
  // services (Agent integrations, tools) have access to notification and
  // interaction APIs without IPC indirection.
  // ---------------------------------------------------------------------------

  authorizeNotification(auth: Parameters<typeof remoteRuntimeBootstrap.authorizeNotification>[0]): void {
    if (!remoteRuntimeBootstrap.isInitialized()) {
      throw new Error("BOOTSTRAP_UNAVAILABLE");
    }
    remoteRuntimeBootstrap.authorizeNotification(auth);
  }

  revokeNotification(...args: Parameters<typeof remoteRuntimeBootstrap.revokeNotification>): void {
    if (!remoteRuntimeBootstrap.isInitialized()) {
      throw new Error("BOOTSTRAP_UNAVAILABLE");
    }
    remoteRuntimeBootstrap.revokeNotification(...args);
  }

  async notify(request: Parameters<typeof remoteRuntimeBootstrap.notify>[0]): ReturnType<typeof remoteRuntimeBootstrap.notify> {
    if (!remoteRuntimeBootstrap.isInitialized()) {
      throw new Error("BOOTSTRAP_UNAVAILABLE");
    }
    return remoteRuntimeBootstrap.notify(request);
  }

  authorizeInteraction(interaction: Parameters<typeof remoteRuntimeBootstrap.authorizeInteraction>[0]): void {
    if (!remoteRuntimeBootstrap.isInitialized()) {
      throw new Error("BOOTSTRAP_UNAVAILABLE");
    }
    remoteRuntimeBootstrap.authorizeInteraction(interaction);
  }

  /**
   * Handle a UnifiedMessage through the ChannelRuntime bridge.
   * Returns a policy decision. Allowed messages are enqueued for execution.
   */
  async handleRuntimeMessage(message: UnifiedMessage): Promise<PolicyDecision> {
    if (!this.runtime) {
      throw new Error("CHANNEL_RUNTIME_NOT_CONFIGURED");
    }
    return this.runtime.handleMessage(message);
  }

  /**
   * Resolve a session binding through the ChannelRuntime bridge.
   */
  getRuntimeStatus(): ChannelConnectionStatus[] {
    const configuredRuntime = this.runtime?.getStatus() ?? [];
    const bootstrappedRuntime = remoteRuntimeBootstrap.getConnectionStatus();
    return [...configuredRuntime, ...bootstrappedRuntime];
  }

  async resolveRuntimeSession(
    message: UnifiedMessage,
  ): Promise<ChannelSessionBinding> {
    if (!this.runtime) {
      throw new Error("CHANNEL_RUNTIME_NOT_CONFIGURED");
    }
    return this.runtime.resolveSession(message);
  }

  /**
   * Set agent executor (called from main process)
   */
  setAgentExecutor(executor: AgentExecutor): void {
    this.agentExecutor = executor;
    log("[RemoteManager] Agent executor set");
  }

  /**
   * 设置远程会话的默认工作目录
   */
  setDefaultWorkingDirectory(dir?: string): void {
    this.defaultWorkingDirectory = dir;
    log("[RemoteManager] Default working directory set:", dir || "(none)");
  }

  /**
   * Set renderer callback (for UI updates)
   */
  setRendererCallback(callback: (event: ServerEvent) => void): void {
    this.sendToRenderer = callback;
  }

  /**
   * Initialize and start remote control (runtime + bootstrap only)
   */
  start(): Promise<void> {
    // Serialize with refreshes/shutdown so an initial start cannot race a
    // refresh that would drop the freshly built stack without disconnecting.
    const startNow = async (): Promise<void> => {
      // Start ChannelRuntime bridge first
      if (this.runtime && !this.runtime.isStarted) {
        await this.runtime.start();
        log("[RemoteManager] ChannelRuntime bridge started");
      }

      // Start RemoteRuntimeBootstrap.
      await this.startRuntimeBootstrap();
    };
    const start = this.refreshTail.then(startNow, startNow);
    this.refreshTail = start.then(
      () => undefined,
      () => undefined,
    );
    return start;
  }

  /**
   * Initialize and start the RemoteRuntimeBootstrap if the feature flag
   * is enabled. Safe to call when the flag is disabled — it becomes a no-op.
   */
  private async startRuntimeBootstrap(): Promise<void> {
    if (!this.agentExecutor) {
      log("[RemoteManager] Skipping runtime bootstrap: AgentExecutor not yet set");
      return;
    }

    // If already started, no-op (Task 4)
    if (remoteRuntimeBootstrap.isStarted()) {
      log("[RemoteManager] Runtime bootstrap already started, no-op");
      return;
    }

    // Re-initialize when stopped but already initialized — this re-runs
    // adapter assessment and picks up any config changes (Task 4).
    // initialize() also clears stale pairing state.
    if (remoteRuntimeBootstrap.isInitialized()) {
      log("[RemoteManager] Runtime bootstrap stopped, re-initializing...");
    }

    try {
      const report = await remoteRuntimeBootstrap.initialize({
        agentExecutor: this.agentExecutor,
        defaultWorkingDirectory: this.defaultWorkingDirectory,
        onPairing: (event) => {
          this.emitToRenderer({
            type: "remote.channelPairing",
            payload: event,
          });
        },
        onStatus: (event) => {
          // Coalesce repeated identical states (e.g. reconnect loops): skip
          // the store read + IPC emit when nothing changed for this instance.
          const prev = this.lastEmittedStatus.get(event.channelInstanceId);
          if (
            prev?.state === event.state &&
            prev?.errorCode === event.errorCode
          ) {
            return;
          }
          // Merge runtime status into the renderer-facing instance shape so
          // the UI can update an existing card in place without losing
          // fields like `enabled`.
          const instance = remoteConfigStore
            .listChannelInstances()
            .find((item) => item.id === event.channelInstanceId);
          if (!instance) return;
          this.lastEmittedStatus.set(event.channelInstanceId, {
            state: event.state,
            errorCode: event.errorCode,
          });
          this.emitToRenderer({
            type: "remote.channelStatus",
            payload: {
              id: instance.id,
              name: instance.name,
              type: instance.type,
              enabled: instance.enabled,
              connected: event.state === "connected",
              state: event.state,
              error: event.errorCode,
              lastActiveAt: event.timestamp,
            },
          });
        },
      });

      log(
        "[RemoteManager] Runtime bootstrap initialized.",
        `Registered: [${report.registered.join(", ") || "none"}]`,
        `Unsupported: [${report.unsupported.map((u) => `${u.channelType}(${u.reason})`).join(", ") || "none"}]`,
      );

      // Only surface capability gaps when channel instances actually exist.
      // With zero instances, assessAdapters() reports all types as
      // "unavailable" — that is not a user-facing warning.
      const hasEnabledInstances = remoteConfigStore
        .listChannelInstances(false)
        .some((instance) => instance.enabled);
      if (hasEnabledInstances && report.unsupported.length > 0) {
        this.emitToRenderer({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          type: "remote.runtime_gaps" as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          payload: report.unsupported as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
      }

      await remoteRuntimeBootstrap.start();
    } catch (err) {
      logError("[RemoteManager] Runtime bootstrap failed:", err);
    }
  }

  /** Serializes concurrent refreshRuntimeChannels calls. */
  private refreshTail: Promise<void> = Promise.resolve();

  /** Last forwarded status per instance, for same-state coalescing. */
  private lastEmittedStatus = new Map<
    string,
    { state: string; errorCode?: string }
  >();

  /**
   * Refresh runtime channels by serially stopping and re-initializing/starting
   * only the RemoteRuntimeBootstrap.
   * Used by create/update/delete channel IPC handlers.
   *
   * Concurrent calls share one tail promise so each refresh runs stop →
   * initialize → start atomically; the previous stack is always torn down
   * before the next one is built, preventing orphaned connections.
   */
  refreshRuntimeChannels(): Promise<void> {
    const refresh = this.refreshTail.then(
      () => this.refreshRuntimeChannelsNow(),
      () => this.refreshRuntimeChannelsNow(),
    );
    this.refreshTail = refresh.then(
      () => undefined,
      () => undefined,
    );
    return refresh;
  }

  private async refreshRuntimeChannelsNow(): Promise<void> {
    log("[RemoteManager] Refreshing runtime channels...");
    if (remoteRuntimeBootstrap.isStarted()) {
      await remoteRuntimeBootstrap.stop();
    }
    // Re-initialize with current AgentExecutor and default directory;
    // initialize() is safe even when already initialized.
    await this.startRuntimeBootstrap();
    log("[RemoteManager] Runtime channels refreshed");
  }

  /**
   * Stop remote control (runtime + bootstrap only)
   */
  async stop(): Promise<void> {
    // Serialize with in-flight refreshes: a refresh that is queued or running
    // must settle before shutdown takes effect, otherwise it could restart
    // the runtime after stop() completed.
    const stopNow = async (): Promise<void> => {
      // Stop ChannelRuntime bridge if configured (Task 8)
      if (this.runtime && this.runtime.isStarted) {
        await this.runtime.stop();
        log("[RemoteManager] ChannelRuntime bridge stopped");
      }
      if (remoteRuntimeBootstrap.isStarted()) {
        await remoteRuntimeBootstrap.stop();
        log("[RemoteManager] Runtime bootstrap stopped");
      }
    };
    const stop = this.refreshTail.then(stopNow, stopNow);
    this.refreshTail = stop.then(
      () => undefined,
      () => undefined,
    );
    await stop;
  }

  /**
   * Emit event to renderer
   */
  private emitToRenderer(event: ServerEvent): void {
    if (this.sendToRenderer) {
      this.sendToRenderer(event);
    }
    this.emit("renderer-event", event);
  }
}

// Singleton instance
export const remoteManager = new RemoteManager();
