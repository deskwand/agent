/**
 * Generation-race tests for ConnectionManager.
 *
 * Proves:
 *  - send succeeds only for same-generation connection
 *  - stale generation is rejected with permanent_failure
 *  - adapter superseded during send returns unknown
 *  - lookupDelivery validates generation and current connection
 *  - lookupDelivery uses adapter.lookupDelivery (not lookupMessage)
 */

import { describe, expect, it } from "vitest";
import { ConnectionManager } from "../../main/remote/runtime/connection-manager";
import { ChannelRegistry } from "../../main/remote/runtime/channel-registry";
import type {
  ChannelAdapter,
  ChannelAdapterConfig,
  ChannelAdapterFactory,
} from "../../main/remote/runtime/channel-adapter";
import type {
  OutboundMessage,
  UnifiedMessage,
  DeliveryResult,
  ChannelStatusEvent,
} from "../../main/remote/runtime/contracts";

// ---------------------------------------------------------------------------
// Fake adapter with controllable generation and send behavior
// ---------------------------------------------------------------------------

interface FakeAdapterInternals {
  generation: number;
  sendResult: DeliveryResult;
  sendDelayMs: number;
  lookupDelayMs: number;
  lookupResult?: DeliveryResult;
  messageHandler?: (msg: UnifiedMessage) => void;
  statusHandler?: (status: ChannelStatusEvent) => void;
  connected: boolean;
}

const adapterInstances = new Map<string, FakeAdapterInternals>();

function createFakeAdapter(
  config: ChannelAdapterConfig,
  generation: number,
): ChannelAdapter {
  const internals: FakeAdapterInternals = {
    generation,
    sendResult: {
      version: 1,
      generation,
      accepted: true,
      committed: true,
      outcome: "committed",
      idempotencyKey: "",
    },
    sendDelayMs: 0,
    lookupDelayMs: 0,
    connected: false,
  };
  adapterInstances.set(config.channelInstanceId, internals);

  const adapter: ChannelAdapter = {
    channelType: config.channelType,
    channelInstanceId: config.channelInstanceId,
    generation,
    get connected(): boolean {
      return internals.connected;
    },

    async connect(): Promise<void> {
      internals.connected = true;
      internals.statusHandler?.({
        version: 1,
        channelType: config.channelType,
        channelInstanceId: config.channelInstanceId,
        generation,
        state: "connected",
        timestamp: Date.now(),
      });
    },

    async disconnect(): Promise<void> {
      internals.connected = false;
    },

    async send(message: OutboundMessage): Promise<DeliveryResult> {
      if (internals.sendDelayMs > 0) {
        await new Promise((r) => setTimeout(r, internals.sendDelayMs));
      }
      return {
        ...internals.sendResult,
        idempotencyKey: message.idempotencyKey,
      };
    },

    async lookupDelivery(
      idempotencyKey: string,
    ): Promise<DeliveryResult> {
      if (internals.lookupDelayMs > 0) {
        await new Promise((r) => setTimeout(r, internals.lookupDelayMs));
      }
      if (!internals.lookupResult) {
        return {
          version: 1,
          generation: internals.generation,
          accepted: false,
          committed: false,
          outcome: "unknown",
          idempotencyKey,
        };
      }
      return { ...internals.lookupResult, idempotencyKey };
    },

    onMessage(h: (msg: UnifiedMessage) => void): () => void {
      internals.messageHandler = h;
      return () => {
        internals.messageHandler = undefined;
      };
    },

    onCommand(): () => void {
      return () => undefined;
    },
    onInteraction(): () => void {
      return () => undefined;
    },
    onStatus(h: (status: ChannelStatusEvent) => void): () => void {
      internals.statusHandler = h;
      return () => {
        internals.statusHandler = undefined;
      };
    },
    onError(): () => void {
      return () => undefined;
    },
  };
  return adapter;
}

function fakeAdapterFactory(): ChannelAdapterFactory {
  return (config, generation) => createFakeAdapter(config, generation);
}

function makeOutboundMessage(
  generation: number,
  idempotencyKey = "key-1",
): OutboundMessage {
  return {
    version: 1,
    generation,
    idempotencyKey,
    target: {
      version: 1,
      channelType: "telegram",
      channelInstanceId: "telegram-1",
      chatId: "chat-1",
      visibility: "chat",
    },
    text: "hello",
    kind: "reply",
  };
}

