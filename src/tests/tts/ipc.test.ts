import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const config = vi.hoisted(() => ({
  tone: "balanced" as "fast" | "balanced" | "best",
  voiceSpeed: undefined as number | undefined,
  voiceStyle: undefined as string | undefined,
}));

vi.mock("../../main/config/config-store", () => ({
  configStore: {
    getAll: () => ({
      voiceMode: {
        tone: config.tone,
        voiceSpeed: config.voiceSpeed,
        voiceStyle: config.voiceStyle,
      },
    }),
  },
}));
import {
  TTS_ENGLISH_MODEL_ID,
  TTS_FAST_MODEL_ID,
  TTS_MODEL_ID,
  voiceRoot,
} from "../../main/speech/installer";
import type { TtsModelId } from "../../main/speech/installer";
import { registerTtsIpc } from "../../main/tts/ipc";
import type { TtsService } from "../../main/tts/service";
import type {
  TtsEvent,
  TtsModelKey,
  TtsStreamEvent,
} from "../../shared/ipc-types";

/** 极简的 ipcMain 替身：只记 handler，由测试自己调用。 */
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

function installedUserData(): string {
  const userData = mkdtempSync(join(tmpdir(), "tts-ipc-"));
  mkdirSync(join(voiceRoot(userData), "models", TTS_MODEL_ID), {
    recursive: true,
  });
  writeFileSync(
    join(voiceRoot(userData), "install.json"),
    JSON.stringify({
      runtimeVersion: "1.13.8",
      model: "x-asr-480ms-zh-en-punct-int8",
      ttsModel: TTS_MODEL_ID,
      installedAt: "x",
    }),
  );
  return userData;
}

function serviceStub(overrides: Partial<TtsService> = {}): TtsService {
  return {
    isInstalled: (engine: TtsModelKey = "zh") => engine === "zh",
    load: vi.fn(async () => {}),
    speak: vi.fn(async (_text: string, opts?: { engine?: TtsModelKey }) => ({
      ok: true as const,
      samples: new Float32Array([0.1, 0.2]),
      sampleRate: 44100,
      engine: opts?.engine ?? "zh",
    })),
    ...overrides,
  } as TtsService;
}

const specFixture = () => ({
  modelUrl: "u",
  modelSha256: "h",
  nodeSha256: "h",
  runtimeSha256: { "darwin-arm64": "h" },
  ttsModelUrl: "u",
  ttsModelSha256: "h",
  ttsEnglishModelUrl: "u",
  ttsEnglishModelSha256: "h",
  ttsFastModelUrl: "u-fast",
  ttsFastModelSha256: "h-fast",
});

/**
 * 模型 id → 键。写这两行映射的常量，别用三元式：
 * 上一版是 `id === TTS_ENGLISH_MODEL_ID ? "en" : "zh"`，加第三个模型后 matcha 会静默变 zh。
 */
const MODEL_ID_TO_KEY: Record<TtsModelId, TtsModelKey> = {
  [TTS_MODEL_ID]: "zh",
  [TTS_ENGLISH_MODEL_ID]: "en",
  [TTS_FAST_MODEL_ID]: "matcha",
};

/**
 * 按模型安装要写 7 条用例，逐条手搭 registerTtsIpc 的参数太啰嗦。
 * `installed` 用集合模拟磁盘状态：装/删会改它，`service.isInstalled` 读它。
 */
