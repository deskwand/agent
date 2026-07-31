import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { QqChannel, PASSIVE_REPLY_WINDOW_MS } from "../qq-channel";
import type { QqGatewayLike, QqEvent } from "../qq-gateway";
import { QqGateway } from "../qq-gateway";
import type { ChannelTarget } from "../../../runtime/contracts";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function makeConfig(opts?: { channelInstanceId?: string; settings?: Record<string, unknown> }) {
  return {
    channelType: "qq" as const,
    channelInstanceId: opts?.channelInstanceId ?? "qq-test-1",
    agentId: "agent-1",
    settings: { appId: "app", clientSecret: "secret", ...(opts?.settings) },
  };
}

function mockTarget(overrides: Partial<ChannelTarget> = {}): ChannelTarget {
  return {
    version: 1,
    channelType: "qq",
    channelInstanceId: "qq-test-1",
    chatId: "chat-1",
    visibility: "chat",
    ...overrides,
  } as ChannelTarget;
}

function makeQqEvent(overrides: Partial<QqEvent> = {}): QqEvent {
  const base: QqEvent = {
    id: "event-1",
    chat_type: "group",
    group_id: "group-1",
    author: { id: "user-1", username: "User" },
    content: "hello",
  };
  return { ...base, ...overrides };
}

interface FakeGateway extends QqGatewayLike {
  _emitEvent(e: QqEvent): void;
  _emitError(e: Error): void;
  _inflightSignal?: AbortSignal;
}

function makeFakeGateway(overrides: Partial<QqGatewayLike> = {}): FakeGateway {
  const eventHandlers = new Set<(e: QqEvent) => void>();
  const errorHandlers = new Set<(e: Error) => void>();
  let connected = false;

  const gw: FakeGateway = {
    get connected() { return connected; },
    connect: vi.fn(async (signal: AbortSignal) => {
      (overrides.connect ?? vi.fn(async () => {}))(signal);
      gw._inflightSignal = signal;
      connected = true;
    }),
    disconnect: vi.fn(async () => {
      (overrides.disconnect ?? vi.fn(async () => {}))();
      connected = false;
    }),
    sendMessage: overrides.sendMessage ?? vi.fn(async () => ({ id: "msg-1" })),
    onEvent: (h: (e: QqEvent) => void) => {
      eventHandlers.add(h);
      return () => eventHandlers.delete(h);
    },
    onGatewayError: (h: (e: Error) => void) => {
      errorHandlers.add(h);
      return () => errorHandlers.delete(h);
    },
    _emitEvent: (e: QqEvent) => { for (const h of eventHandlers) h(e); },
    _emitError: (e: Error) => { for (const h of errorHandlers) h(e); },
    _inflightSignal: undefined,
  };
  return gw;
}

// ===========================================================================
// 1. Legacy QqApiLike contract tests
// ===========================================================================

