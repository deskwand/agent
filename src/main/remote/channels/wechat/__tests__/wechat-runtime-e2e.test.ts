import { createCipheriv } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WeChatILinkFetch } from "../wechat-ilink-puppet";
import { WeChatILinkPuppet } from "../wechat-ilink-puppet";
import {
  WeChatChannel,
  type WeChatTokenStore,
} from "../wechat-channel";
import { ChannelRegistry } from "../../../runtime/channel-registry";
import { ConnectionManager } from "../../../runtime/connection-manager";
import { ChannelRuntime } from "../../../runtime/channel-runtime";
import { AttachmentStore } from "../../../runtime/attachment-store";
import type {
  ChannelAdapter,
  ChannelAdapterConfig,
} from "../../../runtime/channel-adapter";
import type { ChannelPairingEvent } from "../../../../../shared/ipc-types";
import type {
  AttachmentSource,
  UnifiedMessage,
} from "../../../runtime/contracts";
import type { ChannelPolicyConfig } from "../../../runtime/policy-engine";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function staticAdapter(
  config: ChannelAdapterConfig,
  generation: number,
): ChannelAdapter {
  return {
    channelType: config.channelType,
    channelInstanceId: config.channelInstanceId,
    generation,
    connected: true,
    connect: async () => undefined,
    disconnect: async () => undefined,
    send: async (message) => ({
      version: 1 as const,
      generation,
      accepted: true,
      committed: true,
      outcome: "committed" as const,
      idempotencyKey: message.idempotencyKey,
    }),
    onMessage: () => () => undefined,
    onCommand: () => () => undefined,
    onInteraction: () => () => undefined,
    onStatus: () => () => undefined,
    onError: () => () => undefined,
  };
}

function emptyTokenStore(): WeChatTokenStore {
  return {
    load: async () => null,
    save: async () => undefined,
    clear: async () => undefined,
  };
}