function harness(
  options: {
    installed?: TtsModelKey[];
    selfCheck?: Partial<Record<TtsModelKey, "ok" | "fail">>;
    runtimeInstalled?: boolean;
    /** 流式用例自带一个会吐块的 speak。不给就用下面那个普通替身。 */
    speak?: TtsService["speak"];
  } = {},
) {
  const installed = new Set<TtsModelKey>(options.installed ?? []);
  const userDataPath = mkdtempSync(join(tmpdir(), "tts-ipc-"));
  const events: TtsEvent[] = [];
  const streamEvents: TtsStreamEvent[] = [];

  const installRuntime = vi.fn(async () => {});
  const installTtsModel = vi.fn(async (opts: { model: TtsModelId }) => {
    installed.add(MODEL_ID_TO_KEY[opts.model]);
  });
  const removeTtsModel = vi.fn((_path: string, model: TtsModelId) => {
    installed.delete(MODEL_ID_TO_KEY[model]);
  });
  const speak: TtsService["speak"] =
    options.speak ??
    vi.fn(async (_text: string, opts?: { engine?: TtsModelKey }) =>
      options.selfCheck?.[opts?.engine ?? "zh"] === "fail"
        ? { ok: false as const, error: "self check failed" }
        : {
            ok: true as const,
            samples: new Float32Array(1),
            sampleRate: 44100,
          },
    );
  const service: TtsService = {
    isInstalled: (engine: TtsModelKey = "zh") => installed.has(engine),
    load: vi.fn(async () => {}),
    speak,
  };

  const ipc = fakeIpcMain();
  const handle = registerTtsIpc({
    ipcMain: ipc as never,
    deps: {
      userDataPath,
      // 收**整个事件**：断言要看 model
      sendEvent: (event) => events.push(event),
      sendStream: (event) => streamEvents.push(event),
      service,
      installDeps: {
        readSpec: specFixture,
        installRuntime,
        installTtsModel,
        removeTtsModel,
      },
    },
  });
  return {
    ipc,
    events,
    streamEvents,
    speak,
    installRuntime,
    installTtsModel,
    removeTtsModel,
    userDataPath,
    dispose: () => handle.dispose(),
  };
}

