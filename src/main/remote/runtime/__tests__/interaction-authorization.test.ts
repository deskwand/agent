/**
 * Full-path interaction authorization tests:
 * ConnectionManager → ChannelRuntime → persistence.
 *
 * Proves:
 *  - ConnectionManager stamps channelType/channelInstanceId on interactions
 *  - ChannelRuntime.authorizeInteraction persists authorization
 *  - ChannelRuntime.handleInteraction atomically consumes and calls callback
 *  - Wrong user/chat/instance/generation denied with typed decision
 *  - Expired interactions denied
 *  - Already-consumed interactions denied
 *  - Persistence survives restart (second ChannelRuntime on same DB)
 */

import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChannelRegistry } from "../channel-registry";
import { ConnectionManager } from "../connection-manager";
import { ChannelRuntime } from "../channel-runtime";
import { ChannelRuntimePersistence } from "../persistence";
import type {
  ChannelAdapter,
  ChannelAdapterConfig,
  ChannelAdapterFactory,
} from "../channel-adapter";
import type {
  ChannelInteraction,
  ChannelStatusEvent,
  DeliveryResult,
  OutboundMessage,
} from "../contracts";
import type { ChannelPolicyConfig } from "../policy-engine";

// ---------------------------------------------------------------------------
// Fake adapter
// ---------------------------------------------------------------------------

class FakeInteractAdapter implements ChannelAdapter {
  readonly channelType = "telegram" as const;
  readonly channelInstanceId: string;
  readonly generation: number;
  private _connected = false;
  get connected(): boolean {
    return this._connected;
  }
  private interactionHandler?: (interaction: ChannelInteraction) => void;
  private statusHandler?: (s: ChannelStatusEvent) => void;

  constructor(config: ChannelAdapterConfig, generation: number) {
    this.channelInstanceId = config.channelInstanceId;
    this.generation = generation;
  }

  async connect(): Promise<void> {
    this._connected = true;
    this.statusHandler?.({
      version: 1,
      channelType: "telegram",
      channelInstanceId: this.channelInstanceId,
      generation: this.generation,
      state: "connected",
      timestamp: Date.now(),
    });
  }

  async disconnect(): Promise<void> {
    this._connected = false;
  }

  async send(_message: OutboundMessage): Promise<DeliveryResult> {
    return {
      version: 1,
      generation: this.generation,
      accepted: true,
      committed: true,
      outcome: "committed",
      idempotencyKey: _message.idempotencyKey,
    };
  }

  injectInteraction(interaction: ChannelInteraction): void {
    this.interactionHandler?.(interaction);
  }

  onMessage(): () => void {
    return () => undefined;
  }
  onCommand(): () => void {
    return () => undefined;
  }
  onInteraction(
    h: (interaction: ChannelInteraction) => void,
  ): () => void {
    this.interactionHandler = h;
    return () => {
      this.interactionHandler = undefined;
    };
  }
  onStatus(h: (s: ChannelStatusEvent) => void): () => void {
    this.statusHandler = h;
    return () => {
      this.statusHandler = undefined;
    };
  }
  onError(): () => void {
    return () => undefined;
  }
}

