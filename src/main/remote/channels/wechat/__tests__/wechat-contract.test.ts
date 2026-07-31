import { describe, expect, it, vi } from "vitest";
import {
  WeChatChannel,
  type WeChatPuppetLike,
  type WeChatTokenStore,
} from "../wechat-channel";
import {
  createWeChatProtocol,
  type WeChatProtocol,
} from "../wechat-protocol";
import type { WeChatPuppetPairingEvent } from "../wechat-ilink-puppet";
import type { ChannelPairingEvent } from "../../../runtime/contracts";

// Flush microtask queue helper.
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => resolve());
}

function fakePuppet(): WeChatPuppetLike {
  return {
    onPairing: vi.fn(() => () => undefined),
    onCredentialInvalidated: vi.fn(() => () => undefined),
    onLogin: vi.fn(),
    onLogout: vi.fn(),
    onMessage: vi.fn(),
    onError: vi.fn(),
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    logout: vi.fn(async () => undefined),
    isLoggedIn: false,
    sendText: vi.fn(async () => ({ id: "wx-msg-1" })),
    sendImage: vi.fn(async () => ({ id: "wx-img-1" })),
    sendFile: vi.fn(async () => ({ id: "wx-file-1" })),
    sendTyping: vi.fn(async () => undefined),
    contactAlias: vi.fn(async (id: string) => id),
    roomTopic: vi.fn(async (id: string) => id),
  };
}

function fakeTokenStore(): WeChatTokenStore {
  return {
    load: vi.fn(async () => null),
    save: vi.fn(async () => undefined),
    clear: vi.fn(async () => undefined),
  };
}

function fakeProtocol(): WeChatProtocol {
  return createWeChatProtocol({ maxRetries: 2, baseDelayMs: 10 });
}

// ---------------------------------------------------------------------------
// QR login state machine
// ---------------------------------------------------------------------------
describe("wechat QR login state machine", () => {
  it("transitions idle -> pending -> scanned -> confirmed", () => {
    const proto = fakeProtocol();
    expect(proto.getQrState()).toBe("idle");

    proto.transition("pending");
    expect(proto.getQrState()).toBe("pending");

    proto.transition("scanned");
    expect(proto.getQrState()).toBe("scanned");

    proto.transition("confirmed");
    expect(proto.getQrState()).toBe("confirmed");
  });

  it("transitions scanned -> expired", () => {
    const proto = fakeProtocol();
    proto.transition("pending");
    proto.transition("scanned");
    proto.transition("expired");
    expect(proto.getQrState()).toBe("expired");
  });

  it("rejects invalid transitions", () => {
    const proto = fakeProtocol();
    expect(() => proto.transition("scanned")).toThrow("INVALID_QR_TRANSITION");
    proto.transition("pending");
    expect(() => proto.transition("idle")).toThrow("INVALID_QR_TRANSITION");
  });

  it("emits qrStateChange events per transition", () => {
    const proto = fakeProtocol();
    const handler = vi.fn();
    proto.onQrStateChange(handler);
    proto.transition("pending");
    expect(handler).toHaveBeenCalledWith("pending");
  });
});

// ---------------------------------------------------------------------------
// Token persistence through injected store
// ---------------------------------------------------------------------------
describe("wechat token persistence", () => {
  it("loads token from store on connect", async () => {
    const store = fakeTokenStore();
    const token = "saved-token-123";
    vi.mocked(store.load).mockResolvedValueOnce(token);

    const puppet = fakePuppet();
    const channel = new WeChatChannel(
      {
        channelType: "wechat",
        channelInstanceId: "wechat-1",
        agentId: "agent-1",
        settings: {},
      },
      1,
      puppet,
      store,
      fakeProtocol(),
    );

    await channel.connect(new AbortController().signal);

    expect(store.load).toHaveBeenCalledWith("wechat-1");
    expect(puppet.start).toHaveBeenCalledWith(token);
  });

  it("saves token when puppet logs in", async () => {
    const store = fakeTokenStore();
    const puppet = fakePuppet();

    // onLogin mock must be ready before connect() so registerPuppetListeners picks it up.
    let capturedLoginHandler: ((user: unknown) => void) | undefined;
    vi.mocked(puppet.onLogin).mockImplementationOnce(
      (handler: (user: unknown) => void) => {
        capturedLoginHandler = handler;
      },
    );

    const channel = new WeChatChannel(
      {
        channelType: "wechat",
        channelInstanceId: "wechat-1",
        agentId: "agent-1",
        settings: {},
      },
      1,
      puppet,
      store,
      fakeProtocol(),
    );

    vi.mocked(puppet.start).mockImplementationOnce(async () => {
      // Fire the login handler that was registered during connect
      if (capturedLoginHandler) {
        capturedLoginHandler({ id: "puppet-user-1", token: "saved-token" });
      }
    });

    await channel.connect(new AbortController().signal);

    // After login, token should be saved.
    expect(store.save).toHaveBeenCalledWith(
      "wechat-1",
      "saved-token",
    );
  });

  it("clears token on logout", async () => {
    const store = fakeTokenStore();
    const puppet = fakePuppet();

    const channel = new WeChatChannel(
      {
        channelType: "wechat",
        channelInstanceId: "wechat-1",
        agentId: "agent-1",
        settings: {},
      },
      1,
      puppet,
      store,
      fakeProtocol(),
    );

    await channel.disconnect({ reason: "user", timeoutMs: 1000 });

    expect(store.clear).toHaveBeenCalledWith("wechat-1");
    expect(puppet.logout).toHaveBeenCalled();
  });

  it("emits WECHAT_CREDENTIAL_PERSIST_FAILED when token save fails", async () => {
    const store = fakeTokenStore();
    vi.mocked(store.save).mockRejectedValueOnce(new Error("disk full"));
    const puppet = fakePuppet();

    let capturedLoginHandler: ((user: unknown) => void) | undefined;
    vi.mocked(puppet.onLogin).mockImplementationOnce(
      (handler: (user: unknown) => void) => {
        capturedLoginHandler = handler;
      },
    );

    const channel = new WeChatChannel(
      {
        channelType: "wechat",
        channelInstanceId: "wechat-1",
        agentId: "agent-1",
        settings: {},
      },
      1,
      puppet,
      store,
    );

    const errors: Error[] = [];
    channel.onError((err) => errors.push(err));

    vi.mocked(puppet.start).mockImplementationOnce(async () => {
      if (capturedLoginHandler) {
        capturedLoginHandler({ id: "u-1", token: "secret-token" });
      }
    });

    await channel.connect(new AbortController().signal);

    // saveCredentials enqueues asynchronously — wait for the rejection to surface.
    await vi.waitFor(() => expect(errors).toHaveLength(1));
    expect(errors[0]?.message).toBe("WECHAT_CREDENTIAL_PERSIST_FAILED");
    // Must not include the token
    expect(errors[0]?.message).not.toContain("secret-token");
  });

  it("clears token store on credential invalidated event", async () => {
    const store = fakeTokenStore();
    const puppet = fakePuppet();

    let credInvalidatedHandler: (() => void) | undefined;
    vi.mocked(puppet.onCredentialInvalidated).mockImplementationOnce(
      (handler: () => void) => {
        credInvalidatedHandler = handler;
        return () => {
          credInvalidatedHandler = undefined;
        };
      },
    );

    const channel = new WeChatChannel(
      {
        channelType: "wechat",
        channelInstanceId: "wechat-1",
        agentId: "agent-1",
        settings: {},
      },
      1,
      puppet,
      store,
    );

    await channel.connect(new AbortController().signal);

    expect(credInvalidatedHandler).toBeDefined();
    credInvalidatedHandler!();

    // clearCredentials enqueues asynchronously — wait for it.
    await vi.waitFor(() =>
      expect(store.clear).toHaveBeenCalledWith("wechat-1"),
    );
  });

  it("rethrows token store load failure after emitting failed status", async () => {
    const store = fakeTokenStore();
    vi.mocked(store.load).mockRejectedValueOnce(new Error("permission denied"));
    const puppet = fakePuppet();

    const channel = new WeChatChannel(
      {
        channelType: "wechat",
        channelInstanceId: "wechat-1",
        agentId: "agent-1",
        settings: {},
      },
      1,
      puppet,
      store,
      fakeProtocol(),
    );

    const statuses: string[] = [];
    channel.onStatus((s) => statuses.push(s.state));

    await expect(
      channel.connect(new AbortController().signal),
    ).rejects.toThrow("permission denied");
    expect(statuses).toContain("failed");
  });
});