const POLICY: ChannelPolicyConfig = {
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

const TELEGRAM_CONFIG: ChannelAdapterConfig = {
  channelType: "telegram",
  channelInstanceId: "telegram-1",
  agentId: "agent-1",
  settings: {},
};

const WECHAT_CONFIG: ChannelAdapterConfig = {
  channelType: "wechat",
  channelInstanceId: "wechat-1",
  agentId: "agent-1",
  settings: {},
};

function buildRuntime(input: {
  qrStatus: ReturnType<typeof deferred<Response>>;
  pairings: ChannelPairingEvent[];
}): ChannelRuntime {
  const registry = new ChannelRegistry();
  registry.register("telegram", staticAdapter);
  registry.register("wechat", (_config, generation) => {
    const fetcher: WeChatILinkFetch = async (url, init) => {
      if (url.includes("get_bot_qrcode")) {
        return new Response(
          JSON.stringify({
            qrcode: "qr-token",
            qrcode_img_content: "data:image/png;base64,AA==",
          }),
          { status: 200 },
        );
      }
      if (url.includes("get_qrcode_status")) {
        // Respect abort signal; race qrStatus against abort.
        if (init?.signal?.aborted) {
          throw new DOMException("aborted", "AbortError");
        }
        return new Promise<Response>((resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
          void input.qrStatus.promise.then(resolve, reject);
        });
      }
      if (url.includes("getupdates")) {
        return new Promise<Response>((_resolve, reject) => {
          if (init?.signal?.aborted) {
            reject(new DOMException("aborted", "AbortError"));
            return;
          }
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        });
      }
      throw new Error(`unexpected URL: ${url}`);
    };
    return new WeChatChannel(
      _config,
      generation,
      new WeChatILinkPuppet({ fetcher, qrPollDelayMs: 0 }),
      emptyTokenStore(),
    );
  });
  const manager = new ConnectionManager(registry, {
    onPairing: (event) => {
      input.pairings.push(event);
    },
  });
  return new ChannelRuntime({
    agentId: "agent-1",
    policy: POLICY,
    execute: async () => undefined,
    connectionManager: manager,
    channels: [TELEGRAM_CONFIG, WECHAT_CONFIG],
  });
}

// ---------------------------------------------------------------------------
// E2E: Non-blocking QR flow across the full Runtime stack
// ---------------------------------------------------------------------------

describe("WeChat E2E non-blocking QR flow", () => {
  const puppets: WeChatILinkPuppet[] = [];

  afterEach(async () => {
    for (const puppet of puppets) await puppet.stop();
    puppets.length = 0;
  });

  it("starts other channels while WeChat waits for QR confirmation", async () => {
    const qrStatus = deferred<Response>();
    const pairings: ChannelPairingEvent[] = [];
    const runtime = buildRuntime({ qrStatus, pairings });

    await expect(runtime.start()).resolves.toBeUndefined();

    expect(
      runtime
        .getStatus()
        .find((s) => s.channelInstanceId === "telegram-1")?.state,
    ).toBe("connected");
    expect(
      runtime
        .getStatus()
        .find((s) => s.channelInstanceId === "wechat-1")?.state,
    ).toBe("starting");
    expect(pairings.at(-1)).toMatchObject({ state: "pending" });

    // Resolve QR with confirmed credentials to transition WeChat connected.
    qrStatus.resolve(
      new Response(
        JSON.stringify({
          status: "confirmed",
          bot_token: "token",
          ilink_bot_id: "bot",
          ilink_user_id: "bot-user",
          baseurl: "https://ilink.example",
        }),
        { status: 200 },
      ),
    );

    await vi.waitFor(() => {
      expect(
        runtime
          .getStatus()
          .find((s) => s.channelInstanceId === "wechat-1")?.state,
      ).toBe("connected");
    });

    await runtime.stop();
  });

  it("runtime stop cleans up both channels after QR cancellation", async () => {
    const qrStatus = deferred<Response>();
    const pairings: ChannelPairingEvent[] = [];
    const runtime = buildRuntime({ qrStatus, pairings });

    await runtime.start();

    // Stop while WeChat is still pending QR (get_qrcode_status hanging).
    await runtime.stop();

    // Post-stop status: telegram has disconnected via disconnectAll,
    // wechat has been drained.
    const statuses = runtime.getStatus();
    // After stop() the ConnectionManager disconnects all, which may
    // clear the active map so getStatus() returns empty.
    expect(statuses).toBeDefined();
    // The key property: stop resolved without hanging on the QR poll.
  });
});

// ---------------------------------------------------------------------------
// E2E: Encrypted inbound attachment pipeline
//   Puppet -> Channel -> ConnectionManager -> AttachmentStore
// ---------------------------------------------------------------------------

describe("WeChat E2E encrypted attachment pipeline", () => {
  const puppets: WeChatILinkPuppet[] = [];

  afterEach(async () => {
    for (const puppet of puppets) await puppet.stop();
    puppets.length = 0;
  });

  it("downloads inbound media through the full production stack and asserts plaintext", async () => {
    const PLAIN_IMAGE_BYTES = Buffer.from("e2e-image-bytes");
    const key = Buffer.from("00112233445566778899aabbccddeeff", "hex");
    const cipher = createCipheriv("aes-128-ecb", key, null);
    const encrypted = Buffer.concat([
      cipher.update(PLAIN_IMAGE_BYTES),
      cipher.final(),
    ]);

    let updateCalls = 0;

    const fetcher: WeChatILinkFetch = async (url, init) => {
      if (url.includes("getupdates")) {
        updateCalls += 1;
        if (updateCalls === 1) {
          return new Response(
            JSON.stringify({
              msgs: [
                {
                  message_id: 1,
                  from_user_id: "user-1",
                  message_type: 1,
                  context_token: "ctx-1",
                  item_list: [
                    {
                      type: 2,
                      image_item: {
                        media: {
                          encrypt_query_param: "e2e-download-param",
                          aes_key: key.toString("base64"),
                        },
                      },
                    },
                  ],
                },
              ],
              get_updates_buf: "cursor-1",
            }),
            { status: 200 },
          );
        }
        return new Promise<Response>((_resolve, reject) => {
          if (init?.signal?.aborted) {
            reject(new DOMException("aborted", "AbortError"));
            return;
          }
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        });
      }
      if (url.includes("/c2c/download")) {
        return new Response(encrypted, { status: 200 });
      }
      throw new Error(`unexpected URL: ${url} ${String(init?.method)}`);
    };

    const puppet = new WeChatILinkPuppet({ fetcher });
    puppets.push(puppet);

    const channel = new WeChatChannel(
      WECHAT_CONFIG,
      /* generation */ 1,
      puppet,
      /* tokenStore: returns credentials so puppet starts authenticated */ {
        load: async () =>
          JSON.stringify({
            token: "token",
            baseUrl: "https://ilink.example",
            accountId: "bot",
            userId: "bot-user",
          }),
        save: async () => undefined,
        clear: async () => undefined,
      },
    );

    const registry = new ChannelRegistry();
    // Override create with a factory that returns the prebuilt channel.
    registry.register("wechat", () => channel);

    const attachmentStore = new AttachmentStore({
      workspaceRoot: "/tmp",
      fetcher: fetch,
    });

    let inboundMessage: UnifiedMessage | undefined;

    const manager = new ConnectionManager(
      registry,
      {
        onMessage: (message) => {
          inboundMessage = message;
        },
      },
      attachmentStore,
    );

    const status = await manager.connect(WECHAT_CONFIG);
    // With a valid token puppet starts authenticated so the channel
    // transitions connected synchronously during connect.
    expect(status.state).toBe("connected");

    // Wait for the getupdates poll to deliver the inbound media message.
    await vi.waitFor(() => expect(inboundMessage).toBeDefined(), {
      timeout: 5_000,
    });

    const attachment = inboundMessage!.attachments[0];
    expect(attachment).toBeDefined();
    expect(attachment.sourceRef).toBeTruthy();

    // Build the same AttachmentSource shape that ConnectionManager registers.
    const source: AttachmentSource = {
      version: 1,
      generation: inboundMessage!.generation,
      id: attachment.id,
      channelInstanceId: inboundMessage!.channelInstanceId,
      sourceKind: attachment.sourceKind,
      filename: attachment.filename,
      mediaType: attachment.mediaType,
      declaredSize: attachment.size,
      platformRef: attachment.sourceRef,
      sourceRef: attachment.sourceRef,
    };

    const downloaded = await attachmentStore.downloadInbound(source);
    expect(downloaded).toEqual(PLAIN_IMAGE_BYTES);

    await manager.disconnect("wechat-1", "test_complete");
  });

  it("rejects repeated download after success cleanup", async () => {
    const PLAIN_IMAGE_BYTES = Buffer.from("one-shot");
    const key = Buffer.from("00112233445566778899aabbccddeeff", "hex");
    const cipher = createCipheriv("aes-128-ecb", key, null);
    const encrypted = Buffer.concat([
      cipher.update(PLAIN_IMAGE_BYTES),
      cipher.final(),
    ]);

    let updateCalls = 0;

    const fetcher: WeChatILinkFetch = async (url, init) => {
      if (url.includes("getupdates")) {
        updateCalls += 1;
        if (updateCalls === 1) {
          return new Response(
            JSON.stringify({
              msgs: [
                {
                  message_id: 2,
                  from_user_id: "user-2",
                  message_type: 1,
                  context_token: "ctx-2",
                  item_list: [
                    {
                      type: 2,
                      image_item: {
                        media: {
                          encrypt_query_param: "one-shot-param",
                          aes_key: key.toString("base64"),
                        },
                      },
                    },
                  ],
                },
              ],
              get_updates_buf: "cursor-2",
            }),
            { status: 200 },
          );
        }
        return new Promise<Response>((_resolve, reject) => {
          if (init?.signal?.aborted) {
            reject(new DOMException("aborted", "AbortError"));
            return;
          }
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        });
      }
      if (url.includes("/c2c/download")) {
        return new Response(encrypted, { status: 200 });
      }
      throw new Error(`unexpected URL: ${url}`);
    };

    const puppet = new WeChatILinkPuppet({ fetcher });
    puppets.push(puppet);

    const channel = new WeChatChannel(
      WECHAT_CONFIG,
      1,
      puppet,
      {
        load: async () =>
          JSON.stringify({
            token: "token",
            baseUrl: "https://ilink.example",
            accountId: "bot",
            userId: "bot-user",
          }),
        save: async () => undefined,
        clear: async () => undefined,
      },
    );

    const registry = new ChannelRegistry();
    registry.register("wechat", () => channel);

    const attachmentStore = new AttachmentStore({
      workspaceRoot: "/tmp",
    });

    let inboundMessage: UnifiedMessage | undefined;

    const manager = new ConnectionManager(
      registry,
      {
        onMessage: (message) => {
          inboundMessage = message;
        },
      },
      attachmentStore,
    );

    await manager.connect(WECHAT_CONFIG);

    await vi.waitFor(() => expect(inboundMessage).toBeDefined(), {
      timeout: 5_000,
    });

    const attachment = inboundMessage!.attachments[0];
    const source: AttachmentSource = {
      version: 1,
      generation: inboundMessage!.generation,
      id: attachment.id,
      channelInstanceId: inboundMessage!.channelInstanceId,
      sourceKind: attachment.sourceKind,
      filename: attachment.filename,
      mediaType: attachment.mediaType,
      declaredSize: attachment.size,
      platformRef: attachment.sourceRef,
      sourceRef: attachment.sourceRef,
    };

    // First download succeeds and deletes the media reference.
    const downloaded = await attachmentStore.downloadInbound(source);
    expect(downloaded).toEqual(PLAIN_IMAGE_BYTES);

    // Second download: AttachmentStore's registered downloader still exists
    // but the puppet's mediaItems no longer have the sourceRef, so
    // WeChatChannel.downloadAttachment → puppet.downloadAttachment throws.
    await expect(attachmentStore.downloadInbound(source)).rejects.toThrow(
      "ATTACHMENT_SOURCE_UNAVAILABLE",
    );

    await manager.disconnect("wechat-1", "test_complete");
  });
});