describe("qq channel — QqApiLike contract (legacy)", () => {
  const api = { sendMessage: vi.fn(async () => ({ id: "qq-message-1" })) };

  it("routes group events with a per-message sequence", () => {
    const channel = new QqChannel(makeConfig(), 1, api);
    const handler = vi.fn();
    channel.onMessage(handler);
    channel.handleEvent(makeQqEvent({ id: "event-1", chat_type: "group", group_id: "group-1" }));
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ chatKind: "group", chatId: "group-1" }),
    );
    expect(channel.nextMessageSequence("event-1")).toBe(1);
  });

  it("reports passive reply expiry", () => {
    const channel = new QqChannel(makeConfig(), 1, api);
    channel.recordInbound("event-1", 1000);
    expect(channel.canReplyPassively("event-1", 1000 + PASSIVE_REPLY_WINDOW_MS + 1)).toBe(false);
  });

  it("allows passive reply within window", () => {
    const channel = new QqChannel(makeConfig(), 1, api);
    channel.recordInbound("event-1", 1000);
    expect(channel.canReplyPassively("event-1", 1000 + PASSIVE_REPLY_WINDOW_MS - 1)).toBe(true);
  });

  it("skips bot-authored events", () => {
    const channel = new QqChannel(makeConfig(), 1, api);
    const handler = vi.fn();
    channel.onMessage(handler);
    channel.handleEvent(makeQqEvent({ author: { id: "bot-1", bot: true } }));
    expect(handler).not.toHaveBeenCalled();
  });

  it("routes c2c events as dm chatKind", () => {
    const channel = new QqChannel(makeConfig(), 1, api);
    const handler = vi.fn();
    channel.onMessage(handler);
    channel.handleEvent(makeQqEvent({ id: "c2c-1", chat_type: "c2c", group_id: undefined, author: { id: "u1" } }));
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ chatKind: "dm", chatId: "u1" }),
    );
  });

  it("routes guild events as channel chatKind", () => {
    const channel = new QqChannel(makeConfig(), 1, api);
    const handler = vi.fn();
    channel.onMessage(handler);
    channel.handleEvent(makeQqEvent({ id: "guild-1", chat_type: "guild", group_id: undefined, channel_id: "ch-1", author: { id: "u1" } }));
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ chatKind: "channel", chatId: "ch-1" }),
    );
  });

  it("idempotent send returns same delivery for duplicate key", async () => {
    const channel = new QqChannel(makeConfig(), 1, api);
    const msg = { version: 1 as const, generation: 1, idempotencyKey: "ik-1", target: mockTarget(), text: "hello", kind: "reply" as const };
    const first = await channel.send(msg);
    const second = await channel.send(msg);
    expect(second).toEqual(first);
    expect(api.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("send on empty text returns permanent failure", async () => {
    const channel = new QqChannel(makeConfig(), 1, api);
    const result = await channel.send({
      version: 1, generation: 1, idempotencyKey: "ik-empty", target: mockTarget(), text: "", kind: "reply",
    });
    expect(result.accepted).toBe(false);
    expect(result.outcome).toBe("permanent_failure");
    expect(result.errorCode).toBe("QQ_EMPTY_MESSAGE");
  });

  it("nextMessageSequence increments independently per event", () => {
    const channel = new QqChannel(makeConfig(), 1, api);
    channel.recordInbound("a", 1000);
    channel.recordInbound("b", 2000);
    expect(channel.nextMessageSequence("a")).toBe(1);
    expect(channel.nextMessageSequence("a")).toBe(2);
    expect(channel.nextMessageSequence("b")).toBe(1);
    expect(channel.nextMessageSequence("b")).toBe(2);
  });

  it("routes private target to userId, not chatId", async () => {
    const api = { sendMessage: vi.fn(async () => ({ id: "qq-private-1" })) };
    const channel = new QqChannel(makeConfig(), 1, api);
    const result = await channel.send({
      version: 1,
      generation: 1,
      idempotencyKey: "ik-private",
      target: {
        version: 1,
        channelType: "qq",
        channelInstanceId: "qq-test-1",
        chatId: "group-chat-1",
        visibility: "private",
        userId: "user-private-1",
      },
      text: "private hello",
      kind: "notification",
    });
    expect(result.accepted).toBe(true);
    expect(api.sendMessage).toHaveBeenCalledWith("user-private-1", "private hello");
  });

  it("sends chat target to chatId as before", async () => {
    const api = { sendMessage: vi.fn(async () => ({ id: "qq-chat-1" })) };
    const channel = new QqChannel(makeConfig(), 1, api);
    await channel.send({
      version: 1,
      generation: 1,
      idempotencyKey: "ik-chat",
      target: mockTarget(),
      text: "group hello",
      kind: "reply",
    });
    expect(api.sendMessage).toHaveBeenCalledWith("chat-1", "group hello");
  });

  it("initial nextMessageSequence returns 1 for unknown event", () => {
    const channel = new QqChannel(makeConfig(), 1, api);
    expect(channel.nextMessageSequence("unknown")).toBe(1);
  });

  it("canReplyPassively returns false for unknown event", () => {
    const channel = new QqChannel(makeConfig(), 1, api);
    expect(channel.canReplyPassively("unknown", Date.now())).toBe(false);
  });

  it("streamUpdate delegates to send with fullText", async () => {
    const channel = new QqChannel(makeConfig(), 1, api);
    const result = await channel.streamUpdate(mockTarget(), {
      version: 1, generation: 1, streamId: "s1", sequence: 3, target: mockTarget(), fullText: "streaming", idempotencyKey: "ik-stream", isFinal: false,
    });
    expect(result.accepted).toBe(true);
    expect(api.sendMessage).toHaveBeenCalledWith("chat-1", "streaming");
  });

  it("emits status on connect/disconnect", async () => {
    const channel = new QqChannel(makeConfig(), 1, api);
    const statuses: string[] = [];
    channel.onStatus((s) => statuses.push(s.state));
    await channel.connect();
    expect(statuses).toContain("connected");
    await channel.disconnect();
    expect(statuses).toContain("stopped");
  });
});

// ===========================================================================
// 2. Gateway lifecycle tests
// ===========================================================================

describe("qq channel — gateway lifecycle", () => {
  it("connect delegates to gateway.connect with signal", async () => {
    const gateway = makeFakeGateway();
    const channel = new QqChannel(makeConfig(), 1, gateway);
    const controller = new AbortController();
    await channel.connect(controller.signal);
    expect(gateway.connect).toHaveBeenCalledWith(controller.signal);
    expect(channel.connected).toBe(true);
  });

  it("disconnect delegates to gateway.disconnect and sets stopped", async () => {
    const gateway = makeFakeGateway();
    const channel = new QqChannel(makeConfig(), 1, gateway);
    await channel.connect();
    await channel.disconnect();
    expect(gateway.disconnect).toHaveBeenCalledOnce();
    expect(channel.connected).toBe(false);
  });

  it("forwards gateway events to onMessage handler", async () => {
    const gateway = makeFakeGateway();
    const channel = new QqChannel(makeConfig(), 1, gateway);
    await channel.connect();
    const handler = vi.fn();
    channel.onMessage(handler);
    gateway._emitEvent(makeQqEvent({
      id: "gw-event-1", chat_type: "group", group_id: "group-1",
      author: { id: "user-2", username: "Al" }, content: "hey",
    }));
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: "group-1", chatKind: "group", userId: "user-2", text: "hey" }),
    );
  });

  it("forwards gateway errors to onError handler", async () => {
    const gateway = makeFakeGateway();
    const channel = new QqChannel(makeConfig(), 1, gateway);
    const errors: Error[] = [];
    channel.onError((e) => errors.push(e));
    await channel.connect();
    gateway._emitError(new Error("BOOM"));
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe("BOOM");
  });

  it("unsubscribes from gateway events on disconnect", async () => {
    const gateway = makeFakeGateway();
    const channel = new QqChannel(makeConfig(), 1, gateway);
    const handler = vi.fn();
    channel.onMessage(handler);
    await channel.connect();
    await channel.disconnect();
    gateway._emitEvent(makeQqEvent());
    expect(handler).not.toHaveBeenCalled();
  });

  it("emits status lifecycle in correct order", async () => {
    const gateway = makeFakeGateway();
    const channel = new QqChannel(makeConfig(), 1, gateway);
    const states: string[] = [];
    channel.onStatus((s) => states.push(s.state));
    await channel.connect();
    await channel.disconnect();
    expect(states).toEqual(["connected", "stopped"]);
  });
});

