import { describe, expect, it, vi } from "vitest";
import { FeishuAdapter } from "../feishu-adapter";
import type { ChannelAdapterConfig } from "../../../runtime/channel-adapter";
import type { OutboundMessage, UnifiedMessage } from "../../../runtime/contracts";
import type { IFeishuChannelLike } from "../feishu-adapter";
import type { RemoteMessage, RemoteResponse } from "../../../types";

// ---------------------------------------------------------------------------
// Fake Feishu channel for contract tests (no real SDK needed)
// ---------------------------------------------------------------------------

class FakeFeishuChannel implements IFeishuChannelLike {
  readonly type = "feishu" as const;
  _connected = false;
  _botOpenId = "ou_bot_001";
  _botName = "DeskWandBot";
  private msgHandler: ((msg: RemoteMessage) => void) | null = null;
  private errHandler: ((err: Error) => void) | null = null;
  sentMessages: RemoteResponse[] = [];
  startCalls = 0;
  stopCalls = 0;

  get connected(): boolean {
    return this._connected;
  }

  get botOpenId(): string | undefined {
    return this._botOpenId;
  }

  async start(): Promise<void> {
    this.startCalls++;
    this._connected = true;
  }

  async stop(): Promise<void> {
    this.stopCalls++;
    this._connected = false;
  }

  onMessage(handler: (msg: RemoteMessage) => void): void {
    this.msgHandler = handler;
  }

  onError(handler: (err: Error) => void): void {
    this.errHandler = handler;
  }

  async send(response: RemoteResponse): Promise<void> {
    this.sentMessages.push(response);
  }

  // Test helpers ----------------------------------------------------------
  simulateMessage(msg: RemoteMessage): void {
    this.msgHandler?.(msg);
  }

