/**
 * 「最佳音质」档在 IPC 上的契约：路由、回退、打断、试听、安装三件套。
 *
 * 单独一个文件而不是塞进 `ipc.test.ts`：那边是 sherpa 三个模型的世界，这里要
 * 注入的是**引擎门面**（EngineHost）。混在一起，每个用例都得先读一屏无关替身。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const config = vi.hoisted(() => ({ voiceSpeed: undefined as number | undefined, voiceStyle: undefined as string | undefined, readAloudEnabled: true }));

vi.mock("../../main/config/config-store", () => ({
  configStore: {
    getAll: () => ({
      readAloud: { enabled: config.readAloudEnabled },
      voiceMode: {
        voiceEngineVoice: "ryan",
        voiceSpeed: config.voiceSpeed,
        voiceStyle: config.voiceStyle,
      },
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
    status?: "stopped" | "starting" | "ready" | "failed";
    /** 一块都没吐就失败（退避窗口 / 健康超时 / HTTP 失败都是这一种）。 */
    failBeforeAudio?: string;
    /** 吐过一块再失败（已经出声，不能重念）。 */
    failAfterChunk?: string;
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
    if (opts.failBeforeAudio) {
      // 一块都没吐就失败：退避窗口 / 健康超时 / HTTP 失败都是这一种
      return Promise.resolve({
        ok: false as const,
        error: opts.failBeforeAudio,
      });
    }
    o.send({
      streamId: o.streamId,
      type: "chunk",
      seq: 0,
      samples: new Float32Array([1, 2]),
      sampleRate: 24000,
    });
    if (opts.failAfterChunk) {
      return Promise.resolve({
        ok: false as const,
        error: opts.failAfterChunk,
      });
    }
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
    status: () =>
      opts.status ?? (opts.available === false ? "failed" : "ready"),
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

  it("引擎在**这次请求**里失败（还没出声）→ 同样回退均衡，不是没声音", async () => {
    const tones: (string | undefined)[] = [];
    const { ipc, streamEvents } = harness(
      { failBeforeAudio: "engine restarting" },
      (opts) => tones.push(opts?.tone),
    );

    await ipc.invoke("tts.speakStream", "你好", {
      purpose: "voice",
      tone: "best",
    });

    await vi.waitFor(() => expect(tones.length).toBe(1));
    expect(tones[0]).toBe("balanced");
    // 回退这一路要出块 + 恰好一个 done，且**没有 error**
    await vi.waitFor(() =>
      expect(streamEvents.some((e) => e.type === "done")).toBe(true),
    );
    expect(streamEvents.some((e) => e.type === "error")).toBe(false);
  });

  it("已经出过声再失败 → 只报断流，不重念半句", async () => {
    const tones: (string | undefined)[] = [];
    const { ipc, streamEvents } = harness(
      { failAfterChunk: "connection reset" },
      (opts) => tones.push(opts?.tone),
    );

    await ipc.invoke("tts.speakStream", "你好", {
      purpose: "voice",
      tone: "best",
    });

    await vi.waitFor(() =>
      expect(streamEvents.some((e) => e.type === "error")).toBe(true),
    );
    expect(streamEvents.filter((e) => e.type === "chunk")).toHaveLength(1);
    expect(streamEvents.some((e) => e.type === "done")).toBe(false);
    // 没有回退：重念一遍会换音色，比断流更难受
    expect(tones).toHaveLength(0);
  });

  it("连续崩溃被标记 failed → 状态查得出来（phase=error + status=failed）", async () => {
    const { ipc } = harness({
      installed: true,
      available: false,
      status: "failed",
    });
    expect(await ipc.invoke("tts.getEngineState")).toMatchObject({
      installed: true,
      status: "failed",
      phase: "error",
    });
  });

  it("retryEngine：不重下模型，重置失败状态并真自检", async () => {
    const { ipc, engine, events } = harness({
      installed: true,
      status: "failed",
    });

    await ipc.invoke("tts.retryEngine");

    expect(engine.host.warmup).toHaveBeenCalledOnce();
    expect(engine.install).not.toHaveBeenCalled(); // 不重下 900MB
    const phases = events
      .filter((e) => e.type === "engine")
      .map((e) => (e as { state: { phase: string } }).state.phase);
    expect(phases.at(-1)).toBe("ready");
  });

  it("retryEngine 失败 → 状态回到 error（用户还能再点一次）", async () => {
    const { ipc, engine, events } = harness({
      installed: true,
      status: "failed",
    });
    (
      engine.host.warmup as unknown as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new Error("still broken"));

    await ipc.invoke("tts.retryEngine");

    expect(events.at(-1)).toMatchObject({
      type: "engine",
      state: { phase: "error", installed: true },
    });
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

  it("最佳档的引擎调用带上设置里的语速与风格", async () => {
    // 评审抓到的 Critical：这两行没传 → 最佳档（唯一吃 instructions 的那档）
    // 收不到参数，而 set_voice 会照样回报「已生效」。
    const h = harness();
    config.voiceSpeed = 0.8;
    config.voiceStyle = "严肃低沉";

    await h.ipc.invoke("tts.speakStream", "你好", { tone: "best" });

    expect(vi.mocked(h.engine.speak)).toHaveBeenCalledWith(
      expect.objectContaining({ speed: 0.8, instructions: "严肃低沉" }),
    );
    config.voiceSpeed = undefined;
    config.voiceStyle = undefined;
  });
});