// ===========================================================================
// 3. Sequence / passive reply expiry
// ===========================================================================

describe("qq channel — sequence / passive reply", () => {
  it("passive reply window expires at exactly PASSIVE_REPLY_WINDOW_MS boundary", () => {
    const api = { sendMessage: vi.fn(async () => ({ id: "x" })) };
    const channel = new QqChannel(makeConfig(), 1, api);
    const base = 1000;
    channel.recordInbound("ev", base);
    expect(channel.canReplyPassively("ev", base + PASSIVE_REPLY_WINDOW_MS - 1)).toBe(true);
    expect(channel.canReplyPassively("ev", base + PASSIVE_REPLY_WINDOW_MS)).toBe(false);
  });

  it("nextMessageSequence is monotonic per eventId", () => {
    const api = { sendMessage: vi.fn(async () => ({ id: "x" })) };
    const channel = new QqChannel(makeConfig(), 1, api);
    channel.recordInbound("ev", 0);
    const values: number[] = [];
    for (let i = 0; i < 10; i++) values.push(channel.nextMessageSequence("ev"));
    expect(values).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

// ===========================================================================
// 4. Inbound normalization
// ===========================================================================

describe("qq channel — inbound normalization", () => {
  it("normalizes a group message with all fields populated", () => {
    const api = { sendMessage: vi.fn(async () => ({ id: "x" })) };
    const channel = new QqChannel(makeConfig({ channelInstanceId: "qq-xyz" }), 3, api);
    const handler = vi.fn();
    channel.onMessage(handler);
    channel.handleEvent(makeQqEvent({
      id: "ev-42", chat_type: "group", group_id: "g-987",
      author: { id: "u-456", username: "Cat", bot: false },
      content: "  hello world  ",
    }));
    const msg = handler.mock.calls[0]?.[0];
    expect(msg.id).toContain("qq-xyz");
    expect(msg.id).toContain("ev-42");
    expect(msg.generation).toBe(3);
    expect(msg.channelType).toBe("qq");
    expect(msg.chatKind).toBe("group");
    expect(msg.chatId).toBe("g-987");
    expect(msg.userId).toBe("u-456");
    expect(msg.userName).toBe("Cat");
    expect(msg.isBot).toBe(false);
    expect(msg.text).toBe("hello world");
  });

  it("c2c falls back to author.id as chatId", () => {
    const api = { sendMessage: vi.fn(async () => ({ id: "x" })) };
    const channel = new QqChannel(makeConfig(), 1, api);
    const handler = vi.fn();
    channel.onMessage(handler);
    channel.handleEvent(makeQqEvent({
      id: "c2c-1", chat_type: "c2c", group_id: undefined, channel_id: undefined,
      author: { id: "u-c2c", username: "Dog" },
    }));
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ chatKind: "dm", chatId: "u-c2c" }),
    );
  });

  it("guild message uses channel_id", () => {
    const api = { sendMessage: vi.fn(async () => ({ id: "x" })) };
    const channel = new QqChannel(makeConfig(), 1, api);
    const handler = vi.fn();
    channel.onMessage(handler);
    channel.handleEvent(makeQqEvent({
      id: "guild-1", chat_type: "guild", group_id: undefined, channel_id: "ch-99",
      author: { id: "u-mem" },
    }));
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ chatKind: "channel", chatId: "ch-99" }),
    );
  });
});