// ---------------------------------------------------------------------------
// Non-blocking connect behavior
// ---------------------------------------------------------------------------
describe("wechat non-blocking connect", () => {
  it("returns while pairing remains pending without claiming connected", async () => {
    const puppet = fakePuppet();
    vi.mocked(puppet.start).mockImplementationOnce(async () => {
      // start() returns immediately, puppet stays not logged in
    });

    const channel = new WeChatChannel(
      {
        channelType: "wechat",
        channelInstanceId: "wechat-1",
        agentId: "agent-1",
        settings: {},
      },
      1,
      puppet,
      fakeTokenStore(),
      fakeProtocol(),
    );

    const statuses: string[] = [];
    channel.onStatus((s) => statuses.push(s.state));

    await channel.connect(new AbortController().signal);

    expect(channel.connected).toBe(false);
    expect(statuses).toContain("starting");
    expect(statuses).not.toContain("connected");
  });

  it("does not emit failed status when aborted during pending pairing", async () => {
    const puppet = fakePuppet();

    const channel = new WeChatChannel(
      {
        channelType: "wechat",
        channelInstanceId: "wechat-1",
        agentId: "agent-1",
        settings: {},
      },
      1,
      puppet,
      fakeTokenStore(),
      fakeProtocol(),
    );

    const statuses: string[] = [];
    channel.onStatus((s) => statuses.push(s.state));

    const controller = new AbortController();
    await channel.connect(controller.signal);
    expect(statuses).toContain("starting");
    expect(statuses).not.toContain("failed");

    controller.abort();

    // Let teardown complete — the abort handler calls teardownConnection
    // which stops the puppet. No "failed" event should be emitted.
    await vi.waitFor(() => expect(puppet.stop).toHaveBeenCalled(), {
      timeout: 500,
    });
    expect(statuses).not.toContain("failed");
  }, 10_000);

  it("forwards pairing events with channel metadata", async () => {
    const puppet = fakePuppet();
    let puppetPairingHandler: ((e: WeChatPuppetPairingEvent) => void) | undefined;
    vi.mocked(puppet.onPairing).mockImplementationOnce(
      (handler: (e: WeChatPuppetPairingEvent) => void) => {
        puppetPairingHandler = handler;
        return () => {
          puppetPairingHandler = undefined;
        };
      },
    );

    const channel = new WeChatChannel(
      {
        channelType: "wechat",
        channelInstanceId: "wechat-1",
        agentId: "agent-1",
        settings: {},
      },
      3,
      puppet,
      fakeTokenStore(),
      fakeProtocol(),
    );

    const events: unknown[] = [];
    channel.onPairing?.((e) => events.push(e));

    await channel.connect(new AbortController().signal);

    expect(puppetPairingHandler).toBeDefined();
    puppetPairingHandler!({
      state: "pending",
      imageUrl: "data:image/png;base64,AA==",
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      version: 1,
      channelType: "wechat",
      channelInstanceId: "wechat-1",
      generation: 3,
      state: "pending",
      imageUrl: "data:image/png;base64,AA==",
    });
  });
});