describe("registerTtsIpc", () => {
  beforeEach(() => {});

  it("reports each model's state separately", async () => {
    const ipc = fakeIpcMain();
    registerTtsIpc({
      ipcMain: ipc as never,
      deps: {
        userDataPath: installedUserData(),
        sendEvent: vi.fn(),
        sendStream: vi.fn(),
        service: serviceStub(),
      },
    });
    const states = (await ipc.invoke("tts.getInstallState")) as {
      zh: { installed: boolean };
      en: { installed: boolean };
    };
    expect(states.zh.installed).toBe(true);
    expect(states.en.installed).toBe(false);
  });

  it("synthesizes through the injected service", async () => {
    const ipc = fakeIpcMain();
    registerTtsIpc({
      ipcMain: ipc as never,
      deps: {
        userDataPath: installedUserData(),
        sendEvent: vi.fn(),
        sendStream: vi.fn(),
        service: serviceStub(),
      },
    });
    const result = (await ipc.invoke("tts.speak", "你好")) as {
      ok: boolean;
      sampleRate: number;
    };
    expect(result.ok).toBe(true);
    expect(result.sampleRate).toBe(44100);
  });

  it("returns ok:false instead of throwing when synthesis fails", async () => {
    const ipc = fakeIpcMain();
    registerTtsIpc({
      ipcMain: ipc as never,
      deps: {
        userDataPath: installedUserData(),
        sendEvent: vi.fn(),
        sendStream: vi.fn(),
        service: serviceStub({
          speak: vi.fn(async () => ({
            ok: false as const,
            error: "model file missing",
          })),
        }),
      },
    });
    const result = (await ipc.invoke("tts.speak", "你好")) as {
      ok: boolean;
      error?: string;
    };
    expect(result.ok).toBe(false);
    expect(result.error).toContain("missing");
  });

  it("removes only the requested model", async () => {
    const userData = installedUserData();
    mkdirSync(join(voiceRoot(userData), "runtime", "1.13.8"), {
      recursive: true,
    });
    const ipc = fakeIpcMain();
    registerTtsIpc({
      ipcMain: ipc as never,
      deps: {
        userDataPath: userData,
        sendEvent: vi.fn(),
        sendStream: vi.fn(),
        service: serviceStub(),
      },
    });

    await ipc.invoke("tts.removeInstall", "zh");

    expect(existsSync(join(voiceRoot(userData), "models", TTS_MODEL_ID))).toBe(
      false,
    );
    // 运行时不受影响 —— 它被语音输入共享
    expect(existsSync(join(voiceRoot(userData), "runtime", "1.13.8"))).toBe(
      true,
    );
  });

  it("fails the install when the engine cannot load (install-time self check)", async () => {
    // 装完立刻自检：平台不兼容要让用户在下完 157MB 的那一刻就知道，
    // 而不是点朗读时才发现。
    const { ipc, events, removeTtsModel, userDataPath } = harness({
      selfCheck: { zh: "fail" },
    });

    await ipc.invoke("tts.install", "zh");

    expect(events.at(-1)?.state.phase).toBe("error");
    expect(events.at(-1)?.state.error).toContain("self check");
    // 自检失败要把刚装的东西撤掉：留着清单会让重试被 isInstalled() 挡住，
    // 用户既用不了也修不了。
    expect(removeTtsModel).toHaveBeenCalledWith(userDataPath, TTS_MODEL_ID);
  });

  it("朗读与语音对话按同一份配置：设置里的档位对朗读也生效", async () => {
    // 朗读调用点从不传 tone（那是语音对话那边的活）。档位必须在主进程按设置补齐，
    // 否则卡片上那句"朗读与语音对话共用"就是假的：朗读会退回按文本路由。
    const { ipc, speak } = harness({ installed: ["zh"] });
    config.tone = "fast";

    await ipc.invoke("tts.speak", "你好");

    expect(speak).toHaveBeenCalledWith("你好", { tone: "fast" });
  });

  it("语速与风格也由配置补进 opts；显式值优先；没配就不出现", async () => {
    const { ipc, speak } = harness({ installed: ["zh"] });
    config.tone = "balanced";
    config.voiceSpeed = 0.8;
    config.voiceStyle = "严肃低沉";

    await ipc.invoke("tts.speak", "你好");
    expect(speak).toHaveBeenCalledWith(
      "你好",
      expect.objectContaining({
        tone: "balanced",
        speed: 0.8,
        instructions: "严肃低沉",
      }),
    );

    // 显式传入优先：工具与自检走这条路，不该被设置覆盖
    const speakMock = vi.mocked(speak);
    speakMock.mockClear();
    await ipc.invoke("tts.speak", "你好", {
      speed: 1.5,
      instructions: "别的风格",
    });
    expect(speak).toHaveBeenCalledWith(
      "你好",
      expect.objectContaining({ speed: 1.5, instructions: "别的风格" }),
    );

    // 没配就不该出现这两个键，否则每个请求都被塞进无意义参数
    config.voiceSpeed = undefined;
    config.voiceStyle = undefined;
    speakMock.mockClear();
    await ipc.invoke("tts.speak", "你好");
    const opts = speakMock.mock.calls.at(-1)?.[1] as Record<string, unknown>;
    expect("speed" in opts).toBe(false);
    expect("instructions" in opts).toBe(false);
  });

  it("朗读档位必须到合成分支（stream 路径 —— 朗读唯一走的那条）", async () => {
    // 评审抓到的回归：`withTone` 只喂了自动安装，合成分支仍看原始 opts，
    // 于是设置里的档位对朗读完全无效（最坏：下完 matcha 再报 model not installed）。
    const { ipc, speak } = harness({ installed: ["zh", "matcha"] });
    config.tone = "fast";

    await ipc.invoke("tts.speakStream", "你好", undefined);

    expect(speak).toHaveBeenCalledWith(
      "你好",
      expect.objectContaining({ tone: "fast" }),
      expect.any(Function),
    );
  });

  it("朗读缺英文模型时自动补装；最佳档绝不自动下载", async () => {
    const { ipc, installTtsModel } = harness({ installed: ["zh"] });
    // 档位会影响路由：这里要验的是"按文本路由到 en"，所以先固定成均衡
    config.tone = "balanced";

    // 英文句子本该用 en。它没装 → 先装再合成，而不是静默退回中文音色。
    await ipc.invoke("tts.speak", "Hello world, this is an English sentence.");
    expect(installTtsModel).toHaveBeenCalledTimes(1);
    expect(installTtsModel.mock.calls[0][0]).toMatchObject({
      model: TTS_ENGLISH_MODEL_ID,
    });

    // 900MB 的最佳档是用户显式安装的东西，任何路径都不许静默下载
    installTtsModel.mockClear();
    await ipc.invoke("tts.speakStream", "随便一句中文。", { tone: "best" });
    expect(installTtsModel).not.toHaveBeenCalled();
  });

  it("disposes every channel", () => {
    const ipc = fakeIpcMain();
    const handle = registerTtsIpc({
      ipcMain: ipc as never,
      deps: {
        userDataPath: installedUserData(),
        sendEvent: vi.fn(),
        sendStream: vi.fn(),
        service: serviceStub(),
      },
    });
    handle.dispose();
    expect(() => ipc.invoke("tts.getInstallState")).toThrow("no handler");
  });
});

