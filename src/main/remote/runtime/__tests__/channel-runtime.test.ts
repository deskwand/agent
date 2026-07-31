import { describe, expect, it, vi } from "vitest";
import { ChannelRuntime } from "../channel-runtime";
import type { UnifiedMessage } from "../contracts";
import type { ChannelPolicyConfig } from "../policy-engine";
import type { ChannelAdapterConfig } from "../channel-adapter";

const policy: ChannelPolicyConfig = {
  enabled: true,
  allowedChatKinds: ["dm", "group", "channel"],
  dmEnabled: true,
  groupEnabled: true,
  channelEnabled: true,
  deniedUsers: ["blocked"],
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

describe("channel runtime", () => {
  it("enforces command policy before routing command messages", async () => {
    const execute = vi.fn(async () => undefined);
    const runtime = new ChannelRuntime({
      agentId: "agent-1",
      policy: { ...policy, allowedCommands: ["help"] },
      execute,
    });
    const command = {
      version: 1 as const,
      generation: 1,
      id: "command-1",
      name: "compact",
      args: [],
      message: message("allowed"),
    };

    const decision = await runtime.handleCommand(command);

    expect(decision).toEqual({ allowed: false, reason: "COMMAND_NOT_ALLOWED" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("reclaims expired inbound leases during startup", async () => {
    const persistence = { requeueExpiredReceipts: vi.fn(() => 2) };
    const runtime = new ChannelRuntime({
      agentId: "agent-1",
      policy,
      execute: vi.fn(async () => undefined),
      persistence,
    });

    await runtime.start();

    expect(persistence.requeueExpiredReceipts).toHaveBeenCalledOnce();
  });

  it("connects configured channels on start and drains them on stop", async () => {
    const connectionManager = {
      connect: vi.fn(async () => undefined),
      disconnectAll: vi.fn(async () => undefined),
    };
    const runtime = new ChannelRuntime({
      agentId: "agent-1",
      policy,
      execute: vi.fn(async () => undefined),
      connectionManager,
      channels: [
        {
          channelType: "telegram",
          channelInstanceId: "telegram-1",
          agentId: "agent-1",
          settings: { token: "secret" },
        },
      ],
    });

    await runtime.start();
    await runtime.stop();

    expect(connectionManager.connect).toHaveBeenCalledWith(
      expect.objectContaining({ channelInstanceId: "telegram-1" }),
    );
    expect(connectionManager.disconnectAll).toHaveBeenCalledWith("runtime_stop");
  });

  it("disconnects partially started channels when startup fails", async () => {
    const connectionManager = {
      connect: vi.fn(async (config: { channelInstanceId: string }) => {
        if (config.channelInstanceId === "wechat-1") {
          throw new Error("wechat start failed");
        }
      }),
      disconnectAll: vi.fn(async () => undefined),
    };
    const runtime = new ChannelRuntime({
      agentId: "agent-1",
      policy,
      execute: vi.fn(async () => undefined),
      connectionManager,
      channels: [
        {
          channelType: "telegram",
          channelInstanceId: "telegram-1",
          agentId: "agent-1",
          settings: {},
        },
        {
          channelType: "wechat",
          channelInstanceId: "wechat-1",
          agentId: "agent-1",
          settings: {},
        },
      ],
    });

    await expect(runtime.start()).rejects.toThrow("wechat start failed");
    expect(connectionManager.disconnectAll).toHaveBeenCalledWith(
      "runtime_start_failed",
    );
    expect(runtime.isStarted).toBe(false);
  });

  it("does not invoke the Agent for a rejected message", async () => {
    const execute = vi.fn(async () => undefined);
    const runtime = new ChannelRuntime({
      agentId: "agent-1",
      policy,
      execute,
    });

    await runtime.handleMessage(message("blocked"));

    expect(execute).not.toHaveBeenCalled();
  });

  it("routes an allowed message through the session binding", async () => {
    const execute = vi.fn(async () => undefined);
    const runtime = new ChannelRuntime({
      agentId: "agent-1",
      policy,
      execute,
    });

    await runtime.handleMessage(message("allowed"));

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "allowed" }),
      message("allowed"),
      expect.objectContaining({
        receiptKey: expect.any(String) as string,
        finalIdempotencyKey: expect.any(String) as string,
      }),
    );
  });

  it("shares one in-flight start promise for concurrent start calls", async () => {
    const connectionManager = {
      connect: vi.fn(async () => { /* noop */ }),
      disconnectAll: vi.fn(async () => undefined),
    };
    const runtime = new ChannelRuntime({
      agentId: "agent-1",
      policy,
      execute: vi.fn(async () => undefined),
      connectionManager,
      channels: [
        {
          channelType: "telegram",
          channelInstanceId: "telegram-1",
          agentId: "agent-1",
          settings: {},
        },
      ],
    });

    // Two concurrent start calls — should share one promise
    await Promise.all([runtime.start(), runtime.start()]);

    // Connect called exactly once per channel
    expect(connectionManager.connect).toHaveBeenCalledTimes(1);
    expect(runtime.isStarted).toBe(true);
  });

  it("recovers from failed concurrent start and allows retry", async () => {
    let callCount = 0;
    const connectionManager = {
      connect: vi.fn(async () => {
        callCount++;
        if (callCount === 1) throw new Error("first start fails");
      }),
      disconnectAll: vi.fn(async () => undefined),
    };
    const runtime = new ChannelRuntime({
      agentId: "agent-1",
      policy,
      execute: vi.fn(async () => undefined),
      connectionManager,
      channels: [
        {
          channelType: "telegram",
          channelInstanceId: "telegram-1",
          agentId: "agent-1",
          settings: {},
        },
      ],
    });

    // First attempt fails
    await expect(runtime.start()).rejects.toThrow("first start fails");
    expect(runtime.isStarted).toBe(false);

    // Second attempt succeeds (lifecycle queue cleared)
    await runtime.start();
    expect(runtime.isStarted).toBe(true);
    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  it("stop during start serializes via lifecycle queue", async () => {
    const connectionManager = {
      connect: vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 50));
      }),
      disconnectAll: vi.fn(async () => undefined),
    };
    const runtime = new ChannelRuntime({
      agentId: "agent-1",
      policy,
      execute: vi.fn(async () => undefined),
      connectionManager,
      channels: [
        {
          channelType: "telegram",
          channelInstanceId: "telegram-1",
          agentId: "agent-1",
          settings: {},
        },
      ],
    });

    // Start then immediately stop — stop must queue behind start
    const startP = runtime.start();
    const stopP = runtime.stop();

    await Promise.all([startP, stopP]);

    // After both settle, should be stopped
    expect(runtime.isStarted).toBe(false);
    expect(connectionManager.disconnectAll).toHaveBeenCalled();
  });

  it("start during stop serializes via lifecycle queue", async () => {
    const connectionManager = {
      connect: vi.fn(async () => undefined),
      disconnectAll: vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 30));
      }),
    };
    const runtime = new ChannelRuntime({
      agentId: "agent-1",
      policy,
      execute: vi.fn(async () => undefined),
      connectionManager,
      channels: [
        {
          channelType: "telegram",
          channelInstanceId: "telegram-1",
          agentId: "agent-1",
          settings: {},
        },
      ],
    });

    // Start first
    await runtime.start();
    expect(runtime.isStarted).toBe(true);

    // Stop then immediately start — start queues behind stop
    const stopP = runtime.stop();
    const startP = runtime.start();

    await Promise.all([stopP, startP]);

    // After both settle, should be started
    expect(runtime.isStarted).toBe(true);
    expect(connectionManager.connect).toHaveBeenCalledTimes(2);
  });

  it("requeueExpiredReceipts does not requeue when any outbox row exists (pending)", async () => {
    const persistence = {
      requeueExpiredReceipts: vi.fn(() => 0),
    };
    const runtime = new ChannelRuntime({
      agentId: "agent-1",
      policy,
      execute: vi.fn(async () => undefined),
      persistence,
    });

    await runtime.start();

    expect(persistence.requeueExpiredReceipts).toHaveBeenCalledOnce();
  });

  it("cancels active streams during startup", async () => {
    const cancelActiveStreams = vi.fn();
    const persistence = {
      requeueExpiredReceipts: vi.fn(() => 0),
      cancelActiveStreams,
    };
    const runtime = new ChannelRuntime({
      agentId: "agent-1",
      policy,
      execute: vi.fn(async () => undefined),
      persistence,
    });

    await runtime.start();

    expect(cancelActiveStreams).toHaveBeenCalledOnce();
  });

  // ── Command bridge: built-in commands ──

  it("handles built-in /whoami without invoking Agent", async () => {
    const execute = vi.fn(async () => undefined);
    const send = vi.fn(async () => ({
      version: 1 as const,
      generation: 1,
      accepted: true,
      committed: true,
      outcome: "committed" as const,
      idempotencyKey: "kp",
    }));
    const claimOutbound = vi.fn(() => true);
    const commit = vi.fn();

    const runtime = new ChannelRuntime({
      agentId: "agent-1",
      policy: { ...policy, allowedCommands: ["whoami", "help"] },
      execute,
      connectionManager: {
        send,
        connect: vi.fn(async () => undefined),
        disconnectAll: vi.fn(async () => undefined),
      },
      persistence: {
        claimOutboundDelivery: claimOutbound,
        commitOutboundAndReceipt: commit,
        markOutboundFailed: vi.fn(),
        markOutboundUnknown: vi.fn(),
        requeueExpiredReceipts: vi.fn(() => 0),
      },
    });

    const command = {
      version: 1 as const,
      generation: 1,
      id: "cmd-whoami",
      name: "whoami",
      args: [],
      message: message("allowed"),
    };

    const decision = await runtime.handleCommand(command);

    expect(decision).toEqual({ allowed: true });
    expect(execute).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(
      "telegram-1",
      expect.objectContaining({ kind: "reply" }),
    );
    expect(claimOutbound).toHaveBeenCalled();
    expect(commit).toHaveBeenCalled();
  });

  it("handles built-in /help without invoking Agent", async () => {
    const execute = vi.fn(async () => undefined);
    const send = vi.fn(async () => ({
      version: 1 as const,
      generation: 1,
      accepted: true,
      committed: true,
      outcome: "committed" as const,
      idempotencyKey: "kp",
    }));

    const runtime = new ChannelRuntime({
      agentId: "agent-1",
      policy: { ...policy, allowedCommands: ["whoami", "help", "compact"] },
      execute,
      connectionManager: {
        send,
        connect: vi.fn(async () => undefined),
        disconnectAll: vi.fn(async () => undefined),
      },
      persistence: {
        claimOutboundDelivery: vi.fn(() => true),
        commitOutboundAndReceipt: vi.fn(),
        markOutboundFailed: vi.fn(),
        markOutboundUnknown: vi.fn(),
        requeueExpiredReceipts: vi.fn(() => 0),
      },
    });

    const command = {
      version: 1 as const,
      generation: 1,
      id: "cmd-help",
      name: "help",
      args: [],
      message: message("allowed"),
    };

    const decision = await runtime.handleCommand(command);

    expect(decision).toEqual({ allowed: true });
    expect(execute).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(
      "telegram-1",
      expect.objectContaining({
        text: expect.stringContaining("Built-in commands") as string,
      }),
    );
  });

  it("denies built-in command when command policy forbids it", async () => {
    const execute = vi.fn(async () => undefined);
    const runtime = new ChannelRuntime({
      agentId: "agent-1",
      policy: { ...policy, allowedCommands: ["help"] },
      execute,
    });

    const command = {
      version: 1 as const,
      generation: 1,
      id: "cmd-whoami-deny",
      name: "whoami",
      args: [],
      message: message("allowed"),
    };

    const decision = await runtime.handleCommand(command);

    expect(decision).toEqual({ allowed: false, reason: "COMMAND_NOT_ALLOWED" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("denies built-in command when message policy denies the user", async () => {
    const execute = vi.fn(async () => undefined);
    const runtime = new ChannelRuntime({
      agentId: "agent-1",
      policy: { ...policy, allowedCommands: ["whoami", "help"] },
      execute,
    });

    const command = {
      version: 1 as const,
      generation: 1,
      id: "cmd-whoami-blocked",
      name: "whoami",
      args: [],
      message: message("blocked"),
    };

    const decision = await runtime.handleCommand(command);

    expect(decision).toEqual({ allowed: false, reason: "DENIED_USER" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("routes non-built-in command through Agent", async () => {
    const execute = vi.fn(async () => undefined);
    const runtime = new ChannelRuntime({
      agentId: "agent-1",
      policy: { ...policy, allowedCommands: ["compact"] },
      execute,
    });

    const command = {
      version: 1 as const,
      generation: 1,
      id: "cmd-compact",
      name: "compact",
      args: [],
      message: message("allowed"),
    };

    await runtime.handleCommand(command);

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "allowed" }),
      message("allowed"),
      expect.any(Object),
    );
  });

  it("masks IDs in /whoami response (last 4 chars only)", async () => {
    const send = vi.fn(async () => ({
      version: 1 as const,
      generation: 1,
      accepted: true,
      committed: true,
      outcome: "committed" as const,
      idempotencyKey: "kp",
    }));

    const runtime = new ChannelRuntime({
      agentId: "agent-1",
      policy: { ...policy, allowedCommands: ["whoami"] },
      execute: vi.fn(async () => undefined),
      connectionManager: {
        send,
        connect: vi.fn(async () => undefined),
        disconnectAll: vi.fn(async () => undefined),
      },
      persistence: {
        claimOutboundDelivery: vi.fn(() => true),
        commitOutboundAndReceipt: vi.fn(),
        markOutboundFailed: vi.fn(),
        markOutboundUnknown: vi.fn(),
        requeueExpiredReceipts: vi.fn(() => 0),
      },
    });

    const msg = message("allowed");
    msg.channelInstanceId = "telegram-instance-abc123";
    msg.chatId = "chat-long-id-xyz789";
    msg.userId = "user-display-qw12";

    await runtime.handleCommand({
      version: 1,
      generation: 1,
      id: "cmd-1",
      name: "whoami",
      args: [],
      message: msg,
    });

    const responseText = (send.mock.calls[0] as unknown as [string, { text: string }] | undefined)?.[1].text ?? "";
    expect(responseText).toContain("****c123");
    expect(responseText).toContain("****z789");
    expect(responseText).toContain("****qw12");
    // Full unmasked IDs are never present (except last 4 chars which are visible)
    expect(responseText).not.toContain("abc123");
    expect(responseText).not.toContain("xyz789");
  });

  it("applies different policies to different channel instances", async () => {
    const execute = vi.fn(async () => undefined);
    const runtime = new ChannelRuntime({
      agentId: "agent-1",
      policy,
      instancePolicies: {
        "telegram-1": { ...policy, enabled: false },
        "discord-1": { ...policy, deniedUsers: [] },
      },
      execute,
    });

    const denied = await runtime.handleMessage(message("allowed"));
    const allowed = await runtime.handleMessage({
      ...message("allowed"),
      id: "discord-message",
      channelType: "discord",
      channelInstanceId: "discord-1",
    });

    expect(denied).toEqual({ allowed: false, reason: "CHANNEL_DISABLED" });
    expect(allowed).toEqual({ allowed: true });
    expect(execute).toHaveBeenCalledOnce();
  });

  // ── ConnectionManager command parsing ──

  it("parses /command text into ChannelCommand in ConnectionManager", async () => {
    const { ConnectionManager } = await import("../connection-manager");
    const { ChannelRegistry } = await import("../channel-registry");

    const registry = new ChannelRegistry();
    let emitMessage: ((m: UnifiedMessage) => void) | undefined;
    registry.register("telegram", (_c, generation) => ({
      channelType: "telegram" as const,
      channelInstanceId: "telegram-1",
      generation,
      connected: true,
      connect: vi.fn(async () => undefined),
      disconnect: vi.fn(async () => undefined),
      send: vi.fn(async () => ({
        version: 1 as const,
        generation,
        accepted: true,
        committed: true,
        outcome: "committed" as const,
        idempotencyKey: "k",
      })),
      onMessage: vi.fn((handler: (m: UnifiedMessage) => void) => {
        emitMessage = handler;
        return () => { emitMessage = undefined; };
      }),
      onCommand: vi.fn(() => () => undefined),
      onInteraction: () => () => undefined,
      onStatus: () => () => undefined,
      onError: () => () => undefined,
    }));

    const onMessage = vi.fn();
    const onCommand = vi.fn();
    const config: ChannelAdapterConfig = {
      channelType: "telegram",
      channelInstanceId: "telegram-1",
      agentId: "agent-1",
      settings: {},
    };
    const manager = new ConnectionManager(registry, { onMessage, onCommand });
    await manager.connect(config);

    // Slash-prefixed text -> onCommand with parsed name and args
    emitMessage?.({
      ...message("allowed"),
      text: "/compact  --all  verbose",
    });
    expect(onCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "compact",
        args: ["--all", "verbose"],
      }),
    );
    expect(onMessage).not.toHaveBeenCalled();

    // Plain text -> onMessage
    onCommand.mockReset();
    onMessage.mockReset();
    emitMessage?.(message("allowed"));
    expect(onMessage).toHaveBeenCalled();
    expect(onCommand).not.toHaveBeenCalled();
  });
});