// ---------------------------------------------------------------------------
// Text & image delivery
// ---------------------------------------------------------------------------
describe("wechat text and image delivery", () => {
  it("delivers text messages", async () => {
    const puppet = fakePuppet();

    const channel = new WeChatChannel(
      {
        channelType: "wechat",
        channelInstanceId: "wechat-1",
        agentId: "agent-1",
        settings: {},
      },
      1,
      puppet,
      fakeTokenStore(),
      fakeProtocol(),
    );

    let msgCb: ((msg: unknown) => void) | undefined;
    vi.mocked(puppet.onMessage).mockImplementationOnce(
      (handler: (msg: unknown) => void) => {
        msgCb = handler;
      },
    );

    const handler = vi.fn();
    channel.onMessage(handler);

    await channel.connect(new AbortController().signal);
    expect(msgCb).toBeDefined();

    msgCb!({
      id: "msg-1",
      talker: () => ({ id: "user-1", name: () => "User" }),
      room: () => null,
      text: () => "hello",
      type: () => 7, // text type
    });

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        chatKind: "dm",
        text: "hello",
        userId: "user-1",
      }),
    );
  });

  it("delivers image messages", async () => {
    const puppet = fakePuppet();

    const channel = new WeChatChannel(
      {
        channelType: "wechat",
        channelInstanceId: "wechat-1",
        agentId: "agent-1",
        settings: {},
      },
      1,
      puppet,
      fakeTokenStore(),
      fakeProtocol(),
    );

    let msgCb: ((msg: unknown) => void) | undefined;
    vi.mocked(puppet.onMessage).mockImplementationOnce(
      (handler: (msg: unknown) => void) => {
        msgCb = handler;
      },
    );

    const handler = vi.fn();
    channel.onMessage(handler);

    await channel.connect(new AbortController().signal);
    expect(msgCb).toBeDefined();

    msgCb!({
      id: "img-1",
      talker: () => ({ id: "user-1", name: () => "User" }),
      room: () => null,
      text: () => "",
      type: () => 6, // image type
    });

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        chatKind: "dm",
        text: "",
        attachments: expect.arrayContaining([
          expect.objectContaining({ sourceKind: "platform" }),
        ]),
      }),
    );
  });

  it("delivers group messages with room info", async () => {
    const puppet = fakePuppet();

    const channel = new WeChatChannel(
      {
        channelType: "wechat",
        channelInstanceId: "wechat-1",
        agentId: "agent-1",
        settings: {},
      },
      1,
      puppet,
      fakeTokenStore(),
      fakeProtocol(),
    );

    let msgCb: ((msg: unknown) => void) | undefined;
    vi.mocked(puppet.onMessage).mockImplementationOnce(
      (handler: (msg: unknown) => void) => {
        msgCb = handler;
      },
    );

    const handler = vi.fn();
    channel.onMessage(handler);

    await channel.connect(new AbortController().signal);

    msgCb!({
      id: "grp-1",
      talker: () => ({ id: "user-2", name: () => "GroupUser" }),
      room: () => ({ id: "room-1", topic: () => "TestRoom" }),
      text: () => "group hello",
      type: () => 7,
    });

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        chatKind: "group",
        chatId: "room-1",
        userId: "user-2",
      }),
    );
  });

  it("sends text via puppet.sendText", async () => {
    const puppet = fakePuppet();
    let loginCb: ((user: unknown) => void) | undefined;
    vi.mocked(puppet.onLogin).mockImplementationOnce(
      (handler: (user: unknown) => void) => {
        loginCb = handler;
      },
    );
    vi.mocked(puppet.start).mockImplementationOnce(async () => {
      if (loginCb) loginCb({ id: "u-1" });
    });

    const channel = new WeChatChannel(
      {
        channelType: "wechat",
        channelInstanceId: "wechat-1",
        agentId: "agent-1",
        settings: {},
      },
      1,
      puppet,
      fakeTokenStore(),
      fakeProtocol(),
    );

    await channel.connect(new AbortController().signal);

    const result = await channel.send({
      version: 1,
      generation: 1,
      idempotencyKey: "ikey-1",
      target: {
        version: 1,
        channelType: "wechat",
        channelInstanceId: "wechat-1",
        chatId: "user-1",
        visibility: "chat",
      },
      text: "hello from bot",
      kind: "reply",
    });

    expect(result.outcome).toBe("committed");
    expect(puppet.sendText).toHaveBeenCalledWith("user-1", "hello from bot");
  });

  it("routes private target to userId when sending text", async () => {
    const puppet = fakePuppet();
    let loginCb: ((user: unknown) => void) | undefined;
    vi.mocked(puppet.onLogin).mockImplementationOnce(
      (handler: (user: unknown) => void) => {
        loginCb = handler;
      },
    );
    vi.mocked(puppet.start).mockImplementationOnce(async () => {
      if (loginCb) loginCb({ id: "u-1" });
    });

    const channel = new WeChatChannel(
      {
        channelType: "wechat",
        channelInstanceId: "wechat-1",
        agentId: "agent-1",
        settings: {},
      },
      1,
      puppet,
      fakeTokenStore(),
      fakeProtocol(),
    );

    await channel.connect(new AbortController().signal);

    const result = await channel.send({
      version: 1,
      generation: 1,
      idempotencyKey: "ikey-private",
      target: {
        version: 1,
        channelType: "wechat",
        channelInstanceId: "wechat-1",
        chatId: "group-room-1",
        visibility: "private",
        userId: "user-99",
      },
      text: "private hello",
      kind: "notification",
    });

    expect(result.outcome).toBe("committed");
    expect(puppet.sendText).toHaveBeenCalledWith("user-99", "private hello");
    expect(puppet.sendText).not.toHaveBeenCalledWith("group-room-1", expect.anything());
  });

  it("routes private sendTyping to userId", async () => {
    const puppet = fakePuppet();
    let loginCb: ((user: unknown) => void) | undefined;
    vi.mocked(puppet.onLogin).mockImplementationOnce(
      (handler: (user: unknown) => void) => {
        loginCb = handler;
      },
    );
    vi.mocked(puppet.start).mockImplementationOnce(async () => {
      if (loginCb) loginCb({ id: "u-1" });
    });

    const channel = new WeChatChannel(
      {
        channelType: "wechat",
        channelInstanceId: "wechat-1",
        agentId: "agent-1",
        settings: {},
      },
      1,
      puppet,
      fakeTokenStore(),
      fakeProtocol(),
    );

    await channel.connect(new AbortController().signal);

    await channel.sendTyping({
      version: 1,
      channelType: "wechat",
      channelInstanceId: "wechat-1",
      chatId: "group-room-1",
      visibility: "private",
      userId: "user-99",
    });

    expect(puppet.sendTyping).toHaveBeenCalledWith("user-99");
  });

  it("supports sending images", async () => {
    const puppet = fakePuppet();
    let loginCb: ((user: unknown) => void) | undefined;
    vi.mocked(puppet.onLogin).mockImplementationOnce(
      (handler: (user: unknown) => void) => {
        loginCb = handler;
      },
    );
    vi.mocked(puppet.start).mockImplementationOnce(async () => {
      if (loginCb) loginCb({ id: "u-1" });
    });

    const channel = new WeChatChannel(
      {
        channelType: "wechat",
        channelInstanceId: "wechat-1",
        agentId: "agent-1",
        settings: {},
      },
      1,
      puppet,
      fakeTokenStore(),
      fakeProtocol(),
    );

    await channel.connect(new AbortController().signal);

    const result = await channel.sendFile!(
      {
        version: 1,
        channelType: "wechat",
        channelInstanceId: "wechat-1",
        chatId: "user-1",
        visibility: "chat",
      },
      {
        version: 1,
        filename: "photo.jpg",
        data: "base64data",
        mediaType: "image/jpeg",
        size: 1024,
      },
      "ikey-img",
    );

    expect(result.outcome).toBe("committed");
    expect(puppet.sendImage).toHaveBeenCalledWith("user-1", "base64data");
  });
});

