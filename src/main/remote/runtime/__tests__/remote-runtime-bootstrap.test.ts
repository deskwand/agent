import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RemoteRuntimeBootstrap,
  type BootstrapGapReport,
} from "../remote-runtime-bootstrap";
import { AttachmentStore } from "../attachment-store";
import { ChannelRuntimePersistence } from "../persistence";
import type { ChannelPairingEvent } from "../../../../shared/ipc-types";
import type {
  Session,
  ContentBlock,
} from "../../../../renderer/types";
import type { UnifiedMessage } from "../contracts";
import type { ChannelAdapterConfig } from "../channel-adapter";
import type { ChannelSessionBinding } from "../session-router";
import type { ReceiptContext } from "../channel-runtime";
import { logError } from "../../../utils/logger";

const mockRemoteConfigGetAll = vi.fn(
  () => ({ gateway: {} }),
);

vi.mock("../../remote-config-store", () => ({
  remoteConfigStore: {
    getAll: () => mockRemoteConfigGetAll(),
    listChannelInstances: () => [],
  },
}));

vi.mock("../../../utils/logger", () => ({
  log: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("../../../db/database", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  return {
    getDatabase: vi.fn(() => ({
      raw: new DatabaseSync(":memory:"),
    })),
  };
});

vi.mock("../runtime-key-store", () => ({
  RuntimeKeyStore: class {
    loadOrCreate(): Promise<Buffer> {
      return Promise.resolve(Buffer.alloc(32, 7));
    }
  },
}));

function fakeAgentExecutor(): {
  startSession: ReturnType<typeof vi.fn>;
  continueSession: ReturnType<typeof vi.fn>;
  stopSession: ReturnType<typeof vi.fn>;
} {
  return {
    startSession: vi.fn(async () => ({ id: "agent-session-1" }) as Session),
    continueSession: vi.fn(async () => undefined),
    stopSession: vi.fn(async () => undefined),
  };
}

const PNG_BYTES = Buffer.from("png-bytes");

const binding: ChannelSessionBinding = {
  version: 1,
  generation: 1,
  sessionId: "remote-binding-1",
  agentId: "remote-runtime",
  channelInstanceId: "wechat-1",
  chatId: "chat-1",
  userId: "user-1",
  createdAt: 1,
  updatedAt: 1,
};

function imageMessage(): UnifiedMessage {
  return {
    version: 1,
    generation: 1,
    id: "message-1",
    channelType: "wechat",
    channelInstanceId: "wechat-1",
    chatId: "chat-1",
    userId: "user-1",
    chatKind: "dm",
    text: "describe this",
    attachments: [
      {
        version: 1,
        id: "image-1",
        filename: "image.png",
        mediaType: "image/png",
        size: PNG_BYTES.length,
        sourceRef: "wechat:image:1",
        sourceKind: "platform" as const,
      },
    ],
    mentions: [],
    timestamp: 1,
  };
}

function pdfMessage(): UnifiedMessage {
  return {
    version: 1,
    generation: 1,
    id: "message-2",
    channelType: "wechat",
    channelInstanceId: "wechat-1",
    chatId: "chat-1",
    userId: "user-1",
    chatKind: "dm",
    text: "check this file",
    attachments: [
      {
        version: 1,
        id: "file-1",
        filename: "report.pdf",
        mediaType: "application/pdf",
        size: 5000,
        sourceRef: "wechat:file:1",
        sourceKind: "platform" as const,
      },
    ],
    mentions: [],
    timestamp: 2,
  };
}

function registerAttachment(
  store: AttachmentStore,
  sourceRef: string,
  data: Buffer,
  generation = 1,
): void {
  store.registerDownloader(
    {
      version: 1,
      generation,
      id: sourceRef,
      channelInstanceId: "wechat-1",
      sourceKind: "platform",
      filename: "image.png",
      mediaType: "image/png",
      declaredSize: data.length,
      platformRef: sourceRef,
      sourceRef,
    },
    async () => data,
  );
}

function testReceiptContext(): ReceiptContext {
  const finalIdempotencyKey = JSON.stringify([
    "remote-runtime",
    "wechat-1",
    "chat-1",
    "message-1",
    "reply",
  ]);
  return {
    receiptKey: JSON.stringify(["wechat-1", "chat-1", "message-1"]),
    finalIdempotencyKey,
    turnId: finalIdempotencyKey,
  };
}

function pairingEvent(
  generation: number,
  state: ChannelPairingEvent["state"],
): ChannelPairingEvent {
  return {
    version: 1,
    channelType: "wechat",
    channelInstanceId: "wechat-1",
    generation,
    state,
    imageUrl:
      state === "pending" || state === "scanned"
        ? "data:image/png;base64,AA=="
        : undefined,
    timestamp: generation,
  };
}

// ---------------------------------------------------------------------------
// Private member access helpers
// ---------------------------------------------------------------------------

type BootstrapInternals = {
  handlePairing(event: ChannelPairingEvent): void;
  handleConnectionStatus(event: {
    channelInstanceId: string;
    generation: number;
    state: string;
  }): void;
  generationWatermarks: Map<string, number>;
  attachmentStore: AttachmentStore;
  executeAgent(
    binding: ChannelSessionBinding,
    message: UnifiedMessage,
    context: ReceiptContext,
  ): Promise<void>;
};

function internals(bootstrap: RemoteRuntimeBootstrap): BootstrapInternals {
  return bootstrap as unknown as BootstrapInternals;
}

function emitPairing(
  bootstrap: RemoteRuntimeBootstrap,
  event: ChannelPairingEvent,
): void {
  internals(bootstrap).handlePairing(event);
}

function emitConnectionStatus(
  bootstrap: RemoteRuntimeBootstrap,
  event: {
    channelInstanceId: string;
    generation: number;
    state: string;
  },
): void {
  internals(bootstrap).handleConnectionStatus(event);
}

async function initBootstrap(
  onPairing?: (event: ChannelPairingEvent) => void,
  existingAgentExecutor?: ReturnType<typeof fakeAgentExecutor>,
): Promise<{ bootstrap: RemoteRuntimeBootstrap; agentExecutor: ReturnType<typeof fakeAgentExecutor> }> {
  const agentExecutor = existingAgentExecutor ?? fakeAgentExecutor();
  const bootstrap = new RemoteRuntimeBootstrap();
  await bootstrap.initialize({
    agentExecutor: agentExecutor as Parameters<
      RemoteRuntimeBootstrap["initialize"]
    >[0]["agentExecutor"],
    onPairing,
  });
  return { bootstrap, agentExecutor };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RemoteRuntimeBootstrap pairing snapshots", () => {
  // --- existing Task 1/2 tests (preserved) ---

  it("caches, forwards, and clears pairing snapshots", async () => {
    const onPairing = vi.fn();
    const { bootstrap } = await initBootstrap(onPairing);
    emitPairing(bootstrap, pairingEvent(1, "pending"));
    expect(bootstrap.getPairingSnapshots()).toEqual([
      expect.objectContaining({
        channelInstanceId: "wechat-1",
        state: "pending",
      }),
    ]);
    emitPairing(bootstrap, pairingEvent(1, "confirmed"));
    expect(bootstrap.getPairingSnapshots()).toEqual([]);
    expect(onPairing).toHaveBeenCalledTimes(2);
  });

  it("ignores stale-generation pairing events", async () => {
    const { bootstrap } = await initBootstrap();
    emitPairing(bootstrap, pairingEvent(2, "pending"));
    emitPairing(bootstrap, pairingEvent(1, "scanned"));
    expect(bootstrap.getPairingSnapshots()[0]?.generation).toBe(2);
  });

  it("clears snapshot on newer-generation status starting", async () => {
    const { bootstrap } = await initBootstrap();
    emitPairing(bootstrap, pairingEvent(1, "pending"));
    expect(bootstrap.getPairingSnapshots()).toHaveLength(1);
    emitConnectionStatus(bootstrap, {
      channelInstanceId: "wechat-1",
      generation: 2,
      state: "starting",
    });
    expect(bootstrap.getPairingSnapshots()).toEqual([]);
  });

  it("clears snapshot on same-generation stopped status", async () => {
    const { bootstrap } = await initBootstrap();
    emitPairing(bootstrap, pairingEvent(1, "pending"));
    expect(bootstrap.getPairingSnapshots()).toHaveLength(1);
    emitConnectionStatus(bootstrap, {
      channelInstanceId: "wechat-1",
      generation: 1,
      state: "stopped",
    });
    expect(bootstrap.getPairingSnapshots()).toEqual([]);
  });

  it("clears snapshot on same-generation failed status", async () => {
    const { bootstrap } = await initBootstrap();
    emitPairing(bootstrap, pairingEvent(1, "scanned"));
    expect(bootstrap.getPairingSnapshots()).toHaveLength(1);
    emitConnectionStatus(bootstrap, {
      channelInstanceId: "wechat-1",
      generation: 1,
      state: "failed",
    });
    expect(bootstrap.getPairingSnapshots()).toEqual([]);
  });

  it("clears all snapshots on Bootstrap stop", async () => {
    const { bootstrap } = await initBootstrap();
    emitPairing(bootstrap, pairingEvent(1, "pending"));
    emitPairing(bootstrap, {
      ...pairingEvent(1, "pending"),
      channelInstanceId: "wechat-2",
    });
    expect(bootstrap.getPairingSnapshots()).toHaveLength(2);
    await bootstrap.stop();
    expect(bootstrap.getPairingSnapshots()).toEqual([]);
  });

  it("forwards terminal events but removes snapshot", async () => {
    const onPairing = vi.fn();
    const { bootstrap } = await initBootstrap(onPairing);
    emitPairing(bootstrap, pairingEvent(1, "pending"));
    emitPairing(bootstrap, {
      ...pairingEvent(1, "failed"),
      imageUrl: "data:image/png;base64,AA==",
      errorCode: "WECHAT_QR_STATUS_INVALID",
    });
    expect(bootstrap.getPairingSnapshots()).toEqual([]);
    expect(onPairing).toHaveBeenCalledWith(
      expect.objectContaining({
        state: "failed",
        imageUrl: undefined,
        errorCode: "WECHAT_QR_STATUS_INVALID",
      }),
    );
  });

  // --- Task 1: Per-instance generation watermark ---

  it("rejects pairing events with generation below the watermark after terminal cleanup", async () => {
    const { bootstrap } = await initBootstrap();
    // gen 2 pending → watermark = 2
    emitPairing(bootstrap, pairingEvent(2, "pending"));
    // gen 2 expired → clears snapshot, watermark stays at 2
    emitPairing(bootstrap, pairingEvent(2, "expired"));
    expect(bootstrap.getPairingSnapshots()).toEqual([]);
    // gen 1 pending → stale, rejected
    emitPairing(bootstrap, pairingEvent(1, "pending"));
    expect(bootstrap.getPairingSnapshots()).toEqual([]);
  });

  it("does NOT reject same-generation pending after expired (legitimate new QR)", async () => {
    const { bootstrap } = await initBootstrap();
    // gen 2 pending → watermark = 2
    emitPairing(bootstrap, pairingEvent(2, "pending"));
    // gen 2 expired → clears snapshot, watermark stays 2
    emitPairing(bootstrap, pairingEvent(2, "expired"));
    expect(bootstrap.getPairingSnapshots()).toEqual([]);
    // gen 2 pending again → same generation, should be accepted
    emitPairing(bootstrap, pairingEvent(2, "pending"));
    expect(bootstrap.getPairingSnapshots()).toHaveLength(1);
    expect(bootstrap.getPairingSnapshots()[0]?.generation).toBe(2);
  });

  it("updates watermark on pairing events", async () => {
    const { bootstrap } = await initBootstrap();
    emitPairing(bootstrap, pairingEvent(1, "pending"));
    emitPairing(bootstrap, pairingEvent(3, "pending"));
    // gen 2 is stale now
    emitPairing(bootstrap, pairingEvent(2, "scanned"));
    expect(bootstrap.getPairingSnapshots()[0]?.generation).toBe(3);
  });

  it("updates watermark on status events and rejects stale pairings", async () => {
    const { bootstrap } = await initBootstrap();
    emitPairing(bootstrap, pairingEvent(1, "pending"));
    // Status at gen 3 bumps watermark
    emitConnectionStatus(bootstrap, {
      channelInstanceId: "wechat-1",
      generation: 3,
      state: "starting",
    });
    expect(bootstrap.getPairingSnapshots()).toEqual([]);
    // gen 2 pending → stale, rejected
    emitPairing(bootstrap, pairingEvent(2, "pending"));
    expect(bootstrap.getPairingSnapshots()).toEqual([]);
    // gen 3 is fine
    emitPairing(bootstrap, pairingEvent(3, "pending"));
    expect(bootstrap.getPairingSnapshots()).toHaveLength(1);
  });

  it("watermarks persist independently of snapshots", async () => {
    const { bootstrap } = await initBootstrap();
    // gen 5 → watermark 5
    emitPairing(bootstrap, pairingEvent(5, "pending"));
    // gen 5 expired → snapshot cleared, watermark stays 5
    emitPairing(bootstrap, pairingEvent(5, "expired"));
    expect(bootstrap.getPairingSnapshots()).toEqual([]);
    // gen 4 → stale
    emitPairing(bootstrap, pairingEvent(4, "pending"));
    expect(bootstrap.getPairingSnapshots()).toEqual([]);
    // gen 5 pending after expired → accepted (same gen)
    emitPairing(bootstrap, pairingEvent(5, "pending"));
    expect(bootstrap.getPairingSnapshots()).toHaveLength(1);
  });

  // --- Task 2: Deterministic finally cleanup & stop rejection ---

  it("clears pairing state when runtime startup fails", async () => {
    const { bootstrap } = await initBootstrap();
    emitPairing(bootstrap, pairingEvent(1, "pending"));
    const b = bootstrap as unknown as {
      channelRuntime: { start: () => Promise<void> } | null;
    };
    b.channelRuntime = {
      start: async () => { throw new Error("injected start failure"); },
    };

    await expect(bootstrap.start()).rejects.toThrow("injected start failure");
    expect(bootstrap.getPairingSnapshots()).toEqual([]);
    expect(internals(bootstrap).generationWatermarks.size).toBe(0);
    expect(bootstrap.isStarted()).toBe(false);
  });

  it("clears snapshots and watermarks in finally on stop error", async () => {
    const { bootstrap } = await initBootstrap();
    emitPairing(bootstrap, pairingEvent(3, "pending"));
    // Simulate started=true but channelRuntime will throw on stop
    const b = bootstrap as unknown as {
      started: boolean;
      channelRuntime: { stop: () => Promise<never> } | null;
    };
    b.started = true;
    b.channelRuntime = {
      stop: async () => {
        throw new Error("injected stop failure");
      },
    };
    await expect(bootstrap.stop()).rejects.toThrow("injected stop failure");
    // finally block must have run
    expect(bootstrap.getPairingSnapshots()).toEqual([]);
    expect(internals(bootstrap).generationWatermarks.size).toBe(0);
    expect(bootstrap.isStarted()).toBe(false);
  });

  it("clears snapshots and watermarks in finally when stop succeeds", async () => {
    const { bootstrap } = await initBootstrap();
    emitPairing(bootstrap, pairingEvent(1, "pending"));
    emitPairing(bootstrap, pairingEvent(2, "scanned"));
    internals(bootstrap).generationWatermarks.set("wechat-1", 2);
    expect(internals(bootstrap).generationWatermarks.size).toBe(1);
    await bootstrap.stop();
    expect(bootstrap.getPairingSnapshots()).toEqual([]);
    expect(internals(bootstrap).generationWatermarks.size).toBe(0);
    expect(bootstrap.isStarted()).toBe(false);
  });

  it("clears snapshots even when stop is called on unstarted bootstrap", async () => {
    const { bootstrap } = await initBootstrap();
    emitPairing(bootstrap, pairingEvent(1, "pending"));
    // bootstrap was initialized but never started, so stop() should
    // still clean up via finally
    await bootstrap.stop();
    expect(bootstrap.getPairingSnapshots()).toEqual([]);
    expect(internals(bootstrap).generationWatermarks.size).toBe(0);
  });

  // --- Task 3: Clear snapshot on connected/reconnecting/draining/stopping ---

  it("clears snapshot on same-generation connected status", async () => {
    const { bootstrap } = await initBootstrap();
    emitPairing(bootstrap, pairingEvent(1, "pending"));
    expect(bootstrap.getPairingSnapshots()).toHaveLength(1);
    emitConnectionStatus(bootstrap, {
      channelInstanceId: "wechat-1",
      generation: 1,
      state: "connected",
    });
    expect(bootstrap.getPairingSnapshots()).toEqual([]);
  });

  it("clears snapshot on same-generation reconnecting status", async () => {
    const { bootstrap } = await initBootstrap();
    emitPairing(bootstrap, pairingEvent(1, "scanned"));
    expect(bootstrap.getPairingSnapshots()).toHaveLength(1);
    emitConnectionStatus(bootstrap, {
      channelInstanceId: "wechat-1",
      generation: 1,
      state: "reconnecting",
    });
    expect(bootstrap.getPairingSnapshots()).toEqual([]);
  });

  it("clears snapshot on same-generation draining status", async () => {
    const { bootstrap } = await initBootstrap();
    emitPairing(bootstrap, pairingEvent(1, "pending"));
    emitConnectionStatus(bootstrap, {
      channelInstanceId: "wechat-1",
      generation: 1,
      state: "draining",
    });
    expect(bootstrap.getPairingSnapshots()).toEqual([]);
  });

  it("clears snapshot on same-generation stopping status", async () => {
    const { bootstrap } = await initBootstrap();
    emitPairing(bootstrap, pairingEvent(1, "scanned"));
    emitConnectionStatus(bootstrap, {
      channelInstanceId: "wechat-1",
      generation: 1,
      state: "stopping",
    });
    expect(bootstrap.getPairingSnapshots()).toEqual([]);
  });

  it("does NOT clear snapshot on same-generation starting status", async () => {
    const { bootstrap } = await initBootstrap();
    emitPairing(bootstrap, pairingEvent(1, "pending"));
    emitConnectionStatus(bootstrap, {
      channelInstanceId: "wechat-1",
      generation: 1,
      state: "starting",
    });
    expect(bootstrap.getPairingSnapshots()).toHaveLength(1);
  });

  it("stale-after-terminal: new pair after terminal+newer-gen status cleanup", async () => {
    const { bootstrap } = await initBootstrap();
    emitPairing(bootstrap, pairingEvent(1, "pending"));
    // gen 2 stopped (newer) → clears gen 1 snapshot
    emitConnectionStatus(bootstrap, {
      channelInstanceId: "wechat-1",
      generation: 2,
      state: "stopped",
    });
    expect(bootstrap.getPairingSnapshots()).toEqual([]);
    // gen 1 stale → rejected by watermark
    emitPairing(bootstrap, pairingEvent(1, "pending"));
    expect(bootstrap.getPairingSnapshots()).toEqual([]);
    // gen 2 → watermark matches, accepted
    emitPairing(bootstrap, pairingEvent(2, "pending"));
    expect(bootstrap.getPairingSnapshots()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Task 4: Attachment-to-ContentBlock delivery
// ---------------------------------------------------------------------------

describe("RemoteRuntimeBootstrap attachment delivery", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes downloaded image attachments to new Agent sessions", async () => {
    const agentExecutor = fakeAgentExecutor();
    const { bootstrap } = await initBootstrap(undefined, agentExecutor);
    const store = new AttachmentStore({ workspaceRoot: "/tmp" });
    registerAttachment(store, "wechat:image:1", PNG_BYTES);

    const internalsRef = internals(bootstrap);
    internalsRef.attachmentStore = store;

    await internalsRef.executeAgent(binding, imageMessage(), testReceiptContext());

    expect(agentExecutor.startSession).toHaveBeenCalledWith(
      expect.any(String),
      "describe this",
      undefined,
      [
        {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/png",
            data: PNG_BYTES.toString("base64"),
          },
        },
      ],
      expect.any(String),
    );
    expect(agentExecutor.continueSession).not.toHaveBeenCalled();
  });

  it("passes downloaded attachments to continued Agent sessions", async () => {
    const agentExecutor = fakeAgentExecutor();
    const { bootstrap } = await initBootstrap(undefined, agentExecutor);
    const store = new AttachmentStore({ workspaceRoot: "/tmp" });
    registerAttachment(store, "wechat:image:1", PNG_BYTES);

    const internalsRef = internals(bootstrap);
    internalsRef.attachmentStore = store;

    // A persisted actual session ID takes the continue path.
    const continuedBinding = { ...binding, sessionId: "agent-session-1" };

    await internalsRef.executeAgent(
      continuedBinding,
      imageMessage(),
      testReceiptContext(),
    );

    expect(agentExecutor.continueSession).toHaveBeenCalledWith(
      "agent-session-1",
      "describe this",
      [expect.objectContaining({ type: "image" })],
      undefined,
      expect.any(String),
    );
    expect(agentExecutor.startSession).not.toHaveBeenCalled();
  });

  it("converts non-image attachments to file_attachment with inlineDataBase64", async () => {
    const agentExecutor = fakeAgentExecutor();
    const { bootstrap } = await initBootstrap(undefined, agentExecutor);
    const store = new AttachmentStore({ workspaceRoot: "/tmp" });
    const pdfBytes = Buffer.from("pdf-bytes");
    store.registerDownloader(
      {
        version: 1,
        generation: 1,
        id: "file-1",
        channelInstanceId: "wechat-1",
        sourceKind: "platform",
        filename: "report.pdf",
        mediaType: "application/pdf",
        declaredSize: pdfBytes.length,
        platformRef: "wechat:file:1",
        sourceRef: "wechat:file:1",
      },
      async () => pdfBytes,
    );

    internals(bootstrap).attachmentStore = store;

    await internals(bootstrap).executeAgent(binding, pdfMessage(), testReceiptContext());

    const call = agentExecutor.startSession.mock.calls[0] as unknown[];
    const content = call[3] as ContentBlock[];
    expect(content).toHaveLength(1);
    const block = content[0] as ContentBlock;
    expect(block.type).toBe("file_attachment");
    if (block.type === "file_attachment") {
      expect(block.filename).toBe("report.pdf");
      expect(block.relativePath).toBe("");
      expect(block.mimeType).toBe("application/pdf");
      expect(block.inlineDataBase64).toBe(pdfBytes.toString("base64"));
    }
  });

  it("never treats a remote filename as a local source path", async () => {
    const agentExecutor = fakeAgentExecutor();
    const { bootstrap } = await initBootstrap(undefined, agentExecutor);
    const store = new AttachmentStore({ workspaceRoot: "/tmp" });
    const data = Buffer.from("remote-file");
    registerAttachment(store, "wechat:file:1", data);
    internals(bootstrap).attachmentStore = store;
    const message = pdfMessage();
    message.attachments[0] = {
      ...message.attachments[0]!,
      filename: "../../package.json",
    };

    await internals(bootstrap).executeAgent(binding, message, testReceiptContext());

    const content = agentExecutor.startSession.mock.calls[0]?.[3] as ContentBlock[];
    const block = content[0];
    expect(block?.type).toBe("file_attachment");
    if (block?.type === "file_attachment") {
      expect(block.filename).toBe("package.json");
      expect(block.relativePath).toBe("");
      expect(block.inlineDataBase64).toBe(data.toString("base64"));
    }
  });

  it("rejects Agent execution when aggregate message attachment exceeds 50 MiB", async () => {
    const agentExecutor = fakeAgentExecutor();
    const { bootstrap } = await initBootstrap(undefined, agentExecutor);
    const store = new AttachmentStore({ workspaceRoot: "/tmp" });

    const bigData = Buffer.alloc(26 * 1024 * 1024); // 26 MiB each
    registerAttachment(store, "ref:1", bigData);
    store.registerDownloader(
      {
        version: 1,
        generation: 1,
        id: "ref:2",
        channelInstanceId: "wechat-1",
        sourceKind: "platform",
        filename: "big2.bin",
        mediaType: "application/octet-stream",
        declaredSize: bigData.length,
        platformRef: "ref:2",
        sourceRef: "ref:2",
      },
      async () => bigData,
    );

    internals(bootstrap).attachmentStore = store;

    const message: UnifiedMessage = {
      ...imageMessage(),
      attachments: [
        {
          version: 1,
          id: "ref:1",
          sourceRef: "ref:1",
          sourceKind: "platform" as const,
          filename: "big1.bin",
          mediaType: "application/octet-stream",
          size: bigData.length,
        },
        {
          version: 1,
          id: "ref:2",
          sourceRef: "ref:2",
          sourceKind: "platform" as const,
          filename: "big2.bin",
          mediaType: "application/octet-stream",
          size: bigData.length,
        },
      ],
    };

    await expect(
      internals(bootstrap).executeAgent(binding, message, testReceiptContext()),
    ).rejects.toMatchObject({
      name: "AttachmentError",
      code: "ATTACHMENT_MESSAGE_TOO_LARGE",
    });

    expect(agentExecutor.startSession).not.toHaveBeenCalled();
    expect(agentExecutor.continueSession).not.toHaveBeenCalled();
  });

  it("produces no Agent call on download failure and logs without data", async () => {
    const agentExecutor = fakeAgentExecutor();
    const { bootstrap } = await initBootstrap(undefined, agentExecutor);
    const store = new AttachmentStore({ workspaceRoot: "/tmp" });
    // Register a downloader that throws
    store.registerDownloader(
      {
        version: 1,
        generation: 1,
        id: "image-1",
        channelInstanceId: "wechat-1",
        sourceKind: "platform",
        filename: "image.png",
        mediaType: "image/png",
        declaredSize: 10,
        platformRef: "wechat:image:1",
        sourceRef: "wechat:image:1",
      },
      async () => {
        throw new Error("download failed");
      },
    );

    internals(bootstrap).attachmentStore = store;

    await expect(
      internals(bootstrap).executeAgent(
        binding,
        imageMessage(),
        testReceiptContext(),
      ),
    ).rejects.toThrow("download failed");

    expect(agentExecutor.startSession).not.toHaveBeenCalled();
    expect(agentExecutor.continueSession).not.toHaveBeenCalled();
    expect(logError).not.toHaveBeenCalledWith(
      expect.stringContaining("download failed"),
      expect.anything(),
    );
  });

  it("builds no content blocks for messages without attachments", async () => {
    const agentExecutor = fakeAgentExecutor();
    const { bootstrap } = await initBootstrap(undefined, agentExecutor);

    const message = imageMessage();
    const noAttachmentMessage: UnifiedMessage = {
      ...message,
      attachments: [],
    };

    await internals(bootstrap).executeAgent(binding, noAttachmentMessage, testReceiptContext());

    expect(agentExecutor.startSession).toHaveBeenCalledWith(
      expect.any(String),
      "describe this",
      undefined,
      undefined,
      expect.any(String),
    );
  });
});

// ---------------------------------------------------------------------------
// Persistence construction: feature flag gating
// ---------------------------------------------------------------------------

describe("RemoteRuntimeBootstrap persistence construction", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("initializes without feature flag and no instances", async () => {
    // No instances configured (default mock, no flag).
    const bootstrap = new RemoteRuntimeBootstrap();
    const report = await bootstrap.initialize({
      agentExecutor: fakeAgentExecutor() as unknown as Parameters<
        RemoteRuntimeBootstrap["initialize"]
      >[0]["agentExecutor"],
    });

    expect(report.flag).toBe(true);
    expect(report.registered).toEqual([]);
    // DB / RuntimeKeyStore mocks would have thrown if accessed via
    // buildProductionPersistence — injected persistence avoids them.
  });

  it("uses injected persistence and avoids production stores", async () => {
    // listChannelInstances is not on the default mock, add it
    const { remoteConfigStore } = await import(
      "../../remote-config-store"
    );
    (
      remoteConfigStore as unknown as {
        listChannelInstances: (
          _: boolean,
        ) => Array<{ id: string; type: string; enabled: boolean; config: Record<string, unknown> }>;
      }
    ).listChannelInstances = vi.fn(() => []);

    // Build a ChannelRuntimePersistence backed by an in-memory DB
    const { DatabaseSync: DbSync } = await import("node:sqlite");
    const db = new DbSync(":memory:");
    const injectedPersistence = new ChannelRuntimePersistence(
      db,
      Buffer.alloc(32, 7),
    );

    const bootstrap = new RemoteRuntimeBootstrap();
    const report = await bootstrap.initialize({
      agentExecutor: fakeAgentExecutor() as unknown as Parameters<
        RemoteRuntimeBootstrap["initialize"]
      >[0]["agentExecutor"],
      persistence: injectedPersistence,
    });

    expect(report.flag).toBe(true);
    // DB / RuntimeKeyStore mocks would have thrown if accessed via
    // buildProductionPersistence, proving injection bypasses production stores

    await bootstrap.stop();
    db.close();
  });

  it("serializes initialize and stop on one lifecycle queue", async () => {
    const bootstrap = new RemoteRuntimeBootstrap();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const lifecycle = bootstrap as unknown as {
      initializeNow: () => Promise<BootstrapGapReport>;
      stopNow: () => Promise<void>;
    };
    lifecycle.initializeNow = vi.fn(async () => {
      await blocked;
      return {
        flag: false,
        capabilities: [],
        registered: [],
        unsupported: [],
      };
    });
    lifecycle.stopNow = vi.fn(async () => undefined);

    const initializing = bootstrap.initialize({
      agentExecutor: fakeAgentExecutor() as unknown as Parameters<
        RemoteRuntimeBootstrap["initialize"]
      >[0]["agentExecutor"],
    });
    const stopping = bootstrap.stop();
    await Promise.resolve();
    expect(lifecycle.stopNow).not.toHaveBeenCalled();

    release();
    await Promise.all([initializing, stopping]);
    expect(lifecycle.stopNow).toHaveBeenCalledOnce();
  });

  it("re-initializing resets started so start() reconnects", async () => {
    const bootstrap = new RemoteRuntimeBootstrap();
    const internalsRef = internals(bootstrap) as unknown as {
      channelRuntime: { start: ReturnType<typeof vi.fn> } | null;
    };
    await bootstrap.initialize({
      agentExecutor: fakeAgentExecutor() as unknown as Parameters<
        RemoteRuntimeBootstrap["initialize"]
      >[0]["agentExecutor"],
    });
    await bootstrap.start();
    expect(bootstrap.isStarted()).toBe(true);
    const firstRuntime = internalsRef.channelRuntime;

    // Re-initialize WITHOUT an intervening stop() — simulates a concurrent
    // refresh racing another refresh's stop(). The stack is rebuilt and
    // start() must reconnect instead of no-op'ing on stale `started`.
    const report = await bootstrap.initialize({
      agentExecutor: fakeAgentExecutor() as unknown as Parameters<
        RemoteRuntimeBootstrap["initialize"]
      >[0]["agentExecutor"],
    });
    expect(report.flag).toBe(true);
    const secondRuntime = internalsRef.channelRuntime;
    // Stack was rebuilt (new ChannelRuntime instance).
    expect(secondRuntime).not.toBe(firstRuntime);
    const startSpy = vi
      .spyOn(secondRuntime!, "start")
      .mockResolvedValue(undefined);

    await bootstrap.start();
    expect(bootstrap.isStarted()).toBe(true);
    // The rebuilt runtime must have been started, proving start() did not
    // no-op on the stale `started` flag from the first lifecycle.
    expect(startSpy).toHaveBeenCalled();
    startSpy.mockRestore();

    await bootstrap.stop();
  });

  it("concurrent duplicate deliverAgentResponse shares one in-flight operation", async () => {
    mockRemoteConfigGetAll.mockReturnValue({
      gateway: {},
    });

    const { DatabaseSync: DbSync } = await import("node:sqlite");
    const db = new DbSync(":memory:");
    const injectedPersistence = new ChannelRuntimePersistence(
      db,
      Buffer.alloc(32, 7),
    );

    const bootstrap = new RemoteRuntimeBootstrap();
    await bootstrap.initialize({
      agentExecutor: fakeAgentExecutor() as unknown as Parameters<
        RemoteRuntimeBootstrap["initialize"]
      >[0]["agentExecutor"],
      persistence: injectedPersistence,
    });

    // Set up response route and outbound in-flight tracking
    const bs = bootstrap as unknown as {
      responseRoutes: Map<string, unknown>;
      connectionManager: { send: ReturnType<typeof vi.fn> };
      outboundInFlight: Map<string, Promise<void>>;
      doSendResponse: (...args: unknown[]) => Promise<void>;
    };

    // Inject connection manager mock
    const sendMock = vi.fn(async () => ({
      version: 1 as const,
      generation: 1,
      accepted: true,
      committed: true,
      outcome: "committed" as const,
      idempotencyKey: "test-key",
    }));
    bs.connectionManager = { send: sendMock } as unknown as typeof bs.connectionManager;

    // Simulate multiple concurrent calls
    const p1 = bootstrap.deliverAgentResponse("s1", "turn-1", "text");
    const p2 = bootstrap.deliverAgentResponse("s1", "turn-1", "text");
    await Promise.all([p1, p2]);

    // Only one operation should execute; the second waits on the first
    expect(bs.outboundInFlight.size).toBe(0);

    await bootstrap.stop();
    db.close();
  });

  it("injected persistence auth survives new bootstrap and notify uses current adapter", async () => {
    mockRemoteConfigGetAll.mockReturnValue({
      gateway: {},
    });

    const { remoteConfigStore } = await import(
      "../../remote-config-store"
    );
    (
      remoteConfigStore as unknown as {
        listChannelInstances: (
          _: boolean,
        ) => Array<{ id: string; type: string; enabled: boolean; config: Record<string, unknown> }>;
      }
    ).listChannelInstances = vi.fn(() => [
      {
        id: "telegram-1",
        type: "telegram",
        enabled: true,
        config: { botToken: "test-token" },
      },
    ]);

    const { DatabaseSync: DbSync } = await import("node:sqlite");
    const db = new DbSync(":memory:");
    const injectedPersistence = new ChannelRuntimePersistence(
      db,
      Buffer.alloc(32, 7),
    );

    // First bootstrap: authorize a notification
    const bootstrap1 = new RemoteRuntimeBootstrap();
    await bootstrap1.initialize({
      agentExecutor: fakeAgentExecutor() as unknown as Parameters<
        RemoteRuntimeBootstrap["initialize"]
      >[0]["agentExecutor"],
      persistence: injectedPersistence,
    });

    bootstrap1.authorizeNotification({
      version: 1,
      generation: 1,
      agentId: "agent-1",
      channelInstanceId: "telegram-1",
      chatId: "chat-1",
      enabledAt: 100,
    });

    await bootstrap1.stop();

    // Second bootstrap: auth should survive from persistence
    const bootstrap2 = new RemoteRuntimeBootstrap();
    await bootstrap2.initialize({
      agentExecutor: fakeAgentExecutor() as unknown as Parameters<
        RemoteRuntimeBootstrap["initialize"]
      >[0]["agentExecutor"],
      persistence: injectedPersistence,
    });

    // Inject a mock adapter into the connection manager so notify works
    const bs = bootstrap2 as unknown as {
      connectionManager: {
        resolveAdapter: (id: string) => unknown;
      };
    };
    const mockAdapter = {
      channelType: "telegram" as const,
      channelInstanceId: "telegram-1",
      generation: 1,
      send: vi.fn(async () => ({
        version: 1 as const,
        generation: 1,
        accepted: true,
        committed: true,
        outcome: "committed" as const,
        idempotencyKey: "ignored",
      })),
    };
    bs.connectionManager = {
      resolveAdapter: vi.fn(() => mockAdapter),
    } as unknown as typeof bs.connectionManager;

    const result = await bootstrap2.notify({
      agentId: "agent-1",
      sourceEventId: "survived-event",
      generation: 1,
      target: {
        version: 1,
        channelType: "telegram",
        channelInstanceId: "telegram-1",
        chatId: "chat-1",
        visibility: "chat",
      },
      text: "survived",
    });

    expect(result.outcome).toBe("committed");
    expect(mockAdapter.send).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "notification" }),
    );

    await bootstrap2.stop();
    db.close();
  });

  it("streamComplete persists completed state that survives re-bootstrap", async () => {
    mockRemoteConfigGetAll.mockReturnValue({
      gateway: {},
    });

    const { remoteConfigStore } = await import(
      "../../remote-config-store"
    );
    (
      remoteConfigStore as unknown as {
        listChannelInstances: (
          _: boolean,
        ) => Array<{ id: string; type: string; enabled: boolean; config: Record<string, unknown> }>;
      }
    ).listChannelInstances = vi.fn(() => [
      {
        id: "telegram-1",
        type: "telegram",
        enabled: true,
        config: { botToken: "test-token" },
      },
    ]);

    const { DatabaseSync: DbSync } = await import("node:sqlite");
    const db = new DbSync(":memory:");
    const injectedPersistence = new ChannelRuntimePersistence(
      db,
      Buffer.alloc(32, 7),
    );

    // First bootstrap: stream complete should persist state
    const bootstrap1 = new RemoteRuntimeBootstrap();
    await bootstrap1.initialize({
      agentExecutor: fakeAgentExecutor() as unknown as Parameters<
        RemoteRuntimeBootstrap["initialize"]
      >[0]["agentExecutor"],
      persistence: injectedPersistence,
    });

    // Inject a mock adapter
    const bs1 = bootstrap1 as unknown as {
      connectionManager: {
        resolveAdapter: (id: string) => unknown;
      };
    };
    const mockAdapter1 = {
      channelType: "telegram" as const,
      channelInstanceId: "telegram-1",
      generation: 1,
      streamComplete: vi.fn(async () => ({
        version: 1 as const,
        generation: 1,
        accepted: true,
        committed: true,
        outcome: "committed" as const,
        idempotencyKey: "stream-final",
      })),
    };
    bs1.connectionManager = {
      resolveAdapter: vi.fn(() => mockAdapter1),
    } as unknown as typeof bs1.connectionManager;

    const result = await bootstrap1.streamComplete(
      "telegram-1",
      "turn-42",
      "final response",
      "stream-final",
      1,
      "chat-1",
    );
    expect(result.outcome).toBe("committed");

    await bootstrap1.stop();

    // Verify persisted stream state
    const persisted = injectedPersistence.getStreamState("turn-42");
    expect(persisted?.state).toBe("completed");
    expect(persisted?.finalIdempotencyKey).toBe("stream-final");
    expect(persisted?.committed).toBe(true);

    // Second bootstrap with new adapter: streamComplete should dedupe
    const bootstrap2 = new RemoteRuntimeBootstrap();
    await bootstrap2.initialize({
      agentExecutor: fakeAgentExecutor() as unknown as Parameters<
        RemoteRuntimeBootstrap["initialize"]
      >[0]["agentExecutor"],
      persistence: injectedPersistence,
    });

    const bs2 = bootstrap2 as unknown as {
      connectionManager: {
        resolveAdapter: (id: string) => unknown;
      };
    };
    const mockAdapter2 = {
      channelType: "telegram" as const,
      channelInstanceId: "telegram-1",
      generation: 1,
      streamComplete: vi.fn(),
    };
    bs2.connectionManager = {
      resolveAdapter: vi.fn(() => mockAdapter2),
    } as unknown as typeof bs2.connectionManager;

    const result2 = await bootstrap2.streamComplete(
      "telegram-1",
      "turn-42",
      "final response",
      "stream-final",
      1,
      "chat-1",
    );
    expect(result2.outcome).toBe("committed");
    expect(result2.committed).toBe(true);
    // Second adapter was never called due to persistence dedupe
    expect(mockAdapter2.streamComplete).not.toHaveBeenCalled();

    await bootstrap2.stop();
    db.close();
  });

  // ─── Bootstrap command wiring ──────────────────────────────────────────

  it("dispatches /help through ConnectionManager.parse -> ChannelRuntime.handleCommand", async () => {
    mockRemoteConfigGetAll.mockReturnValue({
      gateway: {},
    });

    const { remoteConfigStore } = await import(
      "../../remote-config-store"
    );
    (
      remoteConfigStore as unknown as {
        listChannelInstances: (
          _: boolean,
        ) => Array<{ id: string; type: string; enabled: boolean; config: Record<string, unknown> }>;
      }
    ).listChannelInstances = vi.fn(() => [
      {
        id: "telegram-1",
        type: "telegram",
        enabled: true,
        config: { botToken: "test-token" },
      },
    ]);

    const { DatabaseSync: DbSync } = await import("node:sqlite");
    const db = new DbSync(":memory:");
    const injectedPersistence = new ChannelRuntimePersistence(
      db,
      Buffer.alloc(32, 7),
    );

    const bootstrap = new RemoteRuntimeBootstrap();
    await bootstrap.initialize({
      agentExecutor: fakeAgentExecutor() as unknown as Parameters<
        RemoteRuntimeBootstrap["initialize"]
      >[0]["agentExecutor"],
      persistence: injectedPersistence,
      onPairing: vi.fn(),
    });

    // Wire an adapter that emits a "/help" message via the ConnectionManager.
    const bs = bootstrap as unknown as {
      connectionManager: {
        connect: (config: ChannelAdapterConfig) => Promise<unknown>;
      } | null;
      handleInboundCommand: (cmd: unknown) => Promise<void>;
      handleInboundMessage: (msg: unknown) => Promise<void>;
    };

    const handleInboundCommandSpy = vi.fn(async () => undefined);
    bs.handleInboundCommand = handleInboundCommandSpy;
    bs.handleInboundMessage = vi.fn(async () => undefined);

    // Simulate: adapter emits a message starting with "/".
    // ConnectionManager.subscribe() parses it and calls onCommand.
    // We test that the onCommand handler delegates to handleInboundCommand.
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

    const onCommand = vi.fn();
    const onMessage = vi.fn();
    const config: ChannelAdapterConfig = {
      channelType: "telegram",
      channelInstanceId: "telegram-1",
      agentId: "agent-1",
      settings: {},
    };
    const mgr = new ConnectionManager(registry, { onCommand, onMessage });
    await mgr.connect(config);

    // Emit a "/help" message — ConnectionManager parses command centrally
    emitMessage?.({
      version: 1,
      generation: 1,
      id: "cmd-help",
      channelType: "telegram",
      channelInstanceId: "telegram-1",
      chatId: "chat-1",
      userId: "allowed",
      chatKind: "dm",
      text: "/help",
      attachments: [],
      mentions: [],
      timestamp: 1,
    });

    // onCommand is fired, onMessage is not
    expect(onCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "help",
        args: [],
      }),
    );
    expect(onMessage).not.toHaveBeenCalled();

    await mgr.disconnectAll("test-end");
    await bootstrap.stop();
    db.close();
  });
});
