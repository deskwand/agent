/**
 * 云端来源下的 ipc 行为：分派、旁路、取消、错误码透传。
 * harness 与 `ipc.test.ts` 同款（fakeIpcMain + vi.mock 的 configStore）。
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const config = vi.hoisted(() => ({
  voiceMode: {} as Record<string, unknown>,
}));

vi.mock("../../main/config/config-store", () => ({
  configStore: { getAll: () => ({ voiceMode: config.voiceMode }) },
}));

import { registerTtsIpc } from "../../main/tts/ipc";
import type { CloudTtsProvider } from "../../main/tts/cloud/provider";
import type { TtsService } from "../../main/tts/service";
import type { TtsEvent, TtsStreamEvent } from "../../shared/ipc-types";

function fakeIpcMain() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  return {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn);
    },
    removeHandler: (channel: string) => handlers.delete(channel),
    invoke: (channel: string, ...args: unknown[]) => {
      const fn = handlers.get(channel);
      if (!fn) throw new Error(`no handler for ${channel}`);
      return fn({}, ...args);
    },
  };
}

function serviceStub(): TtsService {
  return {
    isInstalled: () => true,
    load: vi.fn(async () => {}),
    speak: vi.fn(async () => ({
      ok: true as const,
      samples: new Float32Array([0.1]),
      sampleRate: 44100,
    })),
  } as unknown as TtsService;
}

function fakeProvider(over: Partial<CloudTtsProvider> = {}): CloudTtsProvider {
  return {
    id: "fake",
    labelKey: "fake",
    capabilities: {
      sampleRate: 24000,
      format: "pcm_s16le",
      instructions: false,
    },
    credentials: [],
    curatedVoices: [],
    tierModels: () => "m",
    async stream(_req, sink) {
      sink.chunk(new Float32Array([0.5]), 24000);
      sink.done();
    },
    ...over,
  };
}

function harness(provider: CloudTtsProvider | null) {
  const ipc = fakeIpcMain();
  const events: TtsEvent[] = [];
  const streamEvents: TtsStreamEvent[] = [];
  const service = serviceStub();
  registerTtsIpc({
    ipcMain: ipc as never,
    deps: {
      userDataPath: mkdtempSync(join(tmpdir(), "tts-cloud-")),
      sendEvent: (event) => events.push(event),
      sendStream: (event) => streamEvents.push(event),
      service,
      cloud: { providerFor: () => provider },
    },
  });
  return { ipc, events, streamEvents, service };
}

const cloudMode = {
  tone: "balanced",
  source: "cloud",
  cloud: {
    provider: "fake",
    voiceId: "v",
    models: { balanced: "m" },
    credentials: { fake: { apiKey: "k" } },
  },
};

const until = async (cond: () => boolean, ms = 1000) => {
  const started = Date.now();
  while (!cond()) {
    if (Date.now() - started > ms)
      throw new Error("timeout waiting for condition");
    await new Promise((r) => setTimeout(r, 5));
  }
};

beforeEach(() => {
  config.voiceMode = structuredClone(cloudMode);
});

describe("来源=云端", () => {
  it("走 provider，不触发本机补装，块带 seq 且以 done 收尾", async () => {
    const { ipc, events, streamEvents } = harness(fakeProvider());
    const { streamId } = (await ipc.invoke("tts.speakStream", "你好")) as {
      streamId: number;
    };
    await until(() => streamEvents.some((e) => e.type === "done"));

    const chunks = streamEvents.filter((e) => e.type === "chunk");
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toMatchObject({ streamId, seq: 0, sampleRate: 24000 });
    expect(streamEvents.at(-1)).toMatchObject({ streamId, type: "done" });
    // 六条本机专属行为旁路：自动补装正是其中一条
    expect(events.filter((e) => e.type === "install")).toHaveLength(0);
  });

  it("未配置凭据 → 立刻 unconfigured，且一次都不碰本机 service", async () => {
    config.voiceMode = { tone: "balanced", source: "cloud", cloud: {} };
    const { ipc, streamEvents, service } = harness(null);
    await ipc.invoke("tts.speakStream", "你好");
    expect(streamEvents).toHaveLength(1);
    expect(streamEvents[0]).toMatchObject({
      type: "error",
      code: "unconfigured",
    });
    expect(service.speak).not.toHaveBeenCalled();
  });

  it("取消：abort 传给 provider，之后既无 chunk 也无 done/error", async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const provider = fakeProvider({
      async stream(_req, sink, signal) {
        sink.chunk(new Float32Array([0.1]), 24000);
        await gate;
        if (signal.aborted) return; // 真实 provider 的行为：断连即停
        sink.chunk(new Float32Array([0.2]), 24000);
        sink.done();
      },
    });
    const { ipc, streamEvents } = harness(provider);
    const { streamId } = (await ipc.invoke("tts.speakStream", "你好")) as {
      streamId: number;
    };
    await until(() => streamEvents.length > 0);
    await ipc.invoke("tts.cancelStream", streamId);
    release!();
    await new Promise((r) => setTimeout(r, 30));

    expect(streamEvents.filter((e) => e.type === "chunk")).toHaveLength(1);
    expect(streamEvents.some((e) => e.type === "done")).toBe(false);
    expect(streamEvents.some((e) => e.type === "error")).toBe(false);
  });

  it("错误码透传：渲染层靠 code 映射文案", async () => {
    const provider = fakeProvider({
      async stream(_req, sink) {
        sink.error("quota", "balance not enough");
      },
    });
    const { ipc, streamEvents } = harness(provider);
    await ipc.invoke("tts.speakStream", "你好");
    await until(() => streamEvents.some((e) => e.type === "error"));
    expect(streamEvents.at(-1)).toMatchObject({
      type: "error",
      code: "quota",
    });
  });

  it("整句入口（tts.speak，wav 工具那条路）同样走云端", async () => {
    const { ipc, service } = harness(fakeProvider());
    const result = (await ipc.invoke("tts.speak", "你好")) as {
      ok: boolean;
      sampleRate?: number;
    };
    expect(result.ok).toBe(true);
    expect(result.sampleRate).toBe(24000);
    expect(service.speak).not.toHaveBeenCalled();
  });
});

/**
 * 同一条根因在流式通路上的表现：没显式选音色时，必须与「界面显示的那个默认音色」
 * 一致 —— 否则界面说已配置、朗读报未配置。
 */
describe("音色默认值（流式通路）", () => {
  it("用 provider 的第一个策展音色，而不是报 unconfigured", async () => {
    config.voiceMode = {
      tone: "balanced",
      source: "cloud",
      cloud: {
        provider: "fake",
        models: { balanced: "m" },
        credentials: { fake: { apiKey: "k" } },
      },
    };
    const seen: string[] = [];
    const provider = fakeProvider({
      curatedVoices: [{ id: "v-default", labelKey: "k" }],
      async stream(req, sink) {
        seen.push(req.voiceId);
        sink.chunk(new Float32Array([1]), 24000);
        sink.done();
      },
    });
    const { ipc, streamEvents } = harness(provider);
    await ipc.invoke("tts.speakStream", "你好");
    await until(() => streamEvents.some((e) => e.type === "done"));

    expect(seen).toEqual(["v-default"]);
    expect(streamEvents.some((e) => e.type === "error")).toBe(false);
  });
});