// ---------------------------------------------------------------------------
// Document delivery
// ---------------------------------------------------------------------------
describe("wechat unsupported document delivery", () => {
  it("sends file attachments that are not images through the puppet", async () => {
    const puppet = fakePuppet();
    let loginCb: ((user: unknown) => void) | undefined;
    vi.mocked(puppet.onLogin).mockImplementationOnce(
      (handler: (user: unknown) => void) => {
        loginCb = handler;
      },
    );
    vi.mocked(puppet.start).mockImplementationOnce(async () => {
      if (loginCb) loginCb({ id: "u-1" });
    });

    const channel = new WeChatChannel(
      {
        channelType: "wechat",
        channelInstanceId: "wechat-1",
        agentId: "agent-1",
        settings: {},
      },
      1,
      puppet,
      fakeTokenStore(),
      fakeProtocol(),
    );

    await channel.connect(new AbortController().signal);

    const result = await channel.sendFile!(
      {
        version: 1,
        channelType: "wechat",
        channelInstanceId: "wechat-1",
        chatId: "user-1",
        visibility: "chat",
      },
      {
        version: 1,
        filename: "report.pdf",
        data: "base64data",
        mediaType: "application/pdf",
        size: 2048,
      },
      "ikey-doc",
    );

    expect(result.accepted).toBe(true);
    expect(result.outcome).toBe("committed");
    expect(puppet.sendFile).toHaveBeenCalledWith(
      "user-1",
      "base64data",
      "report.pdf",
    );
  });

  it("returns CHANNEL_CAPABILITY_UNAVAILABLE for send with unresolved doc attachment", async () => {
    const puppet = fakePuppet();
    let loginCb: ((user: unknown) => void) | undefined;
    vi.mocked(puppet.onLogin).mockImplementationOnce(
      (handler: (user: unknown) => void) => {
        loginCb = handler;
      },
    );
    vi.mocked(puppet.start).mockImplementationOnce(async () => {
      if (loginCb) loginCb({ id: "u-1" });
    });

    const channel = new WeChatChannel(
      {
        channelType: "wechat",
        channelInstanceId: "wechat-1",
        agentId: "agent-1",
        settings: {},
      },
      1,
      puppet,
      fakeTokenStore(),
      fakeProtocol(),
    );

    await channel.connect(new AbortController().signal);

    const result = await channel.send({
      version: 1,
      generation: 1,
      idempotencyKey: "ikey-doc2",
      target: {
        version: 1,
        channelType: "wechat",
        channelInstanceId: "wechat-1",
        chatId: "user-1",
        visibility: "chat",
      },
      text: "check this doc",
      attachments: [
        {
          version: 1,
          filename: "slides.pptx",
          mediaType:
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        },
      ],
      kind: "reply",
    });

    expect(result.accepted).toBe(false);
    expect(result.outcome).toBe("permanent_failure");
    expect(result.errorCode).toBe("CHANNEL_CAPABILITY_UNAVAILABLE");
  });
});

// ---------------------------------------------------------------------------
// ChannelAdapter contract compliance
// ---------------------------------------------------------------------------
describe("wechat ChannelAdapter contract", () => {
  it("returns unsubscribe functions for every event subscription", () => {
    const channel = new WeChatChannel(
      {
        channelType: "wechat",
        channelInstanceId: "wechat-1",
        agentId: "agent-1",
        settings: {},
      },
      1,
      fakePuppet(),
      fakeTokenStore(),
      fakeProtocol(),
    );

    expect(channel.onMessage(() => undefined)).toBeTypeOf("function");
    expect(channel.onCommand(() => undefined)).toBeTypeOf("function");
    expect(channel.onInteraction(() => undefined)).toBeTypeOf("function");
    expect(channel.onStatus(() => undefined)).toBeTypeOf("function");
    expect(channel.onError(() => undefined)).toBeTypeOf("function");
  });

  it("exposes channelType, channelInstanceId, generation, connected", () => {
    const channel = new WeChatChannel(
      {
        channelType: "wechat",
        channelInstanceId: "wechat-1",
        agentId: "agent-1",
        settings: {},
      },
      2,
      fakePuppet(),
      fakeTokenStore(),
      fakeProtocol(),
    );

    expect(channel.channelType).toBe("wechat");
    expect(channel.channelInstanceId).toBe("wechat-1");
    expect(channel.generation).toBe(2);
    expect(channel.connected).toBe(false);
  });
});

// ===================================================================
// Task 2 TDD: credential queue, abort ownership, lifecycle edge cases
// ===================================================================

