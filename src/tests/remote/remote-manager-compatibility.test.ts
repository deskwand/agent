import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ChannelPolicyConfig } from "../../main/remote/runtime/policy-engine";
import type { UnifiedMessage } from "../../main/remote/runtime/contracts";

// Mock electron-store before importing RemoteManager
vi.mock("electron-store", () => {
  interface MockStore {
    store: Map<string, unknown>;
    path: string;
  }
  function Store(this: MockStore) {
    this.store = new Map<string, unknown>();
    this.store.set("gateway", { enabled: false, port: 18789, bind: "127.0.0.1", auth: { mode: "open" } });
    this.store.set("channels", {});
    this.store.set("pairedUsers", []);
    this.path = "/tmp/mock-remote-config.json";
  }
  Store.prototype.get = function (this: MockStore, key: string) { return this.store.get(key); };
  Store.prototype.set = function (this: MockStore, key: string, value: unknown) { this.store.set(key, value); };
  Store.prototype.clear = function (this: MockStore) { this.store.clear(); };
  return { default: Store };
});

import { RemoteManager } from "../../main/remote/remote-manager";

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

function message(userId: string): UnifiedMessage {
  return {
    version: 1,
    generation: 1,
    id: `${userId}-message`,
    channelType: "telegram",
    channelInstanceId: "telegram-1",
    chatId: "chat-1",
    userId,
    chatKind: "dm",
    text: "hello",
    attachments: [],
    mentions: [],
    timestamp: 1,
  };
}

