import { describe, expect, it, vi } from "vitest";
import type { ChannelAdapter, ChannelAdapterConfig } from "../channel-adapter";
import { ChannelRegistry } from "../channel-registry";
import { ConnectionManager } from "../connection-manager";
import type {
  ChannelPairingEvent,
  UnifiedMessage,
} from "../contracts";
import { AttachmentStore } from "../attachment-store";

const config: ChannelAdapterConfig = {
  channelType: "telegram",
  channelInstanceId: "telegram-1",
  agentId: "agent-1",
  settings: {},
};

function message(generation: number): UnifiedMessage {
  return {
    version: 1,
    generation,
    id: `message-${generation}`,
    channelType: "telegram",
    channelInstanceId: "telegram-1",
    chatId: "chat-1",
    userId: "user-1",
    chatKind: "dm",
    text: "hello",
    attachments: [],
    mentions: [],
    timestamp: Date.now(),
  };
}

type TestAdapter = ChannelAdapter & {
  emitMessage(value: UnifiedMessage): void;
  emitPairing(value: ChannelPairingEvent): void;
};

function fakeAdapter(generation: number, connected = true): TestAdapter {
  let messageHandler: ((value: UnifiedMessage) => void) | undefined;
  let pairingHandler: ((value: ChannelPairingEvent) => void) | undefined;
  return {
    channelType: "telegram",
    channelInstanceId: "telegram-1",
    generation,
    get connected() {
      return connected;
    },
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    downloadAttachment: vi.fn(async () => Buffer.from("attachment")),
    send: vi.fn(async (outbound) => ({
      version: 1 as const,
      generation: outbound.generation,
      accepted: true,
      committed: true,
      outcome: "committed" as const,
      idempotencyKey: outbound.idempotencyKey,
    })),
    onMessage: vi.fn((handler) => {
      messageHandler = handler;
      return () => {
        messageHandler = undefined;
      };
    }),
    onPairing: vi.fn((handler) => {
      pairingHandler = handler;
      return () => {
        pairingHandler = undefined;
      };
    }),
    onCommand: () => () => undefined,
    onInteraction: () => () => undefined,
    onStatus: () => () => undefined,
    onError: () => () => undefined,
    emitMessage: (value) => messageHandler?.(value),
    emitPairing: (value) => pairingHandler?.(value),
  };
}

