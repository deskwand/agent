/**
 * End-to-end tests for RemoteRuntimeBootstrap with real
 * ChannelRuntimePersistence, ConnectionManager, and fake adapter.
 *
 * Proves:
 *  - Outbox-before-send (DB inspected inside fake send)
 *  - Atomic completion (receipt + delivery committed together)
 *  - Concurrent duplicate response deduplication
 *  - Duplicate inbound deduplication
 *  - Persisted actual session continuation after new lifecycle
 */

import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RemoteRuntimeBootstrap } from "../../main/remote/runtime/remote-runtime-bootstrap";
import {
  ChannelRegistry,
} from "../../main/remote/runtime/channel-registry";
import { ConnectionManager } from "../../main/remote/runtime/connection-manager";
import {
  ChannelRuntimePersistence,
} from "../../main/remote/runtime/persistence";
import type {
  ChannelAdapter,
  ChannelAdapterConfig,
  ChannelAdapterFactory,
} from "../../main/remote/runtime/channel-adapter";
import type {
  UnifiedMessage,
  OutboundMessage,
  DeliveryResult,
  ChannelStatusEvent,
} from "../../main/remote/runtime/contracts";
import type { AgentExecutor } from "../../main/remote/remote-manager";
import { routeRuntimeAssistantEvent } from "../../main/remote/runtime/runtime-session-event-router";
import type { ServerEvent } from "../../renderer/types";

// ---------------------------------------------------------------------------
// Fake adapter
// ---------------------------------------------------------------------------

type AdapterSendFn = (msg: OutboundMessage) => Promise<DeliveryResult>;

class FakeAdapter implements ChannelAdapter {
  readonly channelType = "telegram" as const;
  readonly channelInstanceId: string;
  readonly generation: number;
  private _connected = false;
  get connected(): boolean { return this._connected; }
  sendFn: AdapterSendFn = async (om) => ({
    version: 1 as const,
    generation: this.generation,
    accepted: true,
    committed: true,
    outcome: "committed" as const,
    idempotencyKey: om.idempotencyKey,
  });
  private messageHandler?: (msg: UnifiedMessage) => void;
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

  async disconnect(): Promise<void> { this._connected = false; }

  async send(message: OutboundMessage): Promise<DeliveryResult> {
    return this.sendFn(message);
  }

  injectMessage(msg: UnifiedMessage): void { this.messageHandler?.(msg); }

  onMessage(h: (msg: UnifiedMessage) => void): () => void {
    this.messageHandler = h;
    return () => { this.messageHandler = undefined; };
  }
  onCommand(): () => void { return () => undefined; }
  onInteraction(): () => void { return () => undefined; }
  onStatus(h: (s: ChannelStatusEvent) => void): () => void {
    this.statusHandler = h;
    return () => { this.statusHandler = undefined; };
  }
  onError(): () => void { return () => undefined; }
}

function fakeAdapterFactory(): ChannelAdapterFactory {
  return (config, generation) => new FakeAdapter(config, generation);
}

// ---------------------------------------------------------------------------
// Fake AgentExecutor
// ---------------------------------------------------------------------------

