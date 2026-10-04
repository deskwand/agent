import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const config = vi.hoisted(() => ({ readAloudEnabled: true }));

vi.mock("../../main/config/config-store", () => ({
  configStore: {
    getAll: () => ({ readAloud: { enabled: config.readAloudEnabled } }),
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
import type { TtsEvent, TtsModelKey } from "../../shared/ipc-types";

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
  } = {},
) {
  const installed = new Set<TtsModelKey>(options.installed ?? []);
  const userDataPath = mkdtempSync(join(tmpdir(), "tts-ipc-"));
  const events: TtsEvent[] = [];

  const installRuntime = vi.fn(async () => {});
  const installTtsModel = vi.fn(async (opts: { model: TtsModelId }) => {
    installed.add(MODEL_ID_TO_KEY[opts.model]);
  });
  const removeTtsModel = vi.fn((_path: string, model: TtsModelId) => {
    installed.delete(MODEL_ID_TO_KEY[model]);
  });
  const speak = vi.fn(async (_text: string, opts?: { engine?: TtsModelKey }) =>
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
    speak,
    installRuntime,
    installTtsModel,
    removeTtsModel,
    userDataPath,
    dispose: () => handle.dispose(),
  };
}

describe("registerTtsIpc", () => {
  beforeEach(() => {
    config.readAloudEnabled = true;
  });

  it("reports each model's state separately", async () => {
    const ipc = fakeIpcMain();
    registerTtsIpc({
      ipcMain: ipc as never,
      deps: {
        userDataPath: installedUserData(),
        sendEvent: vi.fn(),
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

  it("refuses to speak when the capability is switched off", async () => {
    // 设置卡只管下载是不够的：关掉开关必须真的不干活（设计 §6.1 验收第 4 条）
    config.readAloudEnabled = false;
    const ipc = fakeIpcMain();
    const speak = vi.fn(async () => ({
      ok: true as const,
      samples: new Float32Array(1),
      sampleRate: 44100,
    }));
    registerTtsIpc({
      ipcMain: ipc as never,
      deps: {
        userDataPath: installedUserData(),
        sendEvent: vi.fn(),
        service: serviceStub({ speak }),
      },
    });

    const result = (await ipc.invoke("tts.speak", "你好")) as {
      ok: boolean;
      error?: string;
    };

    expect(result.ok).toBe(false);
    expect(result.error).toContain("disabled");
    expect(speak).not.toHaveBeenCalled();
  });

  it("disposes every channel", () => {
    const ipc = fakeIpcMain();
    const handle = registerTtsIpc({
      ipcMain: ipc as never,
      deps: {
        userDataPath: installedUserData(),
        sendEvent: vi.fn(),
        service: serviceStub(),
      },
    });
    handle.dispose();
    expect(() => ipc.invoke("tts.getInstallState")).toThrow("no handler");
  });
});

describe("per-model install channels", () => {
  beforeEach(() => {
    config.readAloudEnabled = true;
  });

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

describe("speak 与朗读开关", () => {
  beforeEach(() => {
    config.readAloudEnabled = false;
  });

  it("passes prefer through to the service", async () => {
    const { ipc, speak } = harness({ installed: ["matcha"] });
    await ipc.invoke("tts.speak", "你好", { prefer: "matcha" });
    expect(speak).toHaveBeenCalledWith("你好", { prefer: "matcha" });
  });

  it("lets an installed fast voice speak while 朗读 is switched off", async () => {
    // 朗读开关是朗读那条路的总闸。语音模式的音色是用户单独下的，两者不能互相锁死：
    // 否则"装了音色、没开朗读"的语音模式会是静音。
    const { ipc, speak } = harness({ installed: ["matcha"] });
    const result = await ipc.invoke("tts.speak", "你好", {
      prefer: "matcha",
    });
    expect(result).toMatchObject({ ok: true });
    expect(speak).toHaveBeenCalled();
  });

  it("still refuses when the fast voice is missing", async () => {
    // 没装 matcha 时这次调用会回退到朗读的模型 —— 那就该被开关拦住，
    // 不然"关掉开关就不加载引擎"的承诺就空了。
    const { ipc, speak } = harness({ installed: ["zh"] });
    const result = await ipc.invoke("tts.speak", "你好", {
      prefer: "matcha",
    });
    expect(result).toEqual({ ok: false, error: "read aloud disabled" });
    expect(speak).not.toHaveBeenCalled();
  });

  it("gates on the engine that will really be used, not on prefer alone", async () => {
    // engine 是硬指定，它压过 prefer。所以这一句实际会用 zh —— 而 zh 归朗读开关管。
    // 门控只看 prefer 的话这里会放行，朗读关掉却照念朗读模型。
    const { ipc, speak } = harness({ installed: ["zh", "matcha"] });
    const result = await ipc.invoke("tts.speak", "你好", {
      prefer: "matcha",
      engine: "zh",
    });
    expect(result).toEqual({ ok: false, error: "read aloud disabled" });
    expect(speak).not.toHaveBeenCalled();
  });

  it("still refuses an ordinary read-aloud call", async () => {
    const { ipc, speak } = harness({ installed: ["zh"] });
    const result = await ipc.invoke("tts.speak", "你好");
    expect(result).toEqual({ ok: false, error: "read aloud disabled" });
    expect(speak).not.toHaveBeenCalled();
  });
});
