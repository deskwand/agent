import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TTS_MODEL_ID, voiceRoot } from "../../main/speech/installer";
import { getTtsService, resetTtsServiceCache } from "../../main/tts/service";
import type { TtsEngine } from "../../main/tts/tts-engine";

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