function fakeAgentExecutor(opts?: {
  startId?: string;
}): AgentExecutor {
  return {
    startSession: vi.fn(async () => ({
      id: opts?.startId ?? "real-session-1",
      title: "test",
      createdAt: 1,
      updatedAt: 1,
    }) as unknown as ReturnType<AgentExecutor["startSession"]> extends Promise<infer T> ? T : never),
    continueSession: vi.fn(async () => undefined),
    stopSession: vi.fn(async () => undefined),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function msg(overrides: Partial<UnifiedMessage> = {}): UnifiedMessage {
  return {
    version: 1,
    generation: 1,
    id: "msg-1",
    channelType: "telegram",
    channelInstanceId: "telegram-1",
    chatId: "chat-1",
    userId: "user-1",
    chatKind: "dm",
    text: "hello",
    attachments: [],
    mentions: [],
    timestamp: 1,
    ...overrides,
  };
}

function receiptKey(message: UnifiedMessage): string {
  return JSON.stringify([message.channelInstanceId, message.chatId, message.id]);
}

function routeAssistant(
  bootstrap: RemoteRuntimeBootstrap,
  sessionId: string,
  turnId: string,
  text: string,
): boolean {
  return routeAssistantId(bootstrap, sessionId, turnId, text, "assistant-message");
}

function routeAssistantId(
  bootstrap: RemoteRuntimeBootstrap,
  sessionId: string,
  turnId: string,
  text: string,
  messageId: string,
): boolean {
  const event: ServerEvent = {
    type: "stream.message",
    payload: {
      sessionId,
      message: {
        id: messageId,
        sessionId,
        role: "assistant",
        content: [{ type: "text", text }],
        timestamp: Date.now(),
        turnId,
      },
    },
  };
  return routeRuntimeAssistantEvent(event, bootstrap, () => undefined);
}

function finalKey(message: UnifiedMessage): string {
  return JSON.stringify([
    "remote-runtime",
    message.channelInstanceId,
    message.chatId,
    message.id,
    "reply",
  ]);
}

// A turn may emit several assistant messages; each is delivered under its own
// outbound key derived by appending the assistant message id to the turn key.
// routeAssistant uses message.id === "assistant-message".
function segmentKey(message: UnifiedMessage): string {
  return `${finalKey(message)}:assistant-message`;
}

// ---------------------------------------------------------------------------
// Mock remote config store
// ---------------------------------------------------------------------------

vi.mock("../../main/remote/remote-config-store", () => ({
  remoteConfigStore: {
    getAll: () => ({ gateway: {} }),
    listChannelInstances: () => [
      {
        id: "telegram-1",
        type: "telegram",
        enabled: true,
        config: { botToken: "test-token" },
      },
    ],
  },
}));

vi.mock("../../main/utils/logger", () => ({
  log: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Typed accessor for bootstrap internals (avoids intersection type collapse)
// ---------------------------------------------------------------------------

function bs(bootstrap: RemoteRuntimeBootstrap): {
  channelRuntime: { start(): Promise<void>; stop(): Promise<void>; handleMessage(m: UnifiedMessage): Promise<unknown> } | null;
  connectionManager: ConnectionManager | null;
  stop(): Promise<void>;
  initialize(opts: Parameters<RemoteRuntimeBootstrap["initialize"]>[0]): ReturnType<RemoteRuntimeBootstrap["initialize"]>;
} {
  return bootstrap as unknown as ReturnType<typeof bs>;
}

// ---------------------------------------------------------------------------
// Build stack
// ---------------------------------------------------------------------------

interface E2EStack {
  database: DatabaseSync;
  persistence: ChannelRuntimePersistence;
  connectionManager: ConnectionManager;
  bootstrap: RemoteRuntimeBootstrap;
  agentExecutor: AgentExecutor & {
    startSession: ReturnType<typeof vi.fn>;
    continueSession: ReturnType<typeof vi.fn>;
  };
}

async function buildStack(): Promise<E2EStack> {
  const database = new DatabaseSync(":memory:");
  const persistence = new ChannelRuntimePersistence(database, Buffer.alloc(32, 7));
  const registry = new ChannelRegistry();
  registry.register("telegram", fakeAdapterFactory());

  const agentExecutor = fakeAgentExecutor() as AgentExecutor & {
    startSession: ReturnType<typeof vi.fn>;
    continueSession: ReturnType<typeof vi.fn>;
  };

  const bootstrap = new RemoteRuntimeBootstrap();

  await bootstrap.initialize({
    agentExecutor,
    persistence,
  });

  const b = bs(bootstrap);

  const cm = new ConnectionManager(registry, {
    onMessage: async (m) => {
      if (b.channelRuntime) {
        await b.channelRuntime.handleMessage(m);
      }
    },
    onStatus: () => { /* noop */ },
  });

  // set connectionManager ref
  (bootstrap as unknown as Record<string, unknown>).connectionManager = cm;

  await b.channelRuntime?.start();

  return { database, persistence, connectionManager: cm, bootstrap, agentExecutor };
}

function getActiveAdapter(cm: ConnectionManager): FakeAdapter {
  const a = (cm as unknown as {
    active: Map<string, { adapter: FakeAdapter }>;
  }).active.get("telegram-1")?.adapter;
  if (!a) throw new Error("adapter not found");
  return a;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ChannelRuntime E2E", () => {
  const stacks: E2EStack[] = [];

  afterEach(async () => {
    for (const s of stacks) {
      try { await s.bootstrap.stop(); } catch { /* ignore */ }
      try { s.database.close(); } catch { /* ignore */ }
    }
    stacks.length = 0;
  });

  // -----------------------------------------------------------------------
  // Outbox-before-send
  // -----------------------------------------------------------------------

  it("creates encrypted pending outbox before adapter.send", async () => {
    const stack = await buildStack();
    stacks.push(stack);
    const adapter = getActiveAdapter(stack.connectionManager);

    const m = msg();
    const fk = segmentKey(m);
    const inspector = vi.fn();

    adapter.sendFn = async (om) => {
      const pending = stack.persistence.getOutboundDelivery(fk);
      inspector(pending?.state);
      return {
        version: 1 as const,
        generation: 1,
        accepted: true,
        committed: true,
        outcome: "committed" as const,
        idempotencyKey: om.idempotencyKey,
      };
    };

    adapter.injectMessage(m);

    await vi.waitFor(() => {
      expect(stack.agentExecutor.startSession).toHaveBeenCalled();
    }, { timeout: 2000 });

    expect(
      routeAssistant(
        stack.bootstrap,
        "real-session-1",
        finalKey(m),
        "hello back",
      ),
    ).toBe(true);

    await vi.waitFor(() => expect(inspector).toHaveBeenCalledWith("pending"));
  });

  // -----------------------------------------------------------------------
  // Atomic completion
  // -----------------------------------------------------------------------

  it("atomically commits receipt after delivery committed", async () => {
    const stack = await buildStack();
    stacks.push(stack);
    const adapter = getActiveAdapter(stack.connectionManager);

    adapter.sendFn = async (om) => ({
      version: 1 as const,
      generation: 1,
      accepted: true,
      committed: true,
      outcome: "committed" as const,
      idempotencyKey: om.idempotencyKey,
      platformMessageId: "plat-1",
    });

    const m = msg();
    adapter.injectMessage(m);

    await vi.waitFor(() => {
      expect(stack.agentExecutor.startSession).toHaveBeenCalled();
    }, { timeout: 2000 });

    const fk = segmentKey(m);
    expect(
      routeAssistant(stack.bootstrap, "real-session-1", finalKey(m), "hello back"),
    ).toBe(true);

    const rk = receiptKey(m);
    await vi.waitFor(() => {
      expect(stack.persistence.getInboundReceipt(rk)?.state).toBe("completed");
    });
    expect(stack.persistence.getOutboundDelivery(fk)?.state).toBe("committed");
    expect(stack.persistence.getOutboundDelivery(fk)?.platformMessageId).toBe("plat-1");
  });

  // -----------------------------------------------------------------------
  // Concurrent duplicate response deduplication
  // -----------------------------------------------------------------------

  it("deduplicates concurrent duplicate assistant responses via in-flight map", async () => {
    const stack = await buildStack();
    stacks.push(stack);
    const adapter = getActiveAdapter(stack.connectionManager);

    let sendCount = 0;
    adapter.sendFn = async (om) => {
      sendCount++;
      return {
        version: 1 as const,
        generation: 1,
        accepted: true,
        committed: true,
        outcome: "committed" as const,
        idempotencyKey: om.idempotencyKey,
      };
    };

    const m = msg();
    adapter.injectMessage(m);

    await vi.waitFor(() => {
      expect(stack.agentExecutor.startSession).toHaveBeenCalled();
    }, { timeout: 2000 });

    const fk = finalKey(m);
    expect(
      routeAssistant(stack.bootstrap, "real-session-1", fk, "hello"),
    ).toBe(true);
    expect(
      routeAssistant(stack.bootstrap, "real-session-1", fk, "hello"),
    ).toBe(true);

    await vi.waitFor(() => expect(sendCount).toBe(1));
  });

  it("marks the outbox unknown when the bounded retry throws", async () => {
    const stack = await buildStack();
    stacks.push(stack);
    const adapter = getActiveAdapter(stack.connectionManager);
    let calls = 0;
    adapter.sendFn = async (outbound) => {
      calls += 1;
      if (calls === 1) {
        return {
          version: 1,
          generation: 1,
          accepted: false,
          committed: false,
          outcome: "retryable_failure",
          idempotencyKey: outbound.idempotencyKey,
          retryable: true,
        };
      }
      throw new Error("ambiguous transport failure");
    };

    const inbound = msg();
    getActiveAdapter(stack.connectionManager).injectMessage(inbound);
    await vi.waitFor(() => {
      expect(stack.agentExecutor.startSession).toHaveBeenCalled();
    });

    const key = segmentKey(inbound);
    expect(
      routeAssistant(stack.bootstrap, "real-session-1", finalKey(inbound), "hello"),
    ).toBe(true);
    await vi.waitFor(() => {
      expect(stack.persistence.getOutboundDelivery(key)?.state).toBe(
        "unknown",
      );
    });
    expect(calls).toBe(2);
  });

  // -----------------------------------------------------------------------
  // Multi-round delivery: every assistant message of a turn is delivered
  // -----------------------------------------------------------------------

  it("delivers EVERY assistant message of a single turn (multi-step)", async () => {
    const stack = await buildStack();
    stacks.push(stack);
    const adapter = getActiveAdapter(stack.connectionManager);

    const sentKeys: string[] = [];
    adapter.sendFn = async (om) => {
      sentKeys.push(om.idempotencyKey);
      return {
        version: 1 as const,
        generation: 1,
        accepted: true,
        committed: true,
        outcome: "committed" as const,
        idempotencyKey: om.idempotencyKey,
      };
    };

    const m = msg();
    adapter.injectMessage(m);
    await vi.waitFor(() => {
      expect(stack.agentExecutor.startSession).toHaveBeenCalled();
    }, { timeout: 2000 });

    const turnKey = finalKey(m);
    // Two distinct assistant messages in the SAME turn (multi-step / tool use)
    expect(
      routeAssistantId(stack.bootstrap, "real-session-1", turnKey, "step-1", "msg-step-1"),
    ).toBe(true);
    expect(
      routeAssistantId(stack.bootstrap, "real-session-1", turnKey, "step-2", "msg-step-2"),
    ).toBe(true);

    await vi.waitFor(() => expect(sentKeys.length).toBe(2), { timeout: 2000 });
    expect(sentKeys).toContain(`${turnKey}:msg-step-1`);
    expect(sentKeys).toContain(`${turnKey}:msg-step-2`);
  });

  // -----------------------------------------------------------------------
  // Duplicate inbound deduplication
  // -----------------------------------------------------------------------

  it("does not invoke Agent for duplicate inbound after committed", async () => {
    const stack = await buildStack();
    stacks.push(stack);

    const m = msg();
    const b = bs(stack.bootstrap);
    await b.channelRuntime!.handleMessage(m);

    await vi.waitFor(() => {
      expect(stack.agentExecutor.startSession).toHaveBeenCalled();
    }, { timeout: 2000 });

    (stack.agentExecutor.startSession as ReturnType<typeof vi.fn>).mockClear();
    (stack.agentExecutor.continueSession as ReturnType<typeof vi.fn>).mockClear();

    // Duplicate inbound should not invoke Agent again
    await b.channelRuntime!.handleMessage(m);

    expect(stack.agentExecutor.startSession).not.toHaveBeenCalled();
    expect(stack.agentExecutor.continueSession).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Persisted session continuation after new lifecycle
  // -----------------------------------------------------------------------

  it("continues persisted Agent session after new Bootstrap lifecycle", async () => {
    const db1 = new DatabaseSync(":memory:");
    const persistence1 = new ChannelRuntimePersistence(db1, Buffer.alloc(32, 7));
    const registry1 = new ChannelRegistry();
    registry1.register("telegram", fakeAdapterFactory());

    const agentExecutor1 = fakeAgentExecutor({ startId: "real-session-1" }) as AgentExecutor & {
      startSession: ReturnType<typeof vi.fn>;
      continueSession: ReturnType<typeof vi.fn>;
    };

    const bootstrap1 = new RemoteRuntimeBootstrap();
    await bootstrap1.initialize({ agentExecutor: agentExecutor1, persistence: persistence1 });

    const b1 = bs(bootstrap1);

    const cm1 = new ConnectionManager(registry1, {
      onMessage: async (m) => {
        if (b1.channelRuntime) await b1.channelRuntime.handleMessage(m);
      },
      onStatus: () => { /* noop */ },
    });
    (bootstrap1 as unknown as Record<string, unknown>).connectionManager = cm1;

    await b1.channelRuntime?.start();

    const m1 = msg();
    await b1.channelRuntime!.handleMessage(m1);
    await vi.waitFor(() => {
      expect(agentExecutor1.startSession).toHaveBeenCalled();
    }, { timeout: 2000 });

    const bindingKey = JSON.stringify(["remote-runtime", "telegram-1", "chat-1", "user-1"]);
    expect(persistence1.getSessionBinding(bindingKey)?.sessionId).toBe("real-session-1");

    await bootstrap1.stop();

    // --- Lifecycle 2 ---
    const agentExecutor2 = fakeAgentExecutor({ startId: "unexpected-new-session" }) as AgentExecutor & {
      startSession: ReturnType<typeof vi.fn>;
      continueSession: ReturnType<typeof vi.fn>;
    };

    const bootstrap2 = new RemoteRuntimeBootstrap();
    await bootstrap2.initialize({ agentExecutor: agentExecutor2, persistence: persistence1 });

    const b2 = bs(bootstrap2);

    const cm2 = new ConnectionManager(registry1, {
      onMessage: async (m) => {
        if (b2.channelRuntime) await b2.channelRuntime.handleMessage(m);
      },
      onStatus: () => { /* noop */ },
    });
    (bootstrap2 as unknown as Record<string, unknown>).connectionManager = cm2;

    await b2.channelRuntime?.start();

    const m2 = msg({ id: "msg-2" });
    await b2.channelRuntime!.handleMessage(m2);

    await vi.waitFor(() => {
      expect(agentExecutor2.continueSession).toHaveBeenCalled();
    }, { timeout: 2000 });

    expect(agentExecutor2.startSession).not.toHaveBeenCalled();
    expect(agentExecutor2.continueSession).toHaveBeenCalledWith(
      "real-session-1",
      m2.text,
      undefined,
      undefined,
      finalKey(m2),
    );

    await bootstrap2.stop();
    db1.close();
  });
});