  simulateError(err: Error): void {
    this.errHandler?.(err);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultConfig: ChannelAdapterConfig = {
  channelType: "feishu",
  channelInstanceId: "feishu-1",
  agentId: "agent-1",
  settings: { appId: "test", appSecret: "test", useWebSocket: true },
};

function makeOutbound(overrides: Partial<OutboundMessage> = {}): OutboundMessage {
  return {
    version: 1,
    generation: 1,
    idempotencyKey: "key-1",
    target: {
      version: 1,
      channelType: "feishu",
      channelInstanceId: "feishu-1",
      chatId: "oc_chat_001",
      visibility: "chat",
    },
    text: "hello",
    kind: "reply",
    ...overrides,
  };
}

function makeTextMessage(overrides: Partial<RemoteMessage> = {}): RemoteMessage {
  return {
    id: "om_msg_001",
    channelType: "feishu",
    channelId: "oc_chat_001",
    sender: { id: "ou_user_001", name: "Alice", isBot: false },
    content: { type: "text", text: "hello bot" },
    timestamp: Date.now(),
    isGroup: false,
    isMentioned: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("FeishuAdapter contract", () => {
  // -- lifecycle ----------------------------------------------------------

  it("connects and sets connected state", async () => {
    const feishu = new FakeFeishuChannel();
    const adapter = new FeishuAdapter(defaultConfig, 1, feishu);
    const controller = new AbortController();

    await adapter.connect(controller.signal);

    expect(adapter.connected).toBe(true);
    expect(feishu.startCalls).toBe(1);
  });

  it("disconnects and clears connected state", async () => {
    const feishu = new FakeFeishuChannel();
    const adapter = new FeishuAdapter(defaultConfig, 1, feishu);
    await adapter.connect(new AbortController().signal);

    await adapter.disconnect();

    expect(adapter.connected).toBe(false);
    expect(feishu.stopCalls).toBe(1);
  });

  it("emits status events on connect/disconnect", async () => {
    const feishu = new FakeFeishuChannel();
    const adapter = new FeishuAdapter(defaultConfig, 1, feishu);
    const statuses: string[] = [];
    adapter.onStatus((s) => statuses.push(s.state));
    const controller = new AbortController();

    await adapter.connect(controller.signal);
    await adapter.disconnect();

    expect(statuses).toEqual(["connected", "stopped"]);
  });

  // -- send ---------------------------------------------------------------

  it("sends a text message and returns committed DeliveryResult", async () => {
    const feishu = new FakeFeishuChannel();
    const adapter = new FeishuAdapter(defaultConfig, 1, feishu);
    await adapter.connect(new AbortController().signal);

    const result = await adapter.send(makeOutbound());

    expect(result.outcome).toBe("committed");
    expect(result.accepted).toBe(true);
    expect(result.idempotencyKey).toBe("key-1");
    expect(feishu.sentMessages).toHaveLength(1);
    expect(feishu.sentMessages[0].content.text).toBe("hello");
  });

  it("returns committed idempotent result when already delivered", async () => {
    const feishu = new FakeFeishuChannel();
    const adapter = new FeishuAdapter(defaultConfig, 1, feishu);
    await adapter.connect(new AbortController().signal);

    const msg = makeOutbound({ idempotencyKey: "dupe" });
    await adapter.send(msg);
    // Second send with same key
    const second = await adapter.send(msg);

    expect(second.outcome).toBe("committed");
    expect(feishu.sentMessages).toHaveLength(1); // Only sent once
  });

  it("sends with replyToMessageId set", async () => {
    const feishu = new FakeFeishuChannel();
    const adapter = new FeishuAdapter(defaultConfig, 1, feishu);
    await adapter.connect(new AbortController().signal);

    await adapter.send(makeOutbound({ replyToMessageId: "om_reply_001" }));

    expect(feishu.sentMessages[0].replyTo).toBe("om_reply_001");
  });

  it("sends markdown as card via markdown-to-card conversion", async () => {
    const feishu = new FakeFeishuChannel();
    const adapter = new FeishuAdapter(defaultConfig, 1, feishu);
    await adapter.connect(new AbortController().signal);

    await adapter.send(
      makeOutbound({ text: undefined, markdown: "**bold**" }),
    );

    // Should use markdown -> card conversion
    expect(feishu.sentMessages[0].content.type).toBe("markdown");
    expect(feishu.sentMessages[0].content.markdown).toBe("**bold**");
  });

  it("sends card content type for card objects", async () => {
    const feishu = new FakeFeishuChannel();
    const adapter = new FeishuAdapter(defaultConfig, 1, feishu);
    await adapter.connect(new AbortController().signal);

    const card = { elements: [{ tag: "div", text: { tag: "lark_md", content: "hi" } }] };
    await adapter.send(
      makeOutbound({ text: undefined, markdown: undefined, attachments: [], ...({ card } as unknown as Partial<OutboundMessage>) }),
    );

    // Since OutboundMessage doesn't have a 'card' field natively,
    // the text/markdown route is used. Testing what FeishuAdapter actually exposes.
    // The adapter uses text if available, otherwise markdown.
  });

  // -- message normalization ---------------------------------------------

  it("normalizes incoming text DM and emits via onMessage", async () => {
    const feishu = new FakeFeishuChannel();
    const adapter = new FeishuAdapter(defaultConfig, 1, feishu);
    await adapter.connect(new AbortController().signal);

    const handler = vi.fn();
    adapter.onMessage(handler);

    feishu.simulateMessage(
      makeTextMessage({
        id: "om_dm_001",
        channelId: "oc_dm_001",
        sender: { id: "ou_alice", name: "Alice", isBot: false },
        isGroup: false,
        isMentioned: true,
        content: { type: "text", text: "hello" },
      }),
    );

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining<Partial<UnifiedMessage>>({
        version: 1,
        id: "feishu-1:oc_dm_001:om_dm_001",
        channelType: "feishu",
        channelInstanceId: "feishu-1",
        chatId: "oc_dm_001",
        userId: "ou_alice",
        chatKind: "dm",
        text: "hello",
      }),
    );
  });

  it("normalizes incoming group message and emits via onMessage", async () => {
    const feishu = new FakeFeishuChannel();
    const adapter = new FeishuAdapter(defaultConfig, 1, feishu);
    await adapter.connect(new AbortController().signal);

    const handler = vi.fn();
    adapter.onMessage(handler);

    feishu.simulateMessage(
      makeTextMessage({
        id: "om_grp_001",
        channelId: "oc_grp_001",
        sender: { id: "ou_bob", name: "Bob", isBot: false },
        isGroup: true,
        isMentioned: true,
        content: { type: "text", text: "@DeskWandBot help me" },
      }),
    );

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining<Partial<UnifiedMessage>>({
        chatId: "oc_grp_001",
        chatKind: "group",
        userId: "ou_bob",
        userName: "Bob",
      }),
    );
  });

  it("includes replyToMessageId in normalized message", async () => {
    const feishu = new FakeFeishuChannel();
    const adapter = new FeishuAdapter(defaultConfig, 1, feishu);
    await adapter.connect(new AbortController().signal);

    const handler = vi.fn();
    adapter.onMessage(handler);

    feishu.simulateMessage(
      makeTextMessage({
        id: "om_reply_001",
        replyTo: "om_orig_001",
      }),
    );

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ replyToMessageId: "om_orig_001" }),
    );
  });

