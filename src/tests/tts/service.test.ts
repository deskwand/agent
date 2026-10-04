import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TTS_ENGLISH_MODEL_ID,
  TTS_MODEL_ID,
  voiceRoot,
} from "../../main/speech/installer";
import { getTtsService, resetTtsServiceCache } from "../../main/tts/service";
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