describe("per-model install channels", () => {
  beforeEach(() => {});

  it("installs each model independently and reports per-model state", async () => {
    const { ipc, events } = harness();
    await ipc.invoke("tts.install", "en");
    expect(events.at(-1)).toMatchObject({
      model: "en",
      state: { phase: "ready" },
    });
    const states = (await ipc.invoke("tts.getInstallState")) as {
      zh: { installed: boolean };
      en: { installed: boolean };
    };
    expect(states.en.installed).toBe(true);
    expect(states.zh.installed).toBe(false);
  });

  it("does not let the Chinese model block the English install", async () => {
    // 今天的守卫会直接 return（静默无反应），这条就是防它
    const { ipc, installTtsModel } = harness({ installed: ["zh"] });
    await ipc.invoke("tts.install", "en");
    expect(installTtsModel).toHaveBeenCalledTimes(1);
  });

  it("installs the shared runtime once when both models start together", async () => {
    // 首次使用两行都点：两次 installRuntime 会往同一目录解包、还会互删临时文件
    const { ipc, installRuntime } = harness();
    await Promise.all([
      ipc.invoke("tts.install", "zh"),
      ipc.invoke("tts.install", "en"),
    ]);
    expect(installRuntime).toHaveBeenCalledTimes(1);
  });

  it("guards concurrent installs per model", async () => {
    const { ipc, installTtsModel } = harness();
    await Promise.all([
      ipc.invoke("tts.install", "en"),
      ipc.invoke("tts.install", "en"),
    ]);
    expect(installTtsModel).toHaveBeenCalledTimes(1);
  });

  it("rejects an unknown model key", async () => {
    const { ipc, installTtsModel } = harness();
    await ipc.invoke("tts.install", "fr");
    expect(installTtsModel).not.toHaveBeenCalled();
  });

  it("rolls back only the model whose self-check failed", async () => {
    const { ipc, removeTtsModel } = harness({ selfCheck: { en: "fail" } });
    await ipc.invoke("tts.install", "en");
    expect(removeTtsModel).toHaveBeenCalledWith(
      expect.any(String),
      TTS_ENGLISH_MODEL_ID,
    );
    expect(removeTtsModel).not.toHaveBeenCalledWith(
      expect.any(String),
      TTS_MODEL_ID,
    );
  });

  it("uses an explicit engine for each self-check", async () => {
    const first = harness();
    await first.ipc.invoke("tts.install", "en");
    expect(first.speak).toHaveBeenCalledWith("This is a test.", {
      engine: "en",
    });
    first.dispose();

    const second = harness();
    await second.ipc.invoke("tts.install", "zh");
    expect(second.speak).toHaveBeenCalledWith("语音引擎自检。", {
      engine: "zh",
    });
  });

  it("treats a legacy manifest with no English field as not installed", async () => {
    // 老用户的 install.json 里没有 ttsEnglishModel：缺字段 = 未装
    const { ipc } = harness({ installed: ["zh"] });
    const states = (await ipc.invoke("tts.getInstallState")) as {
      en: { installed: boolean };
    };
    expect(states.en.installed).toBe(false);
  });

  it("installs the fast voice from its own coordinate", async () => {
    const { ipc, installTtsModel } = harness();
    await ipc.invoke("tts.install", "matcha");
    expect(installTtsModel).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "u-fast",
        sha256: "h-fast",
        model: TTS_FAST_MODEL_ID,
      }),
    );
  });

  it("self-checks the fast voice on its own engine", async () => {
    const { ipc, speak } = harness();
    await ipc.invoke("tts.install", "matcha");
    // 自检句带数字与英文词：数字走 -zh.fst，英文走 espeak-ng-data。
    // 后者彻底缺失时原生层会在合成时 exit 255 —— 自检要把它折到安装时。
    expect(speak).toHaveBeenCalledWith(
      "语音引擎自检，共 12 个字。English too.",
      {
        engine: "matcha",
      },
    );
  });

  it("rolls back the fast voice alone when its self-check fails", async () => {
    const { ipc, removeTtsModel } = harness({ selfCheck: { matcha: "fail" } });
    await ipc.invoke("tts.install", "matcha");
    expect(removeTtsModel).toHaveBeenCalledWith(
      expect.any(String),
      TTS_FAST_MODEL_ID,
    );
  });

  it("reports the fast voice install state", async () => {
    const { ipc } = harness({ installed: ["matcha"] });
    const states = (await ipc.invoke("tts.getInstallState")) as {
      zh: { installed: boolean };
      matcha: { installed: boolean };
    };
    expect(states.matcha.installed).toBe(true);
    expect(states.zh.installed).toBe(false);
  });
});
