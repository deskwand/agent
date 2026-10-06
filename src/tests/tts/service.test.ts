import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TTS_ENGLISH_MODEL_ID,
  TTS_FAST_MODEL_ID,
  TTS_MODEL_ID,
  voiceRoot,
} from "../../main/speech/installer";
import {
  getTtsService,
  resetTtsServiceCache,
  resolveTtsEngine,
} from "../../main/tts/service";
import type { TtsEngine } from "../../main/tts/tts-engine";
import type { TtsModelKey } from "../../shared/ipc-types";

afterEach(() => resetTtsServiceCache());

function engineStub(): TtsEngine {
  return {
    isLoaded: () => false,
    load: vi.fn(async () => {}),
    synthesize: vi.fn(async () => ({
      samples: new Float32Array(2),
      sampleRate: 44100,
    })),
  };
}

/**
 * 引擎是懒创建的（拿到 service 不等于造引擎，所以注册 IPC 不会去 require
 * 原生模块）。要走到 `getEngine()`，清单里得写着模型已装。
 */
function installedUserData(): string {
  const userDataPath = mkdtempSync(join(tmpdir(), "tts-svc-"));
  mkdirSync(voiceRoot(userDataPath), { recursive: true });
  writeFileSync(
    join(voiceRoot(userDataPath), "install.json"),
    JSON.stringify({
      runtimeVersion: "1.13.8",
      model: "",
      ttsModel: TTS_MODEL_ID,
      installedAt: "x",
    }),
  );
  return userDataPath;
}

describe("tts service", () => {
  it("keeps one engine per userDataPath", async () => {
    const userDataPath = installedUserData();
    const createEngine = vi.fn(engineStub);

    const first = getTtsService({ userDataPath, createEngine });
    const second = getTtsService({ userDataPath, createEngine });

    expect(second).toBe(first);
    await second.load();
    await first.load();
    expect(createEngine).toHaveBeenCalledTimes(1); // 第二次没有再造一个引擎
  });

  it("refuses to speak when the model is not installed", async () => {
    const service = getTtsService({
      userDataPath: mkdtempSync(join(tmpdir(), "tts-svc-")),
      createEngine: engineStub,
    });
    await expect(service.speak("你好")).resolves.toEqual({
      ok: false,
      error: "model not installed",
    });
  });
});

/** 两个模型都装：路由与转写都走得到。 */
function installedBothModels(): string {
  const userDataPath = mkdtempSync(join(tmpdir(), "tts-svc-"));
  mkdirSync(voiceRoot(userDataPath), { recursive: true });
  writeFileSync(
    join(voiceRoot(userDataPath), "install.json"),
    JSON.stringify({
      runtimeVersion: "1.13.8",
      model: "",
      ttsModel: TTS_MODEL_ID,
      ttsEnglishModel: TTS_ENGLISH_MODEL_ID,
      installedAt: "x",
    }),
  );
  return userDataPath;
}

/** 只装英文：只有英文段落能读，中文段落必须明确报错。 */
function englishOnlyUserData(): string {
  const userDataPath = mkdtempSync(join(tmpdir(), "tts-svc-"));
  mkdirSync(voiceRoot(userDataPath), { recursive: true });
  writeFileSync(
    join(voiceRoot(userDataPath), "install.json"),
    JSON.stringify({
      runtimeVersion: "1.13.8",
      model: "",
      ttsEnglishModel: TTS_ENGLISH_MODEL_ID,
      installedAt: "x",
    }),
  );
  return userDataPath;
}

/** 只关心"哪个引擎收到了什么文本"，所以假引擎只记账。 */
const recordingEngine =
  (seen: string[]) =>
  (engine: TtsModelKey): TtsEngine => ({
    isLoaded: () => true,
    load: async () => {},
    synthesize: async (text: string) => {
      seen.push(`${engine}:${text}`);
      return { samples: new Float32Array(1), sampleRate: 44100 };
    },
  });