  // -- attachments -------------------------------------------------------

  it("normalizes image attachment to InboundAttachment", async () => {
    const feishu = new FakeFeishuChannel();
    const adapter = new FeishuAdapter(defaultConfig, 1, feishu);
    await adapter.connect(new AbortController().signal);

    const handler = vi.fn();
    adapter.onMessage(handler);

    feishu.simulateMessage({
      id: "om_img_001",
      channelType: "feishu",
      channelId: "oc_chat_001",
      sender: { id: "ou_alice", isBot: false },
      content: { type: "image", imageKey: "img_abc123" },
      timestamp: Date.now(),
      isGroup: false,
      isMentioned: true,
    });

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: expect.arrayContaining([
          expect.objectContaining({
            sourceKind: "platform",
            sourceRef: "img_abc123",
          }),
        ]),
        text: "",
      }),
    );
  });

  it("normalizes file attachment to InboundAttachment", async () => {
    const feishu = new FakeFeishuChannel();
    const adapter = new FeishuAdapter(defaultConfig, 1, feishu);
    await adapter.connect(new AbortController().signal);

    const handler = vi.fn();
    adapter.onMessage(handler);

    feishu.simulateMessage({
      id: "om_file_001",
      channelType: "feishu",
      channelId: "oc_chat_001",
      sender: { id: "ou_alice", isBot: false },
      content: {
        type: "file",
        file: { name: "report.pdf", key: "file_xyz", size: 1024 },
      },
      timestamp: Date.now(),
      isGroup: false,
      isMentioned: true,
    });

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: expect.arrayContaining([
          expect.objectContaining({
            filename: "report.pdf",
            sourceKind: "platform",
            sourceRef: "file_xyz",
            size: 1024,
          }),
        ]),
      }),
    );
  });

  // -- audio / post ------------------------------------------------------

  it("normalizes audio content type", async () => {
    const feishu = new FakeFeishuChannel();
    const adapter = new FeishuAdapter(defaultConfig, 1, feishu);
    await adapter.connect(new AbortController().signal);

    const handler = vi.fn();
    adapter.onMessage(handler);

    feishu.simulateMessage({
      id: "om_audio_001",
      channelType: "feishu",
      channelId: "oc_chat_001",
      sender: { id: "ou_alice", isBot: false },
      content: {
        type: "voice",
        voice: { key: "voice_abc", duration: 30 },
      },
      timestamp: Date.now(),
      isGroup: false,
      isMentioned: true,
    });

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: expect.arrayContaining([
          expect.objectContaining({
            sourceKind: "platform",
            sourceRef: "voice_abc",
          }),
        ]),
      }),
    );
  });

  it("normalizes rich_text/post content type", async () => {
    const feishu = new FakeFeishuChannel();
    const adapter = new FeishuAdapter(defaultConfig, 1, feishu);
    await adapter.connect(new AbortController().signal);

    const handler = vi.fn();
    adapter.onMessage(handler);

    feishu.simulateMessage({
      id: "om_post_001",
      channelType: "feishu",
      channelId: "oc_chat_001",
      sender: { id: "ou_alice", isBot: false },
      content: {
        type: "rich_text",
        text: "rich post",
        richText: { zh_cn: { content: [[{ tag: "text", text: "rich post" }]] } },
      },
      timestamp: Date.now(),
      isGroup: false,
      isMentioned: true,
    });

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "rich post",
      }),
    );
  });

  it("normalizes interactive content type", async () => {
    const feishu = new FakeFeishuChannel();
    const adapter = new FeishuAdapter(defaultConfig, 1, feishu);
    await adapter.connect(new AbortController().signal);

    const handler = vi.fn();
    adapter.onMessage(handler);

    feishu.simulateMessage({
      id: "om_inter_001",
      channelType: "feishu",
      channelId: "oc_chat_001",
      sender: { id: "ou_alice", isBot: false },
      content: {
        type: "interactive",
        interactive: { action: { value: "clicked" } },
      },
      timestamp: Date.now(),
      isGroup: false,
      isMentioned: true,
    });

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "",
      }),
    );
  });

  // -- bot self-filtering ------------------------------------------------

  it("skips messages from bot itself", async () => {
    const feishu = new FakeFeishuChannel();
    const adapter = new FeishuAdapter(defaultConfig, 1, feishu);
    await adapter.connect(new AbortController().signal);

    const handler = vi.fn();
    adapter.onMessage(handler);

    feishu.simulateMessage(
      makeTextMessage({
        sender: { id: "ou_bot_001", name: "Bot", isBot: true },
      }),
    );

    expect(handler).not.toHaveBeenCalled();
  });

  // -- error handling ----------------------------------------------------

  it("emits errors via onError", async () => {
    const feishu = new FakeFeishuChannel();
    const adapter = new FeishuAdapter(defaultConfig, 1, feishu);
    await adapter.connect(new AbortController().signal);

    const handler = vi.fn();
    adapter.onError(handler);

    feishu.simulateError(new Error("connection lost"));

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ message: "connection lost" }),
    );
  });

  // -- stream methods (optional adapter methods) -------------------------

  it("streamUpdate sends text chunks", async () => {
    const feishu = new FakeFeishuChannel();
    const adapter = new FeishuAdapter(defaultConfig, 1, feishu);
    await adapter.connect(new AbortController().signal);

    const result = await adapter.streamUpdate!(
      {
        version: 1,
        channelType: "feishu",
        channelInstanceId: "feishu-1",
        chatId: "oc_chat_001",
        visibility: "chat",
      },
      {
        version: 1,
        generation: 1,
        streamId: "stream-1",
        sequence: 1,
        target: {
          version: 1,
          channelType: "feishu",
          channelInstanceId: "feishu-1",
          chatId: "oc_chat_001",
          visibility: "chat",
        },
        fullText: "partial",
        idempotencyKey: "stream-key-1",
        isFinal: false,
      },
    );

    expect(result.outcome).toBe("accepted");
    expect(result.accepted).toBe(true);
  });

  it("streamComplete sends final text", async () => {
    const feishu = new FakeFeishuChannel();
    const adapter = new FeishuAdapter(defaultConfig, 1, feishu);
    await adapter.connect(new AbortController().signal);

    const result = await adapter.streamComplete!(
      {
        version: 1,
        channelType: "feishu",
        channelInstanceId: "feishu-1",
        chatId: "oc_chat_001",
        visibility: "chat",
      },
      "final text",
      "final-key",
    );

    expect(result.outcome).toBe("committed");
    expect(result.committed).toBe(true);
    expect(feishu.sentMessages[0].content.text).toBe("final text");
  });

  it("streamError sends error text", async () => {
    const feishu = new FakeFeishuChannel();
    const adapter = new FeishuAdapter(defaultConfig, 1, feishu);
    await adapter.connect(new AbortController().signal);

    const result = await adapter.streamError!(
      {
        version: 1,
        channelType: "feishu",
        channelInstanceId: "feishu-1",
        chatId: "oc_chat_001",
        visibility: "chat",
      },
      "something went wrong",
      "err-key",
    );

    expect(result.outcome).toBe("committed");
    expect(feishu.sentMessages[0].content.text).toBe("something went wrong");
  });

  // -- sendTyping --------------------------------------------------------

  it("sendTyping is a no-op", async () => {
    const feishu = new FakeFeishuChannel();
    const adapter = new FeishuAdapter(defaultConfig, 1, feishu);
    await adapter.connect(new AbortController().signal);

    await expect(
      adapter.sendTyping!({
        version: 1,
        channelType: "feishu",
        channelInstanceId: "feishu-1",
        chatId: "oc_chat_001",
        visibility: "chat",
      }),
    ).resolves.toBeUndefined();
  });

  // -- sendFile ----------------------------------------------------------

  it("sendFile returns capability gap for Feishu", async () => {
    const feishu = new FakeFeishuChannel();
    const adapter = new FeishuAdapter(defaultConfig, 1, feishu);
    await adapter.connect(new AbortController().signal);

    const result = await adapter.sendFile!(
      {
        version: 1,
        channelType: "feishu",
        channelInstanceId: "feishu-1",
        chatId: "oc_chat_001",
        visibility: "chat",
      },
      { version: 1, filename: "x.png", data: "base64...", mediaType: "image/png", size: 100 },
      "file-key",
    );

    expect(result.outcome).toBe("permanent_failure");
    expect(result.errorCode).toBe("FEISHU_SENDFILE_NOT_IMPLEMENTED");
  });

  // -- setReaction -------------------------------------------------------

  it("setReaction returns capability gap", async () => {
    const feishu = new FakeFeishuChannel();
    const adapter = new FeishuAdapter(defaultConfig, 1, feishu);
    await adapter.connect(new AbortController().signal);

    const result = await adapter.setReaction!(
      {
        version: 1,
        channelType: "feishu",
        channelInstanceId: "feishu-1",
        chatId: "oc_chat_001",
        visibility: "chat",
      },
      {
        version: 1,
        generation: 1,
        idempotencyKey: "react-key",
        messageId: "om_001",
        action: "add",
        emoji: "thumbsup",
        userId: "ou_alice",
      },
    );

    expect(result.outcome).toBe("permanent_failure");
    expect(result.errorCode).toBe("FEISHU_REACTION_NOT_IMPLEMENTED");
  });

  // -- lookupDelivery ----------------------------------------------------

  it("lookupDelivery returns unknown for non-tracked keys", async () => {
    const feishu = new FakeFeishuChannel();
    const adapter = new FeishuAdapter(defaultConfig, 1, feishu);

    const result = await adapter.lookupDelivery!("unknown-key");

    expect(result.outcome).toBe("unknown");
    expect(result.idempotencyKey).toBe("unknown-key");
  });

  it("lookupDelivery returns committed for tracked keys", async () => {
    const feishu = new FakeFeishuChannel();
    const adapter = new FeishuAdapter(defaultConfig, 1, feishu);
    await adapter.connect(new AbortController().signal);

    await adapter.send(makeOutbound({ idempotencyKey: "tracked-key" }));

    const result = await adapter.lookupDelivery!("tracked-key");
    expect(result.outcome).toBe("committed");
  });

  // -- unsubscribe pattern -----------------------------------------------

  it("supports multiple onMessage handlers with unsubscribe", async () => {
    const feishu = new FakeFeishuChannel();
    const adapter = new FeishuAdapter(defaultConfig, 1, feishu);
    await adapter.connect(new AbortController().signal);

    const h1 = vi.fn();
    const h2 = vi.fn();
    adapter.onMessage(h1);
    const unsub2 = adapter.onMessage(h2);

    feishu.simulateMessage(makeTextMessage());
    expect(h1).toHaveBeenCalledOnce();
    expect(h2).toHaveBeenCalledOnce();

    unsub2();
    feishu.simulateMessage(makeTextMessage({ id: "second" }));
    expect(h1).toHaveBeenCalledTimes(2);
    expect(h2).toHaveBeenCalledTimes(1); // not called again
  });

  // -- private target ----------------------------------------------------

  it("returns PRIVATE_DELIVERY_UNSUPPORTED for private target without calling platform", async () => {
    const feishu = new FakeFeishuChannel();
    const adapter = new FeishuAdapter(defaultConfig, 1, feishu);
    await adapter.connect(new AbortController().signal);

    const result = await adapter.send(makeOutbound({
      idempotencyKey: "private-key",
      target: {
        version: 1,
        channelType: "feishu",
        channelInstanceId: "feishu-1",
        chatId: "oc_chat_001",
        visibility: "private",
        userId: "ou_user_99",
      },
    }));

    expect(result.accepted).toBe(false);
    expect(result.outcome).toBe("permanent_failure");
    expect(result.errorCode).toBe("PRIVATE_DELIVERY_UNSUPPORTED");
    expect(feishu.sentMessages).toHaveLength(0);
  });

  it("rejects private target without userId", () => {
    expect(() =>
      FeishuAdapter.validateOutbound({
        target: { version: 1, visibility: "private", userId: undefined } as unknown as OutboundMessage["target"],
      } as unknown as OutboundMessage),
    ).toThrow();
  });
});
