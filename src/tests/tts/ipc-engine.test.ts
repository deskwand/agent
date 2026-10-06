/**
 * 「最佳音质」档在 IPC 上的契约：路由、回退、打断、试听、安装三件套。
 *
 * 单独一个文件而不是塞进 `ipc.test.ts`：那边是 sherpa 三个模型的世界，这里要
 * 注入的是**引擎门面**（EngineHost）。混在一起，每个用例都得先读一屏无关替身。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const config = vi.hoisted(() => ({ readAloudEnabled: true }));

vi.mock("../../main/config/config-store", () => ({
  configStore: {
    getAll: () => ({
      readAloud: { enabled: config.readAloudEnabled },
      voiceMode: { voiceEngineVoice: "ryan" },
    }),
  },
}));

import { registerTtsIpc } from "../../main/tts/ipc";
import type { EngineHost } from "../../main/engine/engine-host";
import type { EngineStreamOptions } from "../../main/engine/engine-bridge";
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

function serviceStub(
  onSpeak?: (opts?: { tone?: string; purpose?: string }) => void,
): TtsService {
  return {
    isInstalled: () => true,
    load: vi.fn(async () => {}),
    speak: vi.fn(async (_text, opts, onChunk) => {
      onSpeak?.(opts as { tone?: string; purpose?: string });
      onChunk?.({ samples: new Float32Array([9]), sampleRate: 44100 });
      return {
        ok: true as const,
        samples: new Float32Array([9]),
        sampleRate: 44100,
      };
    }),
  } as unknown as TtsService;
}

/** 引擎门面替身。`speak` 默认照真实桥接的样子：吐块 + 自己发 done。 */
function engineStub(
  opts: {
    available?: boolean;
    installed?: boolean;
    blocked?: "disk" | "memory" | "platform";
    hang?: boolean;
  } = {},
) {
  const calls: EngineStreamOptions[] = [];
  const speak = vi.fn((o: EngineStreamOptions) => {
    calls.push(o);
    if (opts.hang) {
      // 一直等到被 abort（用来验打断链路）
      return new Promise<{ ok: true } | { ok: false; error: string }>(
        (resolve) => {
          o.signal?.addEventListener("abort", () =>
            resolve({ ok: false, error: "aborted" }),
          );
        },
      );
    }
    o.send({
      streamId: o.streamId,
      type: "chunk",
      seq: 0,
      samples: new Float32Array([1, 2]),
      sampleRate: 24000,
    });
    o.send({ streamId: o.streamId, type: "done" });
    return Promise.resolve({ ok: true as const });
  });
  const install = vi.fn(
    async (progress: {
      onProgress: (p: number) => void;
      onPhase?: (phase: "checking" | "downloading" | "installing") => void;
    }) => {
      progress.onPhase?.("downloading");
      progress.onProgress(0.5);
      progress.onPhase?.("installing");
      progress.onProgress(1);
    },
  );
  const remove = vi.fn();
  const host = {
    installed: () => opts.installed ?? true,
    available: () => opts.available ?? true,
    status: () => (opts.available === false ? "failed" : "ready"),
    blockedReason: () => opts.blocked,
    install,
    remove,
    warmup: vi.fn(async () => {}),
    speak: speak as unknown as EngineHost["speak"],
  } as unknown as EngineHost;
  return { host, calls, speak, install, remove };
}

function harness(
  engineOpts: Parameters<typeof engineStub>[0] = {},
  onSpeak?: (opts?: { tone?: string; purpose?: string }) => void,
) {
  const events: TtsEvent[] = [];
  const streamEvents: TtsStreamEvent[] = [];
  const service = serviceStub(onSpeak);
  const engine = engineStub(engineOpts);
  const ipc = fakeIpcMain();
  const handle = registerTtsIpc({
    ipcMain: ipc as never,
    deps: {
      userDataPath: "/tmp/does-not-matter",
      sendEvent: (event) => events.push(event),
      sendStream: (event) => streamEvents.push(event),
      service,
      engine: engine.host,
    },
  });
  return {
    ipc,
    service,
    engine,
    events,
    streamEvents,
    dispose: () => handle.dispose(),
  };
}