describe("per-engine installation gate", () => {
  it("isInstalled is per engine", () => {
    const service = getTtsService({ userDataPath: installedUserData() });
    expect(service.isInstalled("zh")).toBe(true);
    expect(service.isInstalled()).toBe(true); // 默认 = 中文，保持今天的语义
    expect(service.isInstalled("en")).toBe(false);
  });

  it("falls back to Chinese when the English model is missing", async () => {
    const seen: string[] = [];
    const service = getTtsService({
      userDataPath: installedUserData(),
      createEngine: recordingEngine(seen),
    });
    await expect(service.speak("The build failed.")).resolves.toMatchObject({
      ok: true,
    });
    expect(seen).toEqual(["zh:The build failed."]);
  });

  it("works with only the English model installed", async () => {
    const seen: string[] = [];
    const service = getTtsService({
      userDataPath: englishOnlyUserData(),
      createEngine: recordingEngine(seen),
    });
    await expect(service.speak("The build failed.")).resolves.toMatchObject({
      ok: true,
    });
    expect(seen).toEqual(["en:The build failed."]);
    // 只装英文时中文段落必须明确报错，不能静默
    await expect(service.speak("构建失败了。")).resolves.toEqual({
      ok: false,
      error: "model not installed",
    });
  });

  it("routes English to the English engine and expands digits first", async () => {
    const seen: string[] = [];
    const service = getTtsService({
      userDataPath: installedBothModels(),
      createEngine: recordingEngine(seen),
    });
    await service.speak("Version 1.0.47 is ready now.");
    await service.speak("运行 npm install 安装依赖。");
    expect(seen).toEqual([
      "en:Version one point zero point four seven is ready now.",
      "zh:运行 npm install 安装依赖。",
    ]);
  });

  it("routes on the raw text, so digit expansion cannot flip the decision", async () => {
    const seen: string[] = [];
    const service = getTtsService({
      userDataPath: installedBothModels(),
      createEngine: recordingEngine(seen),
    });
    await service.speak("12"); // 转写后是 "twelve"（英文），但原始文本无字母 → 中文
    expect(seen).toEqual(["zh:12"]);
  });

  it("can be forced to an engine for the install self-check", async () => {
    const seen: string[] = [];
    const service = getTtsService({
      userDataPath: installedBothModels(),
      createEngine: recordingEngine(seen),
    });
    await service.speak("This is a test.", { engine: "en" });
    expect(seen).toEqual(["en:This is a test."]);
  });

  it("refuses a forced engine whose model is missing", async () => {
    // 自检必须真跑到那个引擎上：装英文后强制 en 而 en 没装成，就该报错而不是悄悄用中文
    const seen: string[] = [];
    const service = getTtsService({
      userDataPath: installedUserData(),
      createEngine: recordingEngine(seen),
    });
    await expect(
      service.speak("This is a test.", { engine: "en" }),
    ).resolves.toEqual({ ok: false, error: "model not installed" });
    expect(seen).toEqual([]);
  });

  it("keeps the 'model not installed' error string the tool matches on", async () => {
    const service = getTtsService({
      userDataPath: mkdtempSync(join(tmpdir(), "tts-svc-")),
      createEngine: engineStub,
    });
    await expect(service.speak("hello there")).resolves.toEqual({
      ok: false,
      error: "model not installed",
    });
  });
});

/** 三个模型全装：软偏好与回退都跑得到。 */
function installedAllModels(): string {
  const userDataPath = mkdtempSync(join(tmpdir(), "tts-svc-"));
  mkdirSync(voiceRoot(userDataPath), { recursive: true });
  writeFileSync(
    join(voiceRoot(userDataPath), "install.json"),
    JSON.stringify({
      runtimeVersion: "1.13.8",
      model: "",
      ttsModel: TTS_MODEL_ID,
      ttsEnglishModel: TTS_ENGLISH_MODEL_ID,
      ttsFastModel: TTS_FAST_MODEL_ID,
      installedAt: "x",
    }),
  );
  return userDataPath;
}

