import { describe, expect, it, vi } from "vitest";
import {
  SlackRuntimeChannel,
  splitSlackText,
  verifySlackSignature,
} from "../slack-runtime-channel";
import type { SlackWebClientLike } from "../slack-runtime-channel";
import type { OutboundMessage } from "../../../runtime/contracts";
import * as crypto from "crypto";

function makeClient(
  overrides: Partial<SlackWebClientLike> = {},
): SlackWebClientLike {
  return {
    chat: {
      postMessage: vi.fn(async () => ({ ts: "1234.5678", channel: "C01" })),
    },
    auth: {
      test: vi.fn(async () => ({ user_id: "U99" })),
    },
    ...overrides,
  };
}

function makeMessage(
  overrides: Partial<OutboundMessage> = {},
): OutboundMessage {
  return {
    version: 1,
    generation: 1,
    idempotencyKey: "ik-1",
    target: {
      version: 1,
      channelType: "slack",
      channelInstanceId: "slack-1",
      chatId: "C01",
      visibility: "chat",
    },
    text: "hello",
    kind: "reply",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// splitSlackText
// ---------------------------------------------------------------------------
describe("splitSlackText", () => {
  it("returns a single chunk when text is under 4000 chars", () => {
    const parts = splitSlackText("short");
    expect(parts).toEqual(["short"]);
  });

  it("splits at exactly 4000 chars", () => {
    const parts = splitSlackText("a".repeat(4001));
    expect(parts).toHaveLength(2);
    expect(parts[0]).toHaveLength(4000);
    expect(parts[1]).toHaveLength(1);
  });

  it("handles empty string", () => {
    expect(splitSlackText("")).toEqual([""]);
  });
});

// ---------------------------------------------------------------------------
// verifySlackSignature – deterministic helper
// ---------------------------------------------------------------------------
describe("verifySlackSignature", () => {
  const SECRET = "test-secret";
  const BODY = '{"type":"test"}';

  function makeSignature(timestamp: string): string {
    const sigBase = `v0:${timestamp}:${BODY}`;
    return `v0=${crypto.createHmac("sha256", SECRET).update(sigBase).digest("hex")}`;
  }

  it("accepts a valid signature", () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = makeSignature(ts);
    expect(verifySlackSignature(BODY, ts, sig, SECRET)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = makeSignature(ts);
    expect(verifySlackSignature('{"type":"evil"}', ts, sig, SECRET)).toBe(
      false,
    );
  });

  it("rejects expired timestamps", () => {
    const ts = String(Math.floor(Date.now() / 1000) - 600);
    const sig = makeSignature(ts);
    expect(verifySlackSignature(BODY, ts, sig, SECRET)).toBe(false);
  });

  it("rejects future timestamps beyond tolerance", () => {
    const ts = String(Math.floor(Date.now() / 1000) + 600);
    const sig = makeSignature(ts);
    expect(verifySlackSignature(BODY, ts, sig, SECRET)).toBe(false);
  });

  it("rejects missing signing secret", () => {
    const ts = String(Math.floor(Date.now() / 1000));
    expect(verifySlackSignature(BODY, ts, "v0=abc", "")).toBe(false);
  });

  it("rejects missing timestamp", () => {
    expect(verifySlackSignature(BODY, "", "v0=abc", SECRET)).toBe(false);
  });

  it("rejects missing signature", () => {
    const ts = String(Math.floor(Date.now() / 1000));
    expect(verifySlackSignature(BODY, ts, "", SECRET)).toBe(false);
  });

  it("accepts within custom tolerance", () => {
    const ts = String(Math.floor(Date.now() / 1000) - 500);
    const sig = makeSignature(ts);
    expect(verifySlackSignature(BODY, ts, sig, SECRET, 600)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SlackRuntimeChannel contract
// ---------------------------------------------------------------------------
describe("SlackRuntimeChannel", () => {
  // --- lifecycle ---
  it("starts disconnected", () => {
    const ch = new SlackRuntimeChannel(
      {
        channelType: "slack",
        channelInstanceId: "slack-1",
        agentId: "agent-1",
        settings: {},
      },
      1,
      makeClient(),
    );
    expect(ch.connected).toBe(false);
  });

  it("connect fetches bot identity and reports connected", async () => {
    const client = makeClient();
    const ch = new SlackRuntimeChannel(
      {
        channelType: "slack",
        channelInstanceId: "slack-1",
        agentId: "agent-1",
        settings: {},
      },
      1,
      client,
    );
    const statusHandler = vi.fn();
    ch.onStatus(statusHandler);

    await ch.connect();

    expect(client.auth.test).toHaveBeenCalled();
    expect(ch.connected).toBe(true);
    expect(statusHandler).toHaveBeenCalledWith(
      expect.objectContaining({ state: "connected" }),
    );
  });

  it("starts and stops the injected Socket Mode event source", async () => {
    let handler: ((event: Record<string, unknown>) => void) | undefined;
    const source = {
      start: vi.fn(async (next: (event: Record<string, unknown>) => void) => {
        handler = next;
      }),
      stop: vi.fn(async () => undefined),
    };
    const ch = new SlackRuntimeChannel(
      {
        channelType: "slack",
        channelInstanceId: "slack-1",
        agentId: "agent-1",
        settings: {},
      },
      1,
      makeClient(),
      source,
    );
    const messageHandler = vi.fn();
    ch.onMessage(messageHandler);

    await ch.connect();
    handler?.({
      type: "message",
      user: "U1",
      channel: "D1",
      ts: "123.456",
      text: "hello",
    });
    await ch.disconnect();

    expect(source.start).toHaveBeenCalledOnce();
    expect(source.stop).toHaveBeenCalledOnce();
    expect(messageHandler).toHaveBeenCalledWith(
      expect.objectContaining({ chatKind: "dm", text: "hello" }),
    );
  });

  it("disconnect reports stopped", async () => {
    const ch = new SlackRuntimeChannel(
      {
        channelType: "slack",
        channelInstanceId: "slack-1",
        agentId: "agent-1",
        settings: {},
      },
      1,
      makeClient(),
    );
    const statusHandler = vi.fn();
    ch.onStatus(statusHandler);
    await ch.connect();

    await ch.disconnect();
    expect(ch.connected).toBe(false);
    expect(statusHandler).toHaveBeenLastCalledWith(
      expect.objectContaining({ state: "stopped" }),
    );
  });

  // --- message handler subscription ---
  it("onMessage returns an unsubscribe function", () => {
    const ch = new SlackRuntimeChannel(
      {
        channelType: "slack",
        channelInstanceId: "slack-1",
        agentId: "agent-1",
        settings: {},
      },
      1,
      makeClient(),
    );
    const unsub = ch.onMessage(() => undefined);
    expect(unsub).toBeTypeOf("function");
    unsub(); // does not throw
  });

  it("all handler subscriptions return unsubscribe", () => {
    const ch = new SlackRuntimeChannel(
      {
        channelType: "slack",
        channelInstanceId: "slack-1",
        agentId: "agent-1",
        settings: {},
      },
      1,
      makeClient(),
    );
    expect(ch.onMessage(() => undefined)).toBeTypeOf("function");
    expect(ch.onCommand(() => undefined)).toBeTypeOf("function");
    expect(ch.onInteraction(() => undefined)).toBeTypeOf("function");
    expect(ch.onStatus(() => undefined)).toBeTypeOf("function");
    expect(ch.onError(() => undefined)).toBeTypeOf("function");
  });

  // --- bot message rejection ---
  it("rejects events with bot_id", () => {
    const ch = new SlackRuntimeChannel(
      {
        channelType: "slack",
        channelInstanceId: "slack-1",
        agentId: "agent-1",
        settings: {},
      },
      1,
      makeClient(),
    );
    const handler = vi.fn();
    ch.onMessage(handler);

    ch.handleSlackEvent({
      type: "message",
      user: "U1",
      text: "hello from bot",
      channel: "C01",
      ts: "1000.0001",
      bot_id: "B99",
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it("rejects events with bot_message subtype", () => {
    const ch = new SlackRuntimeChannel(
      {
        channelType: "slack",
        channelInstanceId: "slack-1",
        agentId: "agent-1",
        settings: {},
      },
      1,
      makeClient(),
    );
    const handler = vi.fn();
    ch.onMessage(handler);

    ch.handleSlackEvent({
      type: "message",
      user: "U1",
      text: "bot message subtype",
      channel: "C01",
      ts: "1000.0002",
      subtype: "bot_message",
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it("rejects messages from the bot user itself", async () => {
    const client = makeClient({
      auth: { test: vi.fn(async () => ({ user_id: "U99" })) },
    });
    const ch = new SlackRuntimeChannel(
      {
        channelType: "slack",
        channelInstanceId: "slack-1",
        agentId: "agent-1",
        settings: {},
      },
      1,
      client,
    );
    await ch.connect();
    const handler = vi.fn();
    ch.onMessage(handler);

    ch.handleSlackEvent({
      type: "message",
      user: "U99",
      text: "my own message",
      channel: "C01",
      ts: "1000.0003",
    });

    expect(handler).not.toHaveBeenCalled();
  });

  // --- message normalization ---
  it("normalizes a Slack channel message to UnifiedMessage", async () => {
    const ch = new SlackRuntimeChannel(
      {
        channelType: "slack",
        channelInstanceId: "slack-1",
        agentId: "agent-1",
        settings: {},
      },
      1,
      makeClient(),
    );
    await ch.connect();
    const handler = vi.fn();
    ch.onMessage(handler);

    ch.handleSlackEvent({
      type: "message",
      user: "U42",
      text: "hello world",
      channel: "C01",
      ts: "1700000000.000001",
    });

    expect(handler).toHaveBeenCalledTimes(1);
    const msg = handler.mock.calls[0][0];
    expect(msg).toMatchObject({
      version: 1,
      generation: 1,
      channelType: "slack",
      channelInstanceId: "slack-1",
      chatId: "C01",
      userId: "U42",
      chatKind: "channel",
      text: "hello world",
    });
    expect(msg.id).toContain("slack-1");
    expect(msg.timestamp).toBe(1700000000000);
  });

  it("normalizes a DM as chatKind 'dm'", async () => {
    const ch = new SlackRuntimeChannel(
      {
        channelType: "slack",
        channelInstanceId: "slack-1",
        agentId: "agent-1",
        settings: {},
      },
      1,
      makeClient(),
    );
    await ch.connect();
    const handler = vi.fn();
    ch.onMessage(handler);

    ch.handleSlackEvent({
      type: "message",
      user: "U42",
      text: "private hello",
      channel: "D99",
      ts: "1700000000.000002",
    });

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ chatKind: "dm", chatId: "D99" }),
    );
  });

  it("includes thread_ts in chatId when present", async () => {
    const ch = new SlackRuntimeChannel(
      {
        channelType: "slack",
        channelInstanceId: "slack-1",
        agentId: "agent-1",
        settings: {},
      },
      1,
      makeClient(),
    );
    await ch.connect();
    const handler = vi.fn();
    ch.onMessage(handler);

    ch.handleSlackEvent({
      type: "message",
      user: "U42",
      text: "threaded",
      channel: "C01",
      ts: "1700000000.000003",
      thread_ts: "1700000000.000000",
    });

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "C01:1700000000.000000",
      }),
    );
  });

  // --- send with idempotency ---
  it("sends a text message via the WebClient", async () => {
    const client = makeClient();
    const ch = new SlackRuntimeChannel(
      {
        channelType: "slack",
        channelInstanceId: "slack-1",
        agentId: "agent-1",
        settings: {},
      },
      1,
      client,
    );

    const result = await ch.send(makeMessage());
    expect(result).toMatchObject({
      outcome: "committed",
      idempotencyKey: "ik-1",
      platformMessageId: "1234.5678",
    });
    expect(client.chat.postMessage).toHaveBeenCalledWith({
      channel: "C01",
      text: "hello",
      thread_ts: undefined,
      mrkdwn: true,
    });
  });

  it("deduplicates by idempotencyKey", async () => {
    const client = makeClient();
    const ch = new SlackRuntimeChannel(
      {
        channelType: "slack",
        channelInstanceId: "slack-1",
        agentId: "agent-1",
        settings: {},
      },
      1,
      client,
    );

    const msg = makeMessage({ idempotencyKey: "dup-1" });
    const r1 = await ch.send(msg);
    const r2 = await ch.send(msg);

    expect(r2).toBe(r1); // same object reference
    expect(client.chat.postMessage).toHaveBeenCalledTimes(1);
  });

  it("splits long messages at 4000 chars", async () => {
    const client = makeClient();
    const ch = new SlackRuntimeChannel(
      {
        channelType: "slack",
        channelInstanceId: "slack-1",
        agentId: "agent-1",
        settings: {},
      },
      1,
      client,
    );

    const longText = "x".repeat(7500);
    const result = await ch.send(makeMessage({ text: longText }));

    expect(result.outcome).toBe("committed");
    expect(client.chat.postMessage).toHaveBeenCalledTimes(2); // 4000 + 3500
    const calls = (client.chat.postMessage as ReturnType<typeof vi.fn>).mock
      .calls;
    expect(calls[0][0].text).toHaveLength(4000);
    expect(calls[1][0].text).toHaveLength(3500);
  });

  it("returns PRIVATE_DELIVERY_UNSUPPORTED for private target without calling platform", async () => {
    const client = makeClient();
    const ch = new SlackRuntimeChannel(
      {
        channelType: "slack",
        channelInstanceId: "slack-1",
        agentId: "agent-1",
        settings: {},
      },
      1,
      client,
    );

    const result = await ch.send(
      makeMessage({
        target: {
          version: 1,
          channelType: "slack",
          channelInstanceId: "slack-1",
          chatId: "C01",
          visibility: "private",
          userId: "U99",
        },
        idempotencyKey: "private-key",
      }),
    );

    expect(result.accepted).toBe(false);
    expect(result.outcome).toBe("permanent_failure");
    expect(result.errorCode).toBe("PRIVATE_DELIVERY_UNSUPPORTED");
    expect(client.chat.postMessage).not.toHaveBeenCalled();
  });

  it("returns failure for empty message", async () => {
    const ch = new SlackRuntimeChannel(
      {
        channelType: "slack",
        channelInstanceId: "slack-1",
        agentId: "agent-1",
        settings: {},
      },
      1,
      makeClient(),
    );

    const result = await ch.send(makeMessage({ text: "", markdown: "" }));
    expect(result).toMatchObject({
      accepted: false,
      outcome: "permanent_failure",
      errorCode: "SLACK_EMPTY_MESSAGE",
    });
  });

  // --- thread parsing ---
  it("parses thread_ts from chattId when sending", async () => {
    const client = makeClient();
    const ch = new SlackRuntimeChannel(
      {
        channelType: "slack",
        channelInstanceId: "slack-1",
        agentId: "agent-1",
        settings: {},
      },
      1,
      client,
    );

    await ch.send(
      makeMessage({
        target: {
          version: 1,
          channelType: "slack",
          channelInstanceId: "slack-1",
          chatId: "C01:1700000000.000000",
          visibility: "chat",
        },
      }),
    );

    expect(client.chat.postMessage).toHaveBeenCalledWith({
      channel: "C01",
      text: "hello",
      thread_ts: "1700000000.000000",
      mrkdwn: true,
    });
  });

  // --- streamUpdate delegates to send ---
  it("streamUpdate delegates to send", async () => {
    const client = makeClient();
    const ch = new SlackRuntimeChannel(
      {
        channelType: "slack",
        channelInstanceId: "slack-1",
        agentId: "agent-1",
        settings: {},
      },
      1,
      client,
    );

    const result = await ch.streamUpdate!(
      {
        version: 1,
        channelType: "slack",
        channelInstanceId: "slack-1",
        chatId: "C01",
        visibility: "chat",
      },
      {
        version: 1,
        generation: 1,
        streamId: "s1",
        sequence: 1,
        target: {
          version: 1,
          channelType: "slack",
          channelInstanceId: "slack-1",
          chatId: "C01",
          visibility: "chat",
        },
        fullText: "streaming update",
        idempotencyKey: "stream-ik-1",
        isFinal: false,
      },
    );

    expect(result).toMatchObject({
      outcome: "committed",
      idempotencyKey: "stream-ik-1",
    });
    expect(client.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: "streaming update" }),
    );
  });
});