describe("connection manager", () => {
  it("does not let a superseded connect mark the new connection failed", async () => {
    const registry = new ChannelRegistry();
    let releaseFirst: (() => void) | undefined;
    registry.register("telegram", (_c, gen) => {
      const created = fakeAdapter(gen);
      if (gen === 1) {
        created.connect = vi.fn(
          () =>
            new Promise<void>((resolve) => {
              releaseFirst = resolve;
            }),
        );
      }
      return created;
    });
    const manager = new ConnectionManager(registry);

    const first = manager.connect(config);
    await Promise.resolve();
    const second = manager.sync(config);
    await second;
    releaseFirst?.();

    await expect(first).rejects.toThrow("CHANNEL_CONNECTION_SUPERSEDED");
    expect(manager.getStatus("telegram-1")?.generation).toBe(2);
  });

  it("drops events from an older generation", async () => {
    const registry = new ChannelRegistry();
    const adapters: ChannelAdapter[] = [];
    registry.register("telegram", (_c, generation) => {
      const created = fakeAdapter(generation);
      adapters.push(created);
      return created;
    });
    const messages: UnifiedMessage[] = [];
    const manager = new ConnectionManager(registry, {
      onMessage: (value) => messages.push(value),
    });

    await manager.connect(config);
    await manager.sync(config);
    (adapters[0] as TestAdapter).emitMessage(message(1));

    expect(messages).toEqual([]);
  });

  it("preserves starting when connect resolves before interactive login", async () => {
    const registry = new ChannelRegistry();
    registry.register("telegram", (_c, generation) =>
      fakeAdapter(generation, false),
    );
    const manager = new ConnectionManager(registry);
    const status = await manager.connect(config);
    expect(status.state).toBe("starting");
  });

  it("keeps synchronous adapters connected after connect resolves", async () => {
    const registry = new ChannelRegistry();
    registry.register("telegram", (_c, generation) =>
      fakeAdapter(generation, true),
    );
    const manager = new ConnectionManager(registry);
    expect((await manager.connect(config)).state).toBe("connected");
  });

  it("forwards only current-generation pairing events", async () => {
    const registry = new ChannelRegistry();
    const adapters: TestAdapter[] = [];
    registry.register("telegram", (_c, generation) => {
      const adapter = fakeAdapter(generation, true);
      adapters.push(adapter);
      return adapter;
    });
    const onPairing = vi.fn();
    const manager = new ConnectionManager(registry, { onPairing });
    await manager.connect(config);
    await manager.sync(config);
    adapters[0]!.emitPairing({
      version: 1,
      channelType: "telegram",
      channelInstanceId: "telegram-1",
      generation: 1,
      state: "pending",
      imageUrl: "data:image/png;base64,AA==",
      timestamp: 1,
    });
    expect(onPairing).not.toHaveBeenCalled();
  });

  it("registers downloaders before forwarding and unregisters on disconnect", async () => {
    const registry = new ChannelRegistry();
    let adapter: TestAdapter | undefined;
    registry.register("telegram", (_c, generation) => {
      adapter = fakeAdapter(generation, true);
      return adapter;
    });
    const store = new AttachmentStore({ workspaceRoot: "/tmp" });
    const register = vi.spyOn(store, "registerDownloader");
    const unregister = vi.spyOn(store, "unregisterGeneration");
    const onMessage = vi.fn(() => {
      expect(register).toHaveBeenCalledOnce();
    });
    const manager = new ConnectionManager(registry, { onMessage }, store);
    await manager.connect(config);
    adapter!.emitMessage({
      ...message(1),
      attachments: [
        {
          version: 1,
          id: "attachment-1",
          filename: "image.png",
          mediaType: "image/png",
          size: 10,
          sourceRef: "platform-image-1",
          sourceKind: "platform",
        },
      ],
    });
    expect(onMessage).toHaveBeenCalledOnce();
    await manager.disconnect("telegram-1", "runtime_stop");
    expect(unregister).toHaveBeenCalledWith("telegram-1", 1);
    await expect(
      store.downloadInbound({
        version: 1,
        generation: 1,
        id: "attachment-1",
        channelInstanceId: "telegram-1",
        sourceKind: "platform",
        filename: "image.png",
        mediaType: "image/png",
        declaredSize: 10,
        platformRef: "platform-image-1",
        sourceRef: "platform-image-1",
      }),
    ).rejects.toMatchObject({ code: "ATTACHMENT_SOURCE_UNAVAILABLE" });
  });

  it("rejects generation-one attachments after sync creates generation two", async () => {
    const registry = new ChannelRegistry();
    let adapter: TestAdapter | undefined;
    registry.register("telegram", (_c, generation) => {
      adapter = fakeAdapter(generation, true);
      return adapter;
    });
    const store = new AttachmentStore({ workspaceRoot: "/tmp" });
    const manager = new ConnectionManager(registry, {}, store);
    await manager.connect(config);
    adapter!.emitMessage({
      ...message(1),
      attachments: [
        {
          version: 1,
          id: "attachment-1",
          sourceRef: "platform-image-1",
          sourceKind: "platform",
        },
      ],
    });
    await manager.sync(config);
    await expect(
      store.downloadInbound({
        version: 1,
        generation: 1,
        id: "attachment-1",
        channelInstanceId: "telegram-1",
        sourceKind: "platform",
        platformRef: "platform-image-1",
        sourceRef: "platform-image-1",
      }),
    ).rejects.toMatchObject({ code: "ATTACHMENT_SOURCE_UNAVAILABLE" });
    expect(manager.getStatus("telegram-1")?.generation).toBe(2);
  });
});