describe("wechat credential queue", () => {
  it("prevents a stale save from overwriting a later clear (logout race)", async () => {
    const store = fakeTokenStore();
    const puppet = fakePuppet();

    let loginHandler: ((user: unknown) => void) | undefined;
    vi.mocked(puppet.onLogin).mockImplementationOnce(
      (handler: (user: unknown) => void) => {
        loginHandler = handler;
      },
    );

    let invalidationHandler: (() => void) | undefined;
    vi.mocked(puppet.onCredentialInvalidated).mockImplementationOnce(
      (handler: () => void) => {
        invalidationHandler = handler;
        return () => {
          invalidationHandler = undefined;
        };
      },
    );

    const channel = new WeChatChannel(
      {
        channelType: "wechat",
        channelInstanceId: "wechat-1",
        agentId: "agent-1",
        settings: {},
      },
      1,
      puppet,
      store,
    );

    // Fire login and then immediately invalidate in the same synchronous
    // window to simulate the race: save enqueued, clear bumps epoch before
    // the save's .then() runs.
    vi.mocked(puppet.start).mockImplementationOnce(async () => {
      loginHandler?.({ id: "u-1", token: "secret-token" });
      invalidationHandler?.();
    });

    const statuses: string[] = [];
    channel.onStatus((s) => statuses.push(s.state));

    await channel.connect(new AbortController().signal);

    // The save at epoch 1 must be discarded because clear bumped epoch to 2.
    await vi.waitFor(() =>
      expect(store.clear).toHaveBeenCalledWith("wechat-1"),
    );
    expect(store.save).not.toHaveBeenCalled();
    expect(statuses).toContain("reconnecting");
  });

  it("serializes consecutive saves so later one is the winner", async () => {
    const store = fakeTokenStore();
    const puppet = fakePuppet();

    let loginHandler: ((user: unknown) => void) | undefined;
    vi.mocked(puppet.onLogin).mockImplementationOnce(
      (handler: (user: unknown) => void) => {
        loginHandler = handler;
      },
    );

    const channel = new WeChatChannel(
      {
        channelType: "wechat",
        channelInstanceId: "wechat-1",
        agentId: "agent-1",
        settings: {},
      },
      1,
      puppet,
      store,
    );

    // Fire two logins in the same synchronous window so both
    // saveCredentials calls are enqueued before microtasks drain.
    vi.mocked(puppet.start).mockImplementationOnce(async () => {
      loginHandler?.({ id: "u-1", token: "token-1" });
      // Call the same Channel login handler again (not a new mock).
      loginHandler?.({ id: "u-2", token: "token-2" });
    });

    await channel.connect(new AbortController().signal);

    // Wait for the credential queue to drain.
    await vi.waitFor(() =>
      expect(store.save).toHaveBeenCalledWith("wechat-1", "token-2"),
    );

    // The first save (token-1 at epoch 1) is discarded because epoch became 2.
    // Only token-2 should be persisted.
    const saveCalls = vi.mocked(store.save).mock.calls;
    expect(saveCalls).toHaveLength(1);
    expect(saveCalls[0]?.[1]).toBe("token-2");
  });

  it("emits WECHAT_CREDENTIAL_CLEAR_FAILED on clear failure", async () => {
    const store = fakeTokenStore();
    vi.mocked(store.clear).mockRejectedValueOnce(new Error("permission denied"));
    const puppet = fakePuppet();

    const channel = new WeChatChannel(
      {
        channelType: "wechat",
        channelInstanceId: "wechat-1",
        agentId: "agent-1",
        settings: {},
      },
      1,
      puppet,
      store,
    );

    const errors: Error[] = [];
    channel.onError((err) => errors.push(err));

    // disconnect with reason=user calls clearCredentials.
    // clear failure emits WECHAT_CREDENTIAL_CLEAR_FAILED.
    await channel.disconnect({ reason: "user", timeoutMs: 1000 });

    expect(errors.some((e) => e.message === "WECHAT_CREDENTIAL_CLEAR_FAILED")).toBe(true);
    // Must not leak the raw error message.
    expect(errors.some((e) => e.message.includes("permission denied"))).toBe(false);
  });

  it("does not save after credential invalidation bumps epoch", async () => {
    const store = fakeTokenStore();
    const puppet = fakePuppet();

    let loginHandler: ((user: unknown) => void) | undefined;
    vi.mocked(puppet.onLogin).mockImplementationOnce(
      (handler: (user: unknown) => void) => {
        loginHandler = handler;
      },
    );

    let invalidatedHandler: (() => void) | undefined;
    vi.mocked(puppet.onCredentialInvalidated).mockImplementationOnce(
      (handler: () => void) => {
        invalidatedHandler = handler;
        return () => {
          invalidatedHandler = undefined;
        };
      },
    );

    const channel = new WeChatChannel(
      {
        channelType: "wechat",
        channelInstanceId: "wechat-1",
        agentId: "agent-1",
        settings: {},
      },
      1,
      puppet,
      store,
    );

    vi.mocked(puppet.start).mockImplementationOnce(async () => {
      // Login fires save (epoch 1).
      loginHandler?.({ id: "u-1", token: "token-1" });
      // Immediately invalidate — bumps epoch to 2.
      invalidatedHandler?.();
    });

    const statuses: string[] = [];
    channel.onStatus((s) => statuses.push(s.state));

    await channel.connect(new AbortController().signal);

    await vi.waitFor(() =>
      expect(store.clear).toHaveBeenCalledWith("wechat-1"),
    );

    // The save at epoch 1 should see epoch 2 and discard itself.
    expect(store.save).not.toHaveBeenCalled();
    expect(statuses).toContain("reconnecting");
  });
});