async function buildConnectedManager(): Promise<{
  manager: ConnectionManager;
  internals: FakeAdapterInternals;
}> {
  const registry = new ChannelRegistry();
  registry.register("telegram", fakeAdapterFactory());

  const manager = new ConnectionManager(registry);

  await manager.connect({
    channelType: "telegram",
    channelInstanceId: "telegram-1",
    agentId: "agent-1",
    settings: {},
  });

  const internals = adapterInstances.get("telegram-1");
  if (!internals) throw new Error("adapter not found");

  return { manager, internals };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ConnectionManager generation race", () => {
  // -----------------------------------------------------------------------
  // send succeeds only for same-generation connection
  // -----------------------------------------------------------------------

  it("succeeds for same-generation connection", async () => {
    const { manager, internals } = await buildConnectedManager();

    const msg = makeOutboundMessage(internals.generation);
    const result = await manager.send("telegram-1", msg);

    expect(result.accepted).toBe(true);
    expect(result.committed).toBe(true);
    expect(result.outcome).toBe("committed");
    expect(result.errorCode).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // stale generation is rejected
  // -----------------------------------------------------------------------

  it("rejects stale generation with permanent_failure and CHANNEL_GENERATION_MISMATCH", async () => {
    const { manager, internals } = await buildConnectedManager();

    const staleMsg = makeOutboundMessage(internals.generation - 1);
    const result = await manager.send("telegram-1", staleMsg);

    expect(result.accepted).toBe(false);
    expect(result.committed).toBe(false);
    expect(result.outcome).toBe("permanent_failure");
    expect(result.errorCode).toBe("CHANNEL_GENERATION_MISMATCH");
  });

  // -----------------------------------------------------------------------
  // send to non-existent channel returns permanent_failure
  // -----------------------------------------------------------------------

  it("returns permanent_failure for non-existent channel", async () => {
    const { manager } = await buildConnectedManager();

    const msg = makeOutboundMessage(1, "orphan-key");
    const result = await manager.send("nonexistent", msg);

    expect(result.accepted).toBe(false);
    expect(result.committed).toBe(false);
    expect(result.outcome).toBe("permanent_failure");
    expect(result.errorCode).toBe("CHANNEL_NOT_CONNECTED");
  });

  // -----------------------------------------------------------------------
  // adapter superseded during send returns unknown
  // -----------------------------------------------------------------------

  it("returns unknown when adapter is superseded during send", async () => {
    const registry = new ChannelRegistry();
    registry.register("telegram", fakeAdapterFactory());

    const manager = new ConnectionManager(registry);

    await manager.connect({
      channelType: "telegram",
      channelInstanceId: "telegram-1",
      agentId: "agent-1",
      settings: {},
    });

    const internals = adapterInstances.get("telegram-1")!;
    const originalGeneration = internals.generation;

    // Set a delay so we can supersede during send
    internals.sendDelayMs = 20;
    internals.sendResult = {
      version: 1,
      generation: originalGeneration,
      accepted: true,
      committed: true,
      outcome: "committed",
      idempotencyKey: "",
    };

    // Start a send (don't await yet)
    const msg = makeOutboundMessage(originalGeneration, "race-key");
    const sendPromise = manager.send("telegram-1", msg);

    // Immediately reconnect (creates new generation, replacing active connection)
    await manager.connect({
      channelType: "telegram",
      channelInstanceId: "telegram-1",
      agentId: "agent-1",
      settings: {},
    });

    const result = await sendPromise;

    // The send completed but the connection was superseded
    expect(result.outcome).toBe("unknown");
    expect(result.errorCode).toBe("CHANNEL_CONNECTION_SUPERSEDED");
  });

  // -----------------------------------------------------------------------
  // lookupDelivery validates generation
  // -----------------------------------------------------------------------

  it("lookupDelivery validates generation against active connection", async () => {
    const { manager, internals } = await buildConnectedManager();

    internals.lookupResult = {
      version: 1,
      generation: internals.generation,
      accepted: true,
      committed: true,
      outcome: "committed",
      idempotencyKey: "key-1",
      platformMessageId: "plat-1",
    };

    // Same generation lookup succeeds
    const result = await manager.lookupDelivery(
      "telegram-1",
      "key-1",
      internals.generation,
    );
    expect(result?.outcome).toBe("committed");

    // Different generation lookup returns undefined
    const stale = await manager.lookupDelivery(
      "telegram-1",
      "key-1",
      internals.generation + 1,
    );
    expect(stale).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // lookupDelivery uses adapter.lookupDelivery
  // -----------------------------------------------------------------------

  it("calls adapter.lookupDelivery for lookup", async () => {
    const { manager, internals } = await buildConnectedManager();

    internals.lookupResult = {
      version: 1,
      generation: internals.generation,
      accepted: true,
      committed: true,
      outcome: "committed",
      idempotencyKey: "key-2",
      platformMessageId: "plat-2",
    };

    const result = await manager.lookupDelivery("telegram-1", "key-2");
    expect(result?.outcome).toBe("committed");
    expect(result?.platformMessageId).toBe("plat-2");
  });

  // -----------------------------------------------------------------------
  // lookupDelivery for non-connected channel
  // -----------------------------------------------------------------------

  it("returns undefined for lookupDelivery on non-connected channel", async () => {
    const { manager } = await buildConnectedManager();

    const result = await manager.lookupDelivery("nonexistent", "key-1");
    expect(result).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // lookupDelivery returns undefined when adapter superseded
  // -----------------------------------------------------------------------

  it("returns undefined when adapter is superseded during lookupDelivery", async () => {
    const { manager, internals } = await buildConnectedManager();
    const originalGeneration = internals.generation;

    internals.lookupResult = {
      version: 1,
      generation: originalGeneration,
      accepted: true,
      committed: true,
      outcome: "committed",
      idempotencyKey: "key-1",
    };

    // Add a delay to lookupDelivery so we can supersede during it
    internals.lookupDelayMs = 10;

    const lookupPromise = manager.lookupDelivery(
      "telegram-1",
      "key-1",
      originalGeneration,
    );

    // Reconnect during lookup
    await manager.connect({
      channelType: "telegram",
      channelInstanceId: "telegram-1",
      agentId: "agent-1",
      settings: {},
    });

    const result = await lookupPromise;
    expect(result).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // lookupDelivery without generation param uses current connection
  // -----------------------------------------------------------------------

  it("lookupDelivery without generation uses current connection", async () => {
    const { manager, internals } = await buildConnectedManager();

    internals.lookupResult = {
      version: 1,
      generation: internals.generation,
      accepted: true,
      committed: true,
      outcome: "committed",
      idempotencyKey: "key-3",
    };

    // No generation specified
    const result = await manager.lookupDelivery("telegram-1", "key-3");
    expect(result?.outcome).toBe("committed");
  });

  // -----------------------------------------------------------------------
  // lookupDelivery handles thrown adapter gracefully
  // -----------------------------------------------------------------------

  it("returns undefined when adapter lookup is unsupported", async () => {
    // Create a manager with an adapter that doesn't have lookupDelivery.
    const registry2 = new ChannelRegistry();
    registry2.register("telegram", (config, generation) => {
      const base = createFakeAdapter(config, generation);
      // Remove lookupDelivery from the prototype-like shape
      const noLookup = { ...base };
      delete (noLookup as Record<string, unknown>).lookupDelivery;
      return noLookup as ChannelAdapter;
    });

    const manager2 = new ConnectionManager(registry2);
    await manager2.connect({
      channelType: "telegram",
      channelInstanceId: "telegram-2",
      agentId: "agent-2",
      settings: {},
    });

    // Should return undefined when adapter has no lookupDelivery
    const result = await manager2.lookupDelivery("telegram-2", "key-1");
    expect(result).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // generation guard prevents new connection from using stale message
  // -----------------------------------------------------------------------

  it("new connection generation is higher than previous", async () => {
    const registry = new ChannelRegistry();
    registry.register("telegram", fakeAdapterFactory());

    const manager = new ConnectionManager(registry);

    const status1 = await manager.connect({
      channelType: "telegram",
      channelInstanceId: "telegram-1",
      agentId: "agent-1",
      settings: {},
    });
    const gen1 = status1.generation;

    await manager.connect({
      channelType: "telegram",
      channelInstanceId: "telegram-1",
      agentId: "agent-1",
      settings: {},
    });
    const status2 = manager.getStatus("telegram-1")!;
    const gen2 = status2.generation;

    expect(gen2).toBeGreaterThan(gen1);

    // Message with gen1 should be rejected
    const staleMsg = makeOutboundMessage(gen1, "stale-key");
    const result = await manager.send("telegram-1", staleMsg);
    expect(result.outcome).toBe("permanent_failure");
    expect(result.errorCode).toBe("CHANNEL_GENERATION_MISMATCH");
  });
});