describe("最佳音质档的 IPC 行为", () => {
  beforeEach(() => {
    config.readAloudEnabled = true;
  });

  it("purpose=voice + 可用 → 走引擎，块透传，done 只有一个", async () => {
    const { ipc, engine, service } = harness();
    const { streamId } = (await ipc.invoke("tts.speakStream", "你好", {
      purpose: "voice",
      tone: "best",
    })) as { streamId: number };

    await vi.waitFor(() => expect(engine.speak).toHaveBeenCalledOnce());
    await vi.waitFor(() =>
      expect(engine.speak.mock.calls[0][0].send).toBeDefined(),
    );
    expect(service.speak).not.toHaveBeenCalled();
    expect(engine.calls[0].streamId).toBe(streamId);
    // 音色来自配置（替身里是 ryan）
    expect(engine.calls[0].voiceId).toBe("ryan");
  });

  it("引擎不可用 → 回退「均衡」档，仍然出声（而不是静默）", async () => {
    const tones: (string | undefined)[] = [];
    const { ipc, engine, streamEvents } = harness(
      { available: false },
      (opts) => tones.push(opts?.tone),
    );

    await ipc.invoke("tts.speakStream", "你好", {
      purpose: "voice",
      tone: "best",
    });

    await vi.waitFor(() => expect(tones.length).toBe(1));
    expect(engine.speak).not.toHaveBeenCalled();
    // 回退时把 tone 换成 balanced：不能让 service 再解析回引擎
    expect(tones[0]).toBe("balanced");
    await vi.waitFor(() =>
      expect(streamEvents.some((e) => e.type === "done")).toBe(true),
    );
  });

  it("不带 purpose 的 best 仍受朗读开关门控（引擎不是后门）", async () => {
    config.readAloudEnabled = false;
    const { ipc, engine, streamEvents } = harness();

    await ipc.invoke("tts.speakStream", "你好", { tone: "best" });

    await vi.waitFor(() => expect(streamEvents.length).toBe(1));
    expect(streamEvents[0]).toMatchObject({
      type: "error",
      error: "read aloud disabled",
    });
    expect(engine.speak).not.toHaveBeenCalled();
  });

  it("打断：cancelStream 会 abort 那次引擎请求，且不再发 done/error", async () => {
    const { ipc, engine, streamEvents } = harness({ hang: true });
    const { streamId } = (await ipc.invoke("tts.speakStream", "你好", {
      purpose: "voice",
      tone: "best",
    })) as { streamId: number };

    await vi.waitFor(() => expect(engine.calls.length).toBe(1));
    await ipc.invoke("tts.cancelStream", streamId);

    expect(engine.calls[0].signal?.aborted).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(
      streamEvents.some((e) => e.type === "done" || e.type === "error"),
    ).toBe(false);
  });

  it("试听：均衡走 service，最佳音质把块攒成整句", async () => {
    const { ipc, service, engine } = harness();
    const balanced = await ipc.invoke("tts.preview", "balanced");
    expect(service.speak).toHaveBeenCalledOnce();
    expect(balanced).toMatchObject({ ok: true, sampleRate: 44100 });

    (
      engine.host.speak as unknown as ReturnType<typeof vi.fn>
    ).mockImplementation((o: EngineStreamOptions) => {
      o.send({
        streamId: o.streamId,
        type: "chunk",
        seq: 0,
        samples: new Float32Array([1, 2]),
        sampleRate: 24000,
      });
      o.send({
        streamId: o.streamId,
        type: "chunk",
        seq: 1,
        samples: new Float32Array([3]),
        sampleRate: 24000,
      });
      o.send({ streamId: o.streamId, type: "done" });
      return Promise.resolve({ ok: true as const });
    });
    const best = (await ipc.invoke("tts.preview", "best")) as {
      ok: true;
      samples: Float32Array;
      sampleRate: number;
    };
    expect(best.ok).toBe(true);
    expect(Array.from(best.samples)).toEqual([1, 2, 3]); // 块被拼成一整段
    expect(best.sampleRate).toBe(24000);
  });

  it("试听不受朗读开关门控，引擎不可用时不静默", async () => {
    config.readAloudEnabled = false;
    const ok = harness();
    expect(await ok.ipc.invoke("tts.preview", "balanced")).toMatchObject({
      ok: true,
    });

    const missing = harness({ available: false, installed: false });
    expect(await missing.ipc.invoke("tts.preview", "best")).toEqual({
      ok: false,
      error: "engine not installed",
    });
  });

  it("已装时 getEngineState 报 ready", async () => {
    const { ipc } = harness({ installed: true });
    expect(await ipc.invoke("tts.getEngineState")).toMatchObject({
      installed: true,
      phase: "ready",
      percent: 100,
    });
  });

  it("安装三件套：进度事件、状态查询、卸载", async () => {
    const { ipc, engine, events } = harness({ installed: false });
    expect(await ipc.invoke("tts.getEngineState")).toMatchObject({
      installed: false,
    });

    await ipc.invoke("tts.installEngine");
    await vi.waitFor(() => expect(engine.install).toHaveBeenCalledOnce());
    const phases = events
      .filter((e) => e.type === "engine")
      .map((e) => (e as { state: { phase: string } }).state.phase);
    expect(phases).toContain("downloading");
    expect(phases.at(-1)).toBe("ready");

    await ipc.invoke("tts.removeEngine");
    expect(engine.remove).toHaveBeenCalledOnce();
    expect(await ipc.invoke("tts.getEngineState")).toMatchObject({
      phase: "idle",
    });
  });

  it("预检挡住（内存不足）→ 只发一条 blockedReason，不调安装", async () => {
    const { ipc, engine, events } = harness({
      installed: false,
      available: false,
      blocked: "memory",
    });
    await ipc.invoke("tts.installEngine");
    expect(engine.install).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({
      type: "engine",
      state: { blockedReason: "memory" },
    });
  });

  it("已装时 installEngine 静默返回（渲染层会重读状态）", async () => {
    const { ipc, engine } = harness({ installed: true });
    await ipc.invoke("tts.installEngine");
    expect(engine.install).not.toHaveBeenCalled();
  });
});