function fakeAdapterFactory(): ChannelAdapterFactory {
  return (config, generation) =>
    new FakeInteractAdapter(config, generation);
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

const INSTANCE_ID = "telegram-1";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInteraction(
  overrides: Partial<ChannelInteraction> = {},
): ChannelInteraction {
  return {
    version: 1,
    generation: 1,
    id: "int-1",
    channelType: "telegram",
    channelInstanceId: INSTANCE_ID,
    userId: "user-a",
    chatId: "chat-1",
    messageId: "msg-1",
    value: { action: "test" },
    expiresAt: Date.now() + 60_000,
    ...overrides,
  };
}

function createDatabase(): DatabaseSync {
  return new DatabaseSync(":memory:");
}

let database: DatabaseSync | undefined;

afterEach(() => {
  database?.close();
  database = undefined;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ConnectionManager interaction stamping", () => {
  it("stamps channelType and channelInstanceId on forwarded interactions", async () => {
    const registry = new ChannelRegistry();
    registry.register("telegram", fakeAdapterFactory());

    const receivedInteractions: ChannelInteraction[] = [];
    const manager = new ConnectionManager(registry, {
      onInteraction: (interaction) => {
        receivedInteractions.push(interaction);
      },
    });

    await manager.connect({
      channelType: "telegram",
      channelInstanceId: INSTANCE_ID,
      agentId: "agent-1",
      settings: {},
    });

    const adapter = manager.resolveAdapter(INSTANCE_ID) as FakeInteractAdapter;
    expect(adapter).toBeDefined();

    // Inject an interaction without channelType/channelInstanceId (simulating
    // adapter that doesn't set them)
    adapter.injectInteraction({
      version: 1,
      generation: 1,
      id: "raw-int",
      userId: "user-a",
      chatId: "chat-1",
      messageId: "msg-1",
      value: { pressed: true },
      expiresAt: Date.now() + 60_000,
    } as ChannelInteraction);

    expect(receivedInteractions).toHaveLength(1);
    expect(receivedInteractions[0].channelType).toBe("telegram");
    expect(receivedInteractions[0].channelInstanceId).toBe(INSTANCE_ID);

    await manager.disconnectAll("test");
  });

  it("preserves generation filtering on stamped interactions", async () => {
    const registry = new ChannelRegistry();
    registry.register("telegram", fakeAdapterFactory());

    const receivedInteractions: ChannelInteraction[] = [];
    const manager = new ConnectionManager(registry, {
      onInteraction: (interaction) => {
        receivedInteractions.push(interaction);
      },
    });

    await manager.connect({
      channelType: "telegram",
      channelInstanceId: INSTANCE_ID,
      agentId: "agent-1",
      settings: {},
    });

    const adapter = manager.resolveAdapter(INSTANCE_ID) as FakeInteractAdapter;

    // Inject stale generation interaction
    adapter.injectInteraction({
      version: 1,
      generation: 0, // stale
      id: "stale-int",
      userId: "user-a",
      chatId: "chat-1",
      messageId: "msg-1",
      value: { pressed: true },
      expiresAt: Date.now() + 60_000,
    } as ChannelInteraction);

    // Stale generation must be filtered out
    expect(receivedInteractions).toHaveLength(0);

    await manager.disconnectAll("test");
  });
});

describe("ChannelRuntime interaction authorization", () => {
  it("authorizes interaction, then atomically consumes and calls callback", async () => {
    database = createDatabase();
    const persistence = new ChannelRuntimePersistence(
      database,
      Buffer.alloc(32, 7),
    );

    const callbackCalls: ChannelInteraction[] = [];
    const runtime = new ChannelRuntime({
      agentId: "agent-1",
      policy: DEFAULT_POLICY,
      execute: async () => undefined,
      interactionPersistence: persistence,
      executeInteraction: async (interaction) => {
        callbackCalls.push(interaction);
      },
    });

    const interaction = makeInteraction();

    // Authorize first
    runtime.authorizeInteraction(interaction);

    // Then handle (consume + callback)
    const result = await runtime.handleInteraction(interaction);
    expect(result.decision).toBe("authorized");
    expect(callbackCalls).toHaveLength(1);
    expect(callbackCalls[0].id).toBe("int-1");
  });

  it("returns unauthorized_not_found for unauthorized interaction", async () => {
    database = createDatabase();
    const persistence = new ChannelRuntimePersistence(
      database,
      Buffer.alloc(32, 7),
    );

    const runtime = new ChannelRuntime({
      agentId: "agent-1",
      policy: DEFAULT_POLICY,
      execute: async () => undefined,
      interactionPersistence: persistence,
      executeInteraction: async () => undefined,
    });

    const result = await runtime.handleInteraction(makeInteraction());
    expect(result.decision).toBe("unauthorized_not_found");
  });

  it("returns unauthorized_already_consumed on double consumption", async () => {
    database = createDatabase();
    const persistence = new ChannelRuntimePersistence(
      database,
      Buffer.alloc(32, 7),
    );

    const runtime = new ChannelRuntime({
      agentId: "agent-1",
      policy: DEFAULT_POLICY,
      execute: async () => undefined,
      interactionPersistence: persistence,
      executeInteraction: async () => undefined,
    });

    const interaction = makeInteraction();
    runtime.authorizeInteraction(interaction);

    const first = await runtime.handleInteraction(interaction);
    expect(first.decision).toBe("authorized");

    const second = await runtime.handleInteraction(interaction);
    expect(second.decision).toBe("unauthorized_already_consumed");
  });

  it("returns unauthorized_wrong_user on userId mismatch", async () => {
    database = createDatabase();
    const persistence = new ChannelRuntimePersistence(
      database,
      Buffer.alloc(32, 7),
    );

    const runtime = new ChannelRuntime({
      agentId: "agent-1",
      policy: DEFAULT_POLICY,
      execute: async () => undefined,
      interactionPersistence: persistence,
      executeInteraction: async () => undefined,
    });

    const interaction = makeInteraction();
    runtime.authorizeInteraction(interaction);

    const result = await runtime.handleInteraction(
      makeInteraction({ userId: "user-b" }),
    );
    expect(result.decision).toBe("unauthorized_wrong_user");
  });

  it("rejects a substituted interaction value without consuming", async () => {
    database = createDatabase();
    const persistence = new ChannelRuntimePersistence(
      database,
      Buffer.alloc(32, 7),
    );
    const executeInteraction = vi.fn(async () => undefined);
    const runtime = new ChannelRuntime({
      agentId: "agent-1",
      policy: DEFAULT_POLICY,
      execute: async () => undefined,
      interactionPersistence: persistence,
      executeInteraction,
    });
    const interaction = makeInteraction({ value: { action: "approve" } });
    runtime.authorizeInteraction(interaction);

    const forged = await runtime.handleInteraction(
      makeInteraction({ value: { action: "delete" } }),
    );
    expect(forged.decision).toBe("unauthorized_wrong_value");
    expect(executeInteraction).not.toHaveBeenCalled();

    const valid = await runtime.handleInteraction(interaction);
    expect(valid.decision).toBe("authorized");
  });

  it("returns unauthorized_wrong_chat on chatId mismatch", async () => {
    database = createDatabase();
    const persistence = new ChannelRuntimePersistence(
      database,
      Buffer.alloc(32, 7),
    );

    const runtime = new ChannelRuntime({
      agentId: "agent-1",
      policy: DEFAULT_POLICY,
      execute: async () => undefined,
      interactionPersistence: persistence,
      executeInteraction: async () => undefined,
    });

    const interaction = makeInteraction();
    runtime.authorizeInteraction(interaction);

    const result = await runtime.handleInteraction(
      makeInteraction({ chatId: "chat-2" }),
    );
    expect(result.decision).toBe("unauthorized_wrong_chat");
  });

  it("returns unauthorized_wrong_instance on instance mismatch", async () => {
    database = createDatabase();
    const persistence = new ChannelRuntimePersistence(
      database,
      Buffer.alloc(32, 7),
    );

    const runtime = new ChannelRuntime({
      agentId: "agent-1",
      policy: DEFAULT_POLICY,
      execute: async () => undefined,
      interactionPersistence: persistence,
      executeInteraction: async () => undefined,
    });

    const interaction = makeInteraction();
    runtime.authorizeInteraction(interaction);

    const result = await runtime.handleInteraction(
      makeInteraction({ channelInstanceId: "other-instance" }),
    );
    expect(result.decision).toBe("unauthorized_wrong_instance");
  });

  it("returns unauthorized_wrong_generation on generation mismatch", async () => {
    database = createDatabase();
    const persistence = new ChannelRuntimePersistence(
      database,
      Buffer.alloc(32, 7),
    );

    const runtime = new ChannelRuntime({
      agentId: "agent-1",
      policy: DEFAULT_POLICY,
      execute: async () => undefined,
      interactionPersistence: persistence,
      executeInteraction: async () => undefined,
    });

    const interaction = makeInteraction();
    runtime.authorizeInteraction(interaction);

    const result = await runtime.handleInteraction(
      makeInteraction({ generation: 2 }),
    );
    expect(result.decision).toBe("unauthorized_wrong_generation");
  });

  it("returns unauthorized_expired when expiresAt is in the past", async () => {
    database = createDatabase();
    const persistence = new ChannelRuntimePersistence(
      database,
      Buffer.alloc(32, 7),
    );

    const runtime = new ChannelRuntime({
      agentId: "agent-1",
      policy: DEFAULT_POLICY,
      execute: async () => undefined,
      interactionPersistence: persistence,
      executeInteraction: async () => undefined,
    });

    const interaction = makeInteraction({ expiresAt: 100 });
    runtime.authorizeInteraction(interaction);

    const result = await runtime.handleInteraction(interaction);
    expect(result.decision).toBe("unauthorized_expired");
  });

  it("returns unauthorized_not_found when no interactionPersistence configured", async () => {
    const runtime = new ChannelRuntime({
      agentId: "agent-1",
      policy: DEFAULT_POLICY,
      execute: async () => undefined,
      // No interactionPersistence
    });

    const result = await runtime.handleInteraction(makeInteraction());
    expect(result.decision).toBe("unauthorized_not_found");
  });
});

describe("persistence restart behavior", () => {
  it("new ChannelRuntime on same DB sees existing authorizations", async () => {
    database = createDatabase();
    const persistence = new ChannelRuntimePersistence(
      database,
      Buffer.alloc(32, 7),
    );

    // First runtime: authorize
    const runtime1 = new ChannelRuntime({
      agentId: "agent-1",
      policy: DEFAULT_POLICY,
      execute: async () => undefined,
      interactionPersistence: persistence,
      executeInteraction: async () => undefined,
    });
    const interaction = makeInteraction();
    runtime1.authorizeInteraction(interaction);

    // Second runtime on same DB: should be able to consume
    const persistence2 = new ChannelRuntimePersistence(
      database,
      Buffer.alloc(32, 7),
    );
    const runtime2 = new ChannelRuntime({
      agentId: "agent-1",
      policy: DEFAULT_POLICY,
      execute: async () => undefined,
      interactionPersistence: persistence2,
      executeInteraction: async () => undefined,
    });

    const result = await runtime2.handleInteraction(interaction);
    expect(result.decision).toBe("authorized");
  });

  it("consumed authorization stays consumed across restarts", async () => {
    database = createDatabase();
    const persistence = new ChannelRuntimePersistence(
      database,
      Buffer.alloc(32, 7),
    );

    // First runtime: authorize + consume
    const runtime1 = new ChannelRuntime({
      agentId: "agent-1",
      policy: DEFAULT_POLICY,
      execute: async () => undefined,
      interactionPersistence: persistence,
      executeInteraction: async () => undefined,
    });
    const interaction = makeInteraction();
    runtime1.authorizeInteraction(interaction);
    const first = await runtime1.handleInteraction(interaction);
    expect(first.decision).toBe("authorized");

    // Second runtime on same DB: should be already consumed
    const persistence2 = new ChannelRuntimePersistence(
      database,
      Buffer.alloc(32, 7),
    );
    const runtime2 = new ChannelRuntime({
      agentId: "agent-1",
      policy: DEFAULT_POLICY,
      execute: async () => undefined,
      interactionPersistence: persistence2,
      executeInteraction: async () => undefined,
    });

    const second = await runtime2.handleInteraction(interaction);
    expect(second.decision).toBe("unauthorized_already_consumed");
  });
});

describe("interaction authorization edge cases", () => {
  it("duplicate authorization after consume cannot rearm", async () => {
    database = createDatabase();
    const persistence = new ChannelRuntimePersistence(
      database,
      Buffer.alloc(32, 7),
    );

    const callbackCalls: ChannelInteraction[] = [];
    const runtime = new ChannelRuntime({
      agentId: "agent-1",
      policy: DEFAULT_POLICY,
      execute: async () => undefined,
      interactionPersistence: persistence,
      executeInteraction: async (interaction) => {
        callbackCalls.push(interaction);
      },
    });

    const interaction = makeInteraction();

    // First auth + consume
    runtime.authorizeInteraction(interaction);
    const first = await runtime.handleInteraction(interaction);
    expect(first.decision).toBe("authorized");
    expect(callbackCalls).toHaveLength(1);

    // Re-authorize the same interaction after consumption
    runtime.authorizeInteraction(interaction);

    // Must still be consumed — re-auth does not rearm
    const second = await runtime.handleInteraction(interaction);
    expect(second.decision).toBe("unauthorized_already_consumed");
    expect(callbackCalls).toHaveLength(1);
  });

  it("same interactionId exists safely in distinct scoped keys", async () => {
    database = createDatabase();
    const persistence = new ChannelRuntimePersistence(
      database,
      Buffer.alloc(32, 7),
    );

    const callbackCalls: ChannelInteraction[] = [];
    const runtime = new ChannelRuntime({
      agentId: "agent-1",
      policy: DEFAULT_POLICY,
      execute: async () => undefined,
      interactionPersistence: persistence,
      executeInteraction: async (interaction) => {
        callbackCalls.push(interaction);
      },
    });

    // Two interactions with same id but different chatId (scoped keys)
    const interactionA = makeInteraction({ id: "shared-id", chatId: "chat-a", userId: "user-a" });
    const interactionB = makeInteraction({ id: "shared-id", chatId: "chat-b", userId: "user-b" });

    runtime.authorizeInteraction(interactionA);
    runtime.authorizeInteraction(interactionB);

    // Consume A — B remains authorized
    const resultA = await runtime.handleInteraction(interactionA);
    expect(resultA.decision).toBe("authorized");

    // Consume B — must still succeed
    const resultB = await runtime.handleInteraction(interactionB);
    expect(resultB.decision).toBe("authorized");

    expect(callbackCalls).toHaveLength(2);
  });

  it("callback absent returns unhandled without consume", async () => {
    database = createDatabase();
    const persistence = new ChannelRuntimePersistence(
      database,
      Buffer.alloc(32, 7),
    );

    // No executeInteraction callback
    const runtime = new ChannelRuntime({
      agentId: "agent-1",
      policy: DEFAULT_POLICY,
      execute: async () => undefined,
      interactionPersistence: persistence,
      // executeInteraction intentionally omitted
    });

    const interaction = makeInteraction();
    runtime.authorizeInteraction(interaction);

    const result = await runtime.handleInteraction(interaction);
    expect(result.decision).toBe("unhandled");

    // The interaction must NOT have been consumed
    const records = persistence.getInteractionAuthorizations(interaction.id);
    const match = records.find(
      (r) =>
        r.interactionId === interaction.id &&
        r.channelInstanceId === interaction.channelInstanceId,
    );
    expect(match?.consumedAt).toBeNull();
  });

  it("callback throw returns failed and stays consumed", async () => {
    database = createDatabase();
    const persistence = new ChannelRuntimePersistence(
      database,
      Buffer.alloc(32, 7),
    );

    const callbackCalls: ChannelInteraction[] = [];
    const runtime = new ChannelRuntime({
      agentId: "agent-1",
      policy: DEFAULT_POLICY,
      execute: async () => undefined,
      interactionPersistence: persistence,
      executeInteraction: async (interaction) => {
        callbackCalls.push(interaction);
        throw new Error("callback failure");
      },
    });

    const interaction = makeInteraction();
    runtime.authorizeInteraction(interaction);

    const result = await runtime.handleInteraction(interaction);
    expect(result.decision).toBe("failed");
    expect(callbackCalls).toHaveLength(1);

    // Must still be consumed — cannot retry after callback throw
    const second = await runtime.handleInteraction(interaction);
    expect(second.decision).toBe("unauthorized_already_consumed");
  });
});

describe("ConnectionManager → ChannelRuntime full path", () => {
  it("full flow: CM stamps → Runtime authorizes → Runtime handles → callback fires", async () => {
    database = createDatabase();
    const persistence = new ChannelRuntimePersistence(
      database,
      Buffer.alloc(32, 7),
    );

    const callbackCalls: ChannelInteraction[] = [];
    const runtime = new ChannelRuntime({
      agentId: "agent-1",
      policy: DEFAULT_POLICY,
      execute: async () => undefined,
      interactionPersistence: persistence,
      executeInteraction: async (interaction) => {
        callbackCalls.push(interaction);
      },
    });

    const registry = new ChannelRegistry();
    registry.register("telegram", fakeAdapterFactory());

    const receivedInteractions: ChannelInteraction[] = [];
    const manager = new ConnectionManager(registry, {
      onInteraction: (interaction) => {
        receivedInteractions.push(interaction);
        // Full path: authorize + handle
        runtime.authorizeInteraction(interaction);
        void runtime.handleInteraction(interaction);
      },
    });

    await manager.connect({
      channelType: "telegram",
      channelInstanceId: INSTANCE_ID,
      agentId: "agent-1",
      settings: {},
    });

    const adapter = manager.resolveAdapter(INSTANCE_ID) as FakeInteractAdapter;

    const interaction: ChannelInteraction = {
      version: 1,
      generation: 1,
      id: "full-path-1",
      userId: "user-a",
      chatId: "chat-1",
      messageId: "msg-1",
      value: { action: "test" },
      expiresAt: Date.now() + 60_000,
      channelType: "telegram",
      channelInstanceId: INSTANCE_ID,
    };
    adapter.injectInteraction(interaction);

    // Allow the async handleInteraction to complete
    await vi.waitFor(
      () => {
        expect(callbackCalls).toHaveLength(1);
        expect(callbackCalls[0].id).toBe("full-path-1");
        // CM stamped fields
        expect(callbackCalls[0].channelType).toBe("telegram");
        expect(callbackCalls[0].channelInstanceId).toBe(INSTANCE_ID);
      },
      { timeout: 1000 },
    );

    await manager.disconnectAll("test");
  });
});