describe("RemoteManager compatibility", () => {
  let manager: RemoteManager;

  beforeEach(() => {
    manager = new RemoteManager();
  });

  it("accepts a runtime configuration and starts it on start()", () => {
    const execute = vi.fn(async () => undefined);
    manager.configureRuntime({
      agentId: "agent-1",
      policy,
      execute,
    });

    // Runtime should be configured but not yet started
    expect(manager.isRuntimeConfigured()).toBe(true);

    // verify the runtime can handle a message without throwing
  });

  it("keeps existing public API methods callable", () => {
    // Verify all public API methods exist and are callable
    expect(typeof manager.setAgentExecutor).toBe("function");
    expect(typeof manager.setRendererCallback).toBe("function");
    expect(typeof manager.start).toBe("function");
    expect(typeof manager.stop).toBe("function");
    expect(typeof manager.setDefaultWorkingDirectory).toBe("function");
    expect(typeof manager.configureRuntime).toBe("function");
    expect(typeof manager.isRuntimeConfigured).toBe("function");
  });

  it("performs start/stop without runtime configured (legacy path)", async () => {
    // With gateway disabled, start/stop should be fast no-ops
    await manager.start();
    await manager.stop();
    // No errors = pass
  });

  it("delegates runtime handleMessage for allowed messages", async () => {
    const execute = vi.fn(async () => undefined);
    manager.configureRuntime({
      agentId: "agent-1",
      policy,
      execute,
    });

    const result = await manager.handleRuntimeMessage(message("user-1"));

    expect(result.allowed).toBe(true);
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1" }),
      message("user-1"),
      expect.objectContaining({
        receiptKey: expect.any(String),
        finalIdempotencyKey: expect.any(String),
        turnId: expect.any(String),
      }),
    );
  });

  it("rejects messages for denied users via runtime", async () => {
    const execute = vi.fn(async () => undefined);
    manager.configureRuntime({
      agentId: "agent-1",
      policy: { ...policy, deniedUsers: ["blocked"] },
      execute,
    });

    const result = await manager.handleRuntimeMessage(message("blocked"));

    expect(result.allowed).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });

  it("startRuntimeBootstrap forwards onStatus as remote.channelStatus", async () => {
    const { remoteRuntimeBootstrap } = await import(
      "../../main/remote/runtime/remote-runtime-bootstrap"
    );
    // Capture the onStatus callback passed to initialize.
    let capturedStatus: ((event: {
      channelInstanceId: string;
      state: string;
      errorCode?: string;
      timestamp: number;
    }) => void) | undefined;
    const initSpy = vi
      .spyOn(remoteRuntimeBootstrap, "initialize")
      .mockImplementation(async (options: Parameters<typeof remoteRuntimeBootstrap.initialize>[0]) => {
        capturedStatus = options.onStatus as typeof capturedStatus;
        return {
          flag: true,
          capabilities: [],
          registered: [],
          unsupported: [],
        };
      });
    vi.spyOn(remoteRuntimeBootstrap, "start").mockImplementation(
      async () => undefined,
    );

    const rendererEvents: unknown[] = [];
    manager.setRendererCallback((event) => {
      rendererEvents.push(event);
    });

    const { remoteConfigStore } = await import(
      "../../main/remote/remote-config-store"
    );
    vi.spyOn(remoteConfigStore, "listChannelInstances").mockReturnValue([
      {
        id: "telegram-1",
        name: "Telegram",
        type: "telegram",
        enabled: true,
        config: {},
      },
    ]);

    try {
      manager.setAgentExecutor({
        startSession: vi.fn(async () => ({ id: "s1" })),
        continueSession: vi.fn(async () => undefined),
        stopSession: vi.fn(async () => undefined),
      } as never);
      await manager.start();

      expect(capturedStatus).toBeDefined();
      capturedStatus?.({
        channelInstanceId: "telegram-1",
        state: "connected",
        timestamp: 123,
      });

      expect(rendererEvents).toContainEqual(
        expect.objectContaining({
          type: "remote.channelStatus",
          payload: expect.objectContaining({
            id: expect.any(String),
            state: "connected",
            connected: true,
          }),
        }),
      );

      // Same state + errorCode must be coalesced: no second event.
      const countAfterFirst = rendererEvents.filter(
        (e) =>
          (e as { type?: string }).type === "remote.channelStatus",
      ).length;
      capturedStatus?.({
        channelInstanceId: "telegram-1",
        state: "connected",
        timestamp: 124,
      });
      const countAfterSecond = rendererEvents.filter(
        (e) =>
          (e as { type?: string }).type === "remote.channelStatus",
      ).length;
      expect(countAfterSecond).toBe(countAfterFirst);

      // A state change does emit.
      capturedStatus?.({
        channelInstanceId: "telegram-1",
        state: "reconnecting",
        timestamp: 125,
      });
      const countAfterThird = rendererEvents.filter(
        (e) =>
          (e as { type?: string }).type === "remote.channelStatus",
      ).length;
      expect(countAfterThird).toBe(countAfterFirst + 1);
    } finally {
      initSpy.mockRestore();
      vi.restoreAllMocks();
    }
  });

  it("resolveRuntimeSession creates a session binding", async () => {
    const execute = vi.fn(async () => undefined);
    manager.configureRuntime({
      agentId: "agent-1",
      policy,
      execute,
    });

    const binding = await manager.resolveRuntimeSession(message("user-1"));

    expect(binding.userId).toBe("user-1");
    expect(binding.channelInstanceId).toBe("telegram-1");
    expect(typeof binding.sessionId).toBe("string");
    expect(binding.sessionId.length).toBeGreaterThan(0);
  });

  it("serializes concurrent refreshRuntimeChannels calls", async () => {
    const { remoteRuntimeBootstrap } = await import(
      "../../main/remote/runtime/remote-runtime-bootstrap"
    );
    vi.spyOn(remoteRuntimeBootstrap, "isStarted").mockReturnValue(true);

    // stop() is slow; without serialization a second refresh's start would
    // interleave before the first refresh's stop completes.
    const events: string[] = [];
    const stopSpy = vi
      .spyOn(remoteRuntimeBootstrap, "stop")
      .mockImplementation(async () => {
        events.push("stop-start");
        await new Promise((resolve) => setTimeout(resolve, 5));
        events.push("stop-end");
      });
    const startSpy = vi
      .spyOn(
        manager as unknown as { startRuntimeBootstrap(): Promise<void> },
        "startRuntimeBootstrap",
      )
      .mockImplementation(async () => {
        events.push("start");
      });

    try {
      await Promise.all([
        manager.refreshRuntimeChannels(),
        manager.refreshRuntimeChannels(),
        manager.refreshRuntimeChannels(),
      ]);

      expect(stopSpy).toHaveBeenCalledTimes(3);
      expect(startSpy).toHaveBeenCalledTimes(3);
      // Strict alternation: each refresh fully stops before the next starts.
      expect(events).toEqual([
        "stop-start", "stop-end", "start",
        "stop-start", "stop-end", "start",
        "stop-start", "stop-end", "start",
      ]);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("stop() settles after queued refreshes without phantom restart", async () => {
    const { remoteRuntimeBootstrap } = await import(
      "../../main/remote/runtime/remote-runtime-bootstrap"
    );
    vi.spyOn(remoteRuntimeBootstrap, "isStarted").mockReturnValue(true);

    const events: string[] = [];
    const stopSpy = vi
      .spyOn(remoteRuntimeBootstrap, "stop")
      .mockImplementation(async () => {
        events.push("bootstrap-stop");
      });
    const startSpy = vi
      .spyOn(
        manager as unknown as { startRuntimeBootstrap(): Promise<void> },
        "startRuntimeBootstrap",
      )
      .mockImplementation(async () => {
        events.push("refresh-start");
      });

    try {
      // Queue a refresh first, then a stop. The stop must run after the
      // refresh completes — the refresh's start must not happen after stop.
      const refreshPromise = manager.refreshRuntimeChannels();
      const stopPromise = manager.stop();
      await Promise.all([refreshPromise, stopPromise]);

      expect(stopSpy).toHaveBeenCalledTimes(2); // once by refresh, once by stop
      expect(startSpy).toHaveBeenCalledTimes(1);
      // The refresh's start precedes the final stop.
      expect(events.indexOf("refresh-start")).toBeLessThan(
        events.lastIndexOf("bootstrap-stop"),
      );
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("start() queues after a pending refresh", async () => {
    const { remoteRuntimeBootstrap } = await import(
      "../../main/remote/runtime/remote-runtime-bootstrap"
    );
    vi.spyOn(remoteRuntimeBootstrap, "isStarted").mockReturnValue(true);

    const events: string[] = [];
    const stopSpy = vi
      .spyOn(remoteRuntimeBootstrap, "stop")
      .mockImplementation(async () => {
        events.push("bootstrap-stop");
      });
    const startSpy = vi
      .spyOn(
        manager as unknown as { startRuntimeBootstrap(): Promise<void> },
        "startRuntimeBootstrap",
      )
      .mockImplementation(async () => {
        events.push("bootstrap-start");
      });

    try {
      // Refresh queued first, then an explicit start. Serialization must
      // ensure the refresh's stop runs before start's bootstrap start — the
      // start must not interleave and orphan the rebuilt stack.
      const refreshPromise = manager.refreshRuntimeChannels();
      const startPromise = manager.start();
      await Promise.all([refreshPromise, startPromise]);

      expect(stopSpy).toHaveBeenCalledTimes(1); // refresh's stop
      expect(startSpy).toHaveBeenCalledTimes(2); // refresh's start + explicit start
      // The explicit start's bootstrap start happens after the refresh's stop.
      const firstBootstrapStart = events.indexOf("bootstrap-start");
      const bootstrapStop = events.indexOf("bootstrap-stop");
      expect(bootstrapStop).toBeGreaterThanOrEqual(0);
      expect(firstBootstrapStart).toBeGreaterThan(bootstrapStop);
    } finally {
      vi.restoreAllMocks();
    }
  });
});