// ===========================================================================
// 5. Idempotent send (gateway path)
// ===========================================================================

describe("qq channel — idempotent send (gateway path)", () => {
  it("returns cached delivery on duplicate idempotencyKey", async () => {
    const gateway = makeFakeGateway({ sendMessage: vi.fn(async () => ({ id: "gw-msg-1" })) });
    const channel = new QqChannel(makeConfig(), 2, gateway);
    await channel.connect();
    const msg = { version: 1 as const, generation: 2, idempotencyKey: "dup-1", target: mockTarget(), text: "hi", kind: "reply" as const };
    const r1 = await channel.send(msg);
    const r2 = await channel.send(msg);
    expect(r1).toEqual(r2);
    expect(gateway.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("sendMessage throws => error propagates", async () => {
    const gateway = makeFakeGateway({ sendMessage: vi.fn(async () => { throw new Error("BOOM"); }) });
    const channel = new QqChannel(makeConfig(), 1, gateway);
    await expect(channel.send({
      version: 1, generation: 1, idempotencyKey: "ik-fail", target: mockTarget(), text: "hi", kind: "reply",
    })).rejects.toThrow("BOOM");
  });
});

// ===========================================================================
// 6. QqGateway concrete unit tests
// ===========================================================================

describe("QqGateway — concrete implementation", () => {
  let gateway: QqGateway;

  beforeEach(() => {
    gateway = new QqGateway({
      appId: "test-app", clientSecret: "test-secret",
      baseUrl: "https://api.sgroup.qq.com", gatewayUrl: "ws://localhost:9999/ws",
    });
  });

  afterEach(async () => { try { await gateway.disconnect(); } catch { /* ok */ } });

  it("has expected initial state", () => {
    expect(gateway.connected).toBe(false);
    expect(gateway.baseUrl).toBe("https://api.sgroup.qq.com");
    expect(gateway.gatewayUrl).toBe("ws://localhost:9999/ws");
  });

  it("onEvent returns unsubscribe function", () => {
    const unsub = gateway.onEvent(vi.fn());
    expect(typeof unsub).toBe("function");
    unsub();
  });

  it("onGatewayError returns unsubscribe function", () => {
    const unsub = gateway.onGatewayError(vi.fn());
    expect(typeof unsub).toBe("function");
    unsub();
  });

  it("disconnect while not connected is safe", async () => {
    await gateway.disconnect();
    expect(gateway.connected).toBe(false);
  });
});

// ===========================================================================
// 7. Export checks
// ===========================================================================

describe("module exports", () => {
  it("exports PASSIVE_REPLY_WINDOW_MS as 3 minutes", () => {
    expect(PASSIVE_REPLY_WINDOW_MS).toBe(3 * 60 * 1000);
  });

  it("QqGatewayLike type-check", () => {
    const gw: QqGatewayLike = new QqGateway({ appId: "a", baseUrl: "https://test.qq.com" });
    expect(gw).toBeDefined();
  });
});