describe("wechat abort ownership and lifecycle", () => {
  it("returns silently for an already-aborted signal without failed status", async () => {
    const puppet = fakePuppet();
    const channel = new WeChatChannel(
      {
        channelType: "wechat",
        channelInstanceId: "wechat-1",
        agentId: "agent-1",
        settings: {},
      },
      1,
      puppet,
      fakeTokenStore(),
    );

    const statuses: string[] = [];
    channel.onStatus((s) => statuses.push(s.state));

    const aborted = new AbortController();
    aborted.abort();

    await channel.connect(aborted.signal);

    expect(statuses).not.toContain("failed");
    expect(statuses).not.toContain("starting");
    expect(puppet.start).not.toHaveBeenCalled();
  });

  it("idempotent: repeated disconnect does not throw", async () => {
    const puppet = fakePuppet();
    const channel = new WeChatChannel(
      {
        channelType: "wechat",
        channelInstanceId: "wechat-1",
        agentId: "agent-1",
        settings: {},
      },
      1,
      puppet,
      fakeTokenStore(),
    );

    await channel.connect(new AbortController().signal);
    await channel.disconnect();
    // Second disconnect must not throw.
    await channel.disconnect();
    expect(puppet.stop).toHaveBeenCalledTimes(1);
  });

  it("connect during stop waits for stop then starts fresh", async () => {
    const puppet = fakePuppet();
    let stopResolve: (() => void) | undefined;
    vi.mocked(puppet.stop).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          stopResolve = resolve;
        }),
    );

    const channel = new WeChatChannel(
      {
        channelType: "wechat",
        channelInstanceId: "wechat-1",
        agentId: "agent-1",
        settings: {},
      },
      1,
      puppet,
      fakeTokenStore(),
    );

    await channel.connect(new AbortController().signal);

    // Start disconnect (will block on puppet.stop).
    const disconnectPromise = channel.disconnect();

    // While stopping, start a new connect.
    const secondSignal = new AbortController().signal;
    const connectPromise = channel.connect(secondSignal);

    // Let the stop resolve.
    stopResolve?.();

    await disconnectPromise;
    await connectPromise;

    // puppet.start must have been called exactly twice (once per connect).
    expect(puppet.start).toHaveBeenCalledTimes(2);
  });

  it("stale abort listener cannot stop a later connect", async () => {
    const puppet = fakePuppet();
    const channel = new WeChatChannel(
      {
        channelType: "wechat",
        channelInstanceId: "wechat-1",
        agentId: "agent-1",
        settings: {},
      },
      1,
      puppet,
      fakeTokenStore(),
    );

    const firstController = new AbortController();
    await channel.connect(firstController.signal);
    await channel.disconnect();

    // Abort the first controller after disconnect — must not interfere.
    firstController.abort();

    // Start a second connect — must succeed.
    const secondController = new AbortController();
    await channel.connect(secondController.signal);

    expect(channel.connected).toBe(false); // still not logged in, but started
    expect(puppet.start).toHaveBeenCalledTimes(2);
  });

  it("second login after session expiry does not throw (no protocol transition)", async () => {
    const puppet = fakePuppet();
    let loginHandler: ((user: unknown) => void) | undefined;
    vi.mocked(puppet.onLogin).mockImplementationOnce(
      (handler: (user: unknown) => void) => {
        loginHandler = handler;
      },
    );
    let invalidatedHandler: (() => void) | undefined;
    vi.mocked(puppet.onCredentialInvalidated).mockImplementationOnce(
      (handler: () => void) => {
        invalidatedHandler = handler;
        return () => {
          invalidatedHandler = undefined;
        };
      },
    );

    const channel = new WeChatChannel(
      {
        channelType: "wechat",
        channelInstanceId: "wechat-1",
        agentId: "agent-1",
        settings: {},
      },
      1,
      puppet,
      fakeTokenStore(),
    );

    // First login.
    vi.mocked(puppet.start).mockImplementationOnce(async () => {
      loginHandler?.({ id: "u-1", token: "t1" });
    });

    await channel.connect(new AbortController().signal);
    expect(channel.connected).toBe(true);

    // Session expired — invalidation sets connected=false, reconnecting.
    invalidatedHandler?.();
    await flushMicrotasks();
    expect(channel.connected).toBe(false);

    // Second login — previously protocol.transition("confirmed") would
    // throw because state was already "confirmed". Now it must not throw.
    loginHandler?.({ id: "u-1", token: "t1" });
    await flushMicrotasks();
    expect(channel.connected).toBe(true);
  });

  it("pairing failed event sets connected=false and emits failed status", async () => {
    const puppet = fakePuppet();
    let pairingHandler: ((e: WeChatPuppetPairingEvent) => void) | undefined;
    vi.mocked(puppet.onPairing).mockImplementationOnce(
      (handler: (e: WeChatPuppetPairingEvent) => void) => {
        pairingHandler = handler;
        return () => {
          pairingHandler = undefined;
        };
      },
    );

    const channel = new WeChatChannel(
      {
        channelType: "wechat",
        channelInstanceId: "wechat-1",
        agentId: "agent-1",
        settings: {},
      },
      1,
      puppet,
      fakeTokenStore(),
    );

    const statuses: Array<{ state: string; errorCode?: string }> = [];
    const pairingEvents: ChannelPairingEvent[] = [];
    channel.onStatus((event) => statuses.push(event));
    channel.onPairing((event) => pairingEvents.push(event));

    await channel.connect(new AbortController().signal);

    pairingHandler?.({
      state: "failed",
      imageUrl: "data:image/png;base64,AA==",
      errorCode: "WECHAT_QR_STATUS_INVALID",
    });

    expect(channel.connected).toBe(false);
    expect(statuses).toContainEqual(
      expect.objectContaining({
        state: "failed",
        errorCode: "WECHAT_QR_STATUS_INVALID",
      }),
    );
    expect(pairingEvents).toContainEqual(
      expect.objectContaining({
        state: "failed",
        imageUrl: undefined,
        errorCode: "WECHAT_QR_STATUS_INVALID",
      }),
    );
  });

  // -----------------------------------------------------------------------
  // Issue 1: abort during tokenStore.load must not start puppet
  // -----------------------------------------------------------------------
  it("abort during tokenStore.load must not start puppet", async () => {
    const puppet = fakePuppet();
    let loadResolve: (() => void) | undefined;
    const store = fakeTokenStore();
    vi.mocked(store.load).mockReturnValueOnce(
      new Promise<string | null>((resolve) => {
        loadResolve = () => resolve(null);
      }),
    );

    const channel = new WeChatChannel(
      {
        channelType: "wechat",
        channelInstanceId: "wechat-1",
        agentId: "agent-1",
        settings: {},
      },
      1,
      puppet,
      store,
    );

    const statuses: string[] = [];
    channel.onStatus((s) => statuses.push(s.state));

    const controller = new AbortController();
    // Start connect — it blocks on tokenStore.load
    const connectPromise = channel.connect(controller.signal);

    await vi.waitFor(() => expect(store.load).toHaveBeenCalled());

    // Abort while load is pending
    controller.abort();

    // Resolve load so connect can continue past the await
    loadResolve?.();

    await connectPromise;

    // Must not have started puppet after abort
    expect(puppet.start).not.toHaveBeenCalled();
    expect(statuses).not.toContain("failed");
  });

  // -----------------------------------------------------------------------
  // Issue 1: abort while awaiting prior stop must not start/restart puppet
  // -----------------------------------------------------------------------
  it("abort while awaiting prior stop must not start puppet", async () => {
    const puppet = fakePuppet();
    let stopResolve: (() => void) | undefined;
    vi.mocked(puppet.stop).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          stopResolve = resolve;
        }),
    );

    const channel = new WeChatChannel(
      {
        channelType: "wechat",
        channelInstanceId: "wechat-1",
        agentId: "agent-1",
        settings: {},
      },
      1,
      puppet,
      fakeTokenStore(),
    );

    // First connect
    await channel.connect(new AbortController().signal);

    // Start disconnect (blocked on puppet.stop)
    const disconnectPromise = channel.disconnect();

    // Try to connect with a fresh signal while stop is in progress
    const controller = new AbortController();
    const connectPromise = channel.connect(controller.signal);

    // connect should now be waiting on this.stoppingPromise
    // Abort the connect's signal during that wait
    controller.abort();

    // Resolve the stop
    stopResolve?.();
    await disconnectPromise;

    await connectPromise;

    // puppet.start must have been called exactly once (first connect only)
    expect(puppet.start).toHaveBeenCalledTimes(1);
  });

  it("stale start rejection after disconnect is treated as cancellation", async () => {
    const puppet = fakePuppet();
    let rejectStart: ((error: Error) => void) | undefined;
    vi.mocked(puppet.start).mockImplementationOnce(
      () => new Promise<void>((_resolve, reject) => { rejectStart = reject; }),
    );
    const channel = new WeChatChannel(
      {
        channelType: "wechat",
        channelInstanceId: "wechat-stale-reject",
        agentId: "agent-1",
        settings: {},
      },
      1,
      puppet,
      fakeTokenStore(),
    );
    const statuses: string[] = [];
    channel.onStatus((status) => statuses.push(status.state));

    const connectPromise = channel.connect(new AbortController().signal);
    await vi.waitFor(() => expect(puppet.start).toHaveBeenCalledOnce());
    await channel.disconnect();
    rejectStart?.(new Error("late start failure"));

    await expect(connectPromise).resolves.toBeUndefined();
    expect(statuses).not.toContain("failed");
  });

  it("user disconnect starts puppet stop before credential clear settles", async () => {
    const puppet = fakePuppet();
    const store = fakeTokenStore();
    let resolveClear: (() => void) | undefined;
    vi.mocked(store.clear).mockImplementationOnce(
      () => new Promise<void>((resolve) => { resolveClear = resolve; }),
    );
    const channel = new WeChatChannel(
      {
        channelType: "wechat",
        channelInstanceId: "wechat-parallel-clear",
        agentId: "agent-1",
        settings: {},
      },
      1,
      puppet,
      store,
    );
    await channel.connect(new AbortController().signal);

    const disconnectPromise = channel.disconnect({ reason: "user", timeoutMs: 1000 });
    await vi.waitFor(() => expect(store.clear).toHaveBeenCalledOnce());
    expect(puppet.stop).toHaveBeenCalledOnce();
    resolveClear?.();
    await disconnectPromise;
  });

  it("serializes a new connect until a stale delayed start settles", async () => {
    const puppet = fakePuppet();
    let resolveFirstStart: (() => void) | undefined;
    vi.mocked(puppet.start).mockImplementationOnce(
      () => new Promise<void>((resolve) => { resolveFirstStart = resolve; }),
    );
    const channel = new WeChatChannel(
      {
        channelType: "wechat",
        channelInstanceId: "wechat-serialized-connect",
        agentId: "agent-1",
        settings: {},
      },
      1,
      puppet,
      fakeTokenStore(),
    );

    const firstConnect = channel.connect(new AbortController().signal);
    await vi.waitFor(() => expect(puppet.start).toHaveBeenCalledOnce());
    await channel.disconnect();
    const secondConnect = channel.connect(new AbortController().signal);
    await Promise.resolve();
    expect(puppet.start).toHaveBeenCalledTimes(1);

    resolveFirstStart?.();
    await Promise.all([firstConnect, secondConnect]);
    expect(puppet.start).toHaveBeenCalledTimes(2);
  });

  it("disconnect while puppet start is pending stops the stale start again", async () => {
    const puppet = fakePuppet();
    let resolveStart: (() => void) | undefined;
    vi.mocked(puppet.start).mockImplementationOnce(
      () => new Promise<void>((resolve) => { resolveStart = resolve; }),
    );
    const channel = new WeChatChannel(
      {
        channelType: "wechat",
        channelInstanceId: "wechat-start-race",
        agentId: "agent-1",
        settings: {},
      },
      1,
      puppet,
      fakeTokenStore(),
    );

    const connectPromise = channel.connect(new AbortController().signal);
    await vi.waitFor(() => expect(puppet.start).toHaveBeenCalledOnce());
    await channel.disconnect();
    resolveStart?.();
    await connectPromise;

    expect(puppet.stop).toHaveBeenCalledTimes(2);
    expect(channel.connected).toBe(false);
  });

  it("disconnect during token load does not start the puppet", async () => {
    const puppet = fakePuppet();
    const store = fakeTokenStore();
    let resolveLoad: ((token: string | null) => void) | undefined;
    vi.mocked(store.load).mockImplementationOnce(
      () => new Promise((resolve) => { resolveLoad = resolve; }),
    );
    const channel = new WeChatChannel(
      {
        channelType: "wechat",
        channelInstanceId: "wechat-load-race",
        agentId: "agent-1",
        settings: {},
      },
      1,
      puppet,
      store,
    );

    const connectPromise = channel.connect(new AbortController().signal);
    await vi.waitFor(() => expect(store.load).toHaveBeenCalledOnce());
    const disconnectPromise = channel.disconnect();
    resolveLoad?.(null);
    await Promise.all([connectPromise, disconnectPromise]);

    expect(puppet.start).not.toHaveBeenCalled();
    expect(channel.connected).toBe(false);
  });
});