describe("prefer (语音模式的高速音色)", () => {
  it("uses the fast voice for every sentence", async () => {
    // 语音模式传 prefer，所以中英文两句都该落在 matcha 上，不走语言路由
    const seen: string[] = [];
    const service = getTtsService({
      userDataPath: installedAllModels(),
      createEngine: recordingEngine(seen),
    });
    await service.speak("运行 npm install 安装依赖。", { prefer: "matcha" });
    await service.speak("The build failed.", { prefer: "matcha" });
    expect(seen).toEqual([
      "matcha:运行 npm install 安装依赖。",
      "matcha:The build failed.",
    ]);
  });

  it("does not expand English digits on the fast voice", async () => {
    // 数字转写是给英文 MeloTTS 模型补的（它包里一个 .fst 都没有）；matcha 自带三个 -zh.fst
    const seen: string[] = [];
    const service = getTtsService({
      userDataPath: installedAllModels(),
      createEngine: recordingEngine(seen),
    });
    await service.speak("Version 1.0.47 is ready now.", { prefer: "matcha" });
    expect(seen).toEqual(["matcha:Version 1.0.47 is ready now."]);
  });

  it("falls back to the routed engine when the fast voice is missing", async () => {
    const seen: string[] = [];
    const service = getTtsService({
      userDataPath: installedBothModels(),
      createEngine: recordingEngine(seen),
    });
    await service.speak("The build failed.", { prefer: "matcha" });
    await service.speak("构建失败了。", { prefer: "matcha" });
    expect(seen).toEqual(["en:The build failed.", "zh:构建失败了。"]);
  });

  it("reports an error when neither the fast voice nor its fallback is installed", async () => {
    const seen: string[] = [];
    const service = getTtsService({
      userDataPath: englishOnlyUserData(),
      createEngine: recordingEngine(seen),
    });
    await expect(
      service.speak("构建失败了。", { prefer: "matcha" }),
    ).resolves.toEqual({ ok: false, error: "model not installed" });
    expect(seen).toEqual([]);
  });

  it("keeps engine a hard choice, so the self-check still fails loudly", async () => {
    // engine 是硬指定（安装自检用），prefer 不得改掉它的语义：
    // 半装的模型必须报错才能被 ipc.ts 那一段撤掉。
    const seen: string[] = [];
    const service = getTtsService({
      userDataPath: installedBothModels(),
      createEngine: recordingEngine(seen),
    });
    await expect(service.speak("test", { engine: "matcha" })).resolves.toEqual({
      ok: false,
      error: "model not installed",
    });
    expect(seen).toEqual([]);
  });

  it("lets engine win when both engine and prefer are given", async () => {
    // 优先级也是规则的一部分：ipc 那道日志开关的门控按"最终用哪个引擎"判，
    // 它读的就是这条规则（resolveTtsEngine）。
    const seen: string[] = [];
    const service = getTtsService({
      userDataPath: installedAllModels(),
      createEngine: recordingEngine(seen),
    });
    await service.speak("The build failed.", {
      engine: "en",
      prefer: "matcha",
    });
    expect(seen).toEqual(["en:The build failed."]);
  });
});

/**
 * 三档音色的解析规则。`tone` 是设置页那一栏的语义；`prefer` 是它的前身，
 * 两者并存（老调用点还在传 prefer）。
 */
describe("tone 解析", () => {
  const installedAll = () => true;
  const installedNone = () => false;

  it("fast → matcha（装了才用，没装回落到路由）", () => {
    expect(resolveTtsEngine("你好", { tone: "fast" }, installedAll)).toBe(
      "matcha",
    );
    // 没装 matcha 就不硬点它，交给按文本路由
    const onlyEnglishInstalled = (engine?: TtsModelKey) => engine === "en";
    expect(
      resolveTtsEngine("hello there", { tone: "fast" }, onlyEnglishInstalled),
    ).toBe("en");
    // 路由到的也没装 → 退回 zh，由调用方报"未安装"（不在这里悄悄降级）
    expect(
      resolveTtsEngine("hello there", { tone: "fast" }, installedNone),
    ).toBe("zh");
  });

  it("balanced → 按文本路由（与不传 tone 等价）", () => {
    expect(resolveTtsEngine("你好", { tone: "balanced" }, installedAll)).toBe(
      "zh",
    );
    expect(
      resolveTtsEngine("hello there", { tone: "balanced" }, installedAll),
    ).toBe("en");
  });

  it("best → engine（不是 sherpa 的模型键）", () => {
    expect(resolveTtsEngine("你好", { tone: "best" }, installedAll)).toBe(
      "engine",
    );
    // 引擎是流式专属：整句那条路不支持，直接说明白，不假装能跑
    expect(resolveTtsEngine("你好", { tone: "best" }, installedNone)).toBe(
      "engine",
    );
  });

  it("engine 硬指定优先于 tone（自检要钉死自己那份）", () => {
    expect(
      resolveTtsEngine("你好", { engine: "en", tone: "best" }, installedAll),
    ).toBe("en");
  });

  it("tone 优先于 prefer（新的语义赢）", () => {
    expect(
      resolveTtsEngine("你好", { tone: "fast", prefer: "zh" }, installedAll),
    ).toBe("matcha");
  });
});

describe("整句 API 与引擎档", () => {
  it("tone=best 走整句 API 时报错，而不是假装支持", async () => {
    const userDataPath = installedUserData();
    const service = getTtsService({ userDataPath, createEngine: engineStub });
    const result = await service.speak("你好", { tone: "best" });
    expect(result).toEqual({
      ok: false,
      error: "engine requires streaming",
    });
  });
});