// ===================================================================
// Issue 2: cross-generation credential ordering
// ===================================================================
describe("wechat cross-generation credential ordering", () => {

  it("old-gen disconnect clear before new-gen login save finishes with new credentials", async () => {
    const store = fakeTokenStore();
    let resolveClear: (() => void) | undefined;
    vi.mocked(store.clear).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveClear = resolve;
        }),
    );

    // ---- Old generation ----
    const oldPuppet = fakePuppet();
    const oldChannel = new WeChatChannel(
      {
        channelType: "wechat",
        channelInstanceId: "wechat-1",
        agentId: "agent-1",
        settings: {},
      },
      1,
      oldPuppet,
      store,
    );

    await oldChannel.connect(new AbortController().signal);

    // Start old-gen disconnect (user-initiated — clears credentials before stop)
    const oldDisconnectPromise = oldChannel.disconnect({
      reason: "user",
      timeoutMs: 1000,
    });

    // Wait for clear to be enqueued (mock is called)
    await vi.waitFor(() => expect(store.clear).toHaveBeenCalled());

    // ---- New generation connects while old clear is still pending ----
    const newPuppet = fakePuppet();
    let loginHandler: ((user: unknown) => void) | undefined;
    vi.mocked(newPuppet.onLogin).mockImplementationOnce(
      (handler: (user: unknown) => void) => {
        loginHandler = handler;
      },
    );

    const newChannel = new WeChatChannel(
      {
        channelType: "wechat",
        channelInstanceId: "wechat-1",
        agentId: "agent-1",
        settings: {},
      },
      2,
      newPuppet,
      store,
    );

    vi.mocked(newPuppet.start).mockImplementationOnce(async () => {
      loginHandler?.({ id: "new-user", token: "new-token" });
    });

    const newConnectPromise = newChannel.connect(new AbortController().signal);

    // save was enqueued via the module queue (behind the pending clear).
    // store.save has NOT been called yet because clear is pending.

    // Resolve clear so the queue drains.
    resolveClear?.();

    await oldDisconnectPromise;
    await newConnectPromise;

    // After the queue drains, save must have written new-token.
    await vi.waitFor(() =>
      expect(store.save).toHaveBeenCalledWith("wechat-1", "new-token"),
    );
  });

  it("old-gen late login after teardown cannot save credentials", async () => {
    const store = fakeTokenStore();

    // ---- Old generation ----
    const oldPuppet = fakePuppet();
    let oldLoginHandler: ((user: unknown) => void) | undefined;
    vi.mocked(oldPuppet.onLogin).mockImplementationOnce(
      (handler: (user: unknown) => void) => {
        oldLoginHandler = handler;
      },
    );

    const oldChannel = new WeChatChannel(
      {
        channelType: "wechat",
        channelInstanceId: "wechat-1",
        agentId: "agent-1",
        settings: {},
      },
      1,
      oldPuppet,
      store,
    );

    await oldChannel.connect(new AbortController().signal);

    // Disconnect (user) — sets teardownStarted, clears, stops
    await oldChannel.disconnect({ reason: "user", timeoutMs: 1000 });

    const statuses: string[] = [];
    oldChannel.onStatus((status) => statuses.push(status.state));

    // Late login from old puppet after teardown is complete
    oldLoginHandler?.({ id: "stale-user", token: "stale-token" });
    await flushMicrotasks();

    // Must not restore connection state or save stale credentials.
    expect(store.save).not.toHaveBeenCalled();
    expect(oldChannel.connected).toBe(false);
    expect(statuses).not.toContain("connected");
  });

  it("old-gen late invalidation cannot clear new credentials", async () => {
    const store = fakeTokenStore();
    const oldPuppet = fakePuppet();
    let oldInvalidatedHandler: (() => void) | undefined;
    vi.mocked(oldPuppet.onCredentialInvalidated).mockImplementationOnce(
      (handler) => {
        oldInvalidatedHandler = handler;
        return () => { oldInvalidatedHandler = undefined; };
      },
    );
    const oldChannel = new WeChatChannel(
      {
        channelType: "wechat",
        channelInstanceId: "wechat-invalidation-race",
        agentId: "agent-1",
        settings: {},
      },
      1,
      oldPuppet,
      store,
    );
    await oldChannel.connect(new AbortController().signal);
    await oldChannel.disconnect();
    vi.mocked(store.clear).mockClear();

    oldInvalidatedHandler?.();
    await flushMicrotasks();

    expect(store.clear).not.toHaveBeenCalled();
    expect(oldChannel.connected).toBe(false);
  });

  it("new-gen login save succeeds after old-gen disconnect clear", async () => {
    const store = fakeTokenStore();
    let resolveClear: (() => void) | undefined;
    vi.mocked(store.clear).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveClear = resolve;
        }),
    );

    // ---- Old generation ----
    const oldPuppet = fakePuppet();
    const oldChannel = new WeChatChannel(
      {
        channelType: "wechat",
        channelInstanceId: "wechat-1",
        agentId: "agent-1",
        settings: {},
      },
      1,
      oldPuppet,
      store,
    );

    await oldChannel.connect(new AbortController().signal);
    const oldDisconnectPromise = oldChannel.disconnect({
      reason: "user",
      timeoutMs: 1000,
    });

    await vi.waitFor(() => expect(store.clear).toHaveBeenCalled());

    // ---- New generation ----
    const newPuppet = fakePuppet();
    let loginHandler: ((user: unknown) => void) | undefined;
    vi.mocked(newPuppet.onLogin).mockImplementationOnce(
      (handler: (user: unknown) => void) => {
        loginHandler = handler;
      },
    );

    const newChannel = new WeChatChannel(
      {
        channelType: "wechat",
        channelInstanceId: "wechat-1",
        agentId: "agent-1",
        settings: {},
      },
      2,
      newPuppet,
      store,
    );

    vi.mocked(newPuppet.start).mockImplementationOnce(async () => {
      loginHandler?.({ id: "new-user", token: "new-token" });
    });

    await newChannel.connect(new AbortController().signal);

    // Resolve the pending clear so the queued save can proceed.
    resolveClear?.();
    await oldDisconnectPromise;

    // New credentials must be saved.
    await vi.waitFor(() =>
      expect(store.save).toHaveBeenCalledWith("wechat-1", "new-token"),
    );
  });

  it("session-expiry reauth within one active channel can save replacement credentials", async () => {
    const store = fakeTokenStore();
    const puppet = fakePuppet();

    let loginHandler: ((user: unknown) => void) | undefined;
    vi.mocked(puppet.onLogin).mockImplementationOnce(
      (handler: (user: unknown) => void) => {
        loginHandler = handler;
      },
    );

    let invalidatedHandler: (() => void) | undefined;
    vi.mocked(puppet.onCredentialInvalidated).mockImplementationOnce(
      (handler: () => void) => {
        invalidatedHandler = handler;
        return () => {
          invalidatedHandler = undefined;
        };
      },
    );

    const channel = new WeChatChannel(
      {
        channelType: "wechat",
        channelInstanceId: "wechat-1",
        agentId: "agent-1",
        settings: {},
      },
      1,
      puppet,
      store,
    );

    await channel.connect(new AbortController().signal);

    // Session expiry triggers clear, then re-login saves new token
    invalidatedHandler?.();
    // Allow clearCredentials to drain through the module queue.
    await vi.waitFor(() =>
      expect(store.clear).toHaveBeenCalledWith("wechat-1"),
    );

    // Channel is still active (teardownStarted is false)
    // Re-login should succeed in saving via the serialized module queue.
    loginHandler?.({ id: "re-auth-user", token: "re-auth-token" });
    await vi.waitFor(() =>
      expect(store.save).toHaveBeenCalledWith("wechat-1", "re-auth-token"),
    );
  });
});
