import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EMOTION_MODEL_ID,
  EMOTION_RUNTIME_VERSION,
  emotionRoot,
  isEmotionInstalled,
  modelDir,
  readEmotionManifest,
  runtimeDir,
} from "../../main/voice/emotion/installer";

function writeManifest(userDataPath: string, value: unknown) {
  mkdirSync(emotionRoot(userDataPath), { recursive: true });
  writeFileSync(
    join(emotionRoot(userDataPath), "install.json"),
    JSON.stringify(value),
  );
}

describe("情感安装器", () => {
  it("没有清单时视为未装", () => {
    const dir = mkdtempSync(join(tmpdir(), "emotion-installer-"));
    expect(readEmotionManifest(dir)).toBeNull();
    expect(isEmotionInstalled(dir)).toBe(false);
  });

  it("版本、模型与磁盘文件都齐才算装好", () => {
    const dir = mkdtempSync(join(tmpdir(), "emotion-installer-"));
    writeManifest(dir, {
      version: EMOTION_RUNTIME_VERSION,
      model: EMOTION_MODEL_ID,
    });
    mkdirSync(join(runtimeDir(dir), "node_modules", "onnxruntime-node"), {
      recursive: true,
    });
    mkdirSync(modelDir(dir), { recursive: true });
    writeFileSync(join(modelDir(dir), "emotion2vec.int8.onnx"), "x");
    expect(isEmotionInstalled(dir)).toBe(true);
  });

  it("半装（只有模型、或只有运行时）算未装", () => {
    const onlyModel = mkdtempSync(join(tmpdir(), "emotion-installer-"));
    writeManifest(onlyModel, {
      version: EMOTION_RUNTIME_VERSION,
      model: EMOTION_MODEL_ID,
    });
    mkdirSync(modelDir(onlyModel), { recursive: true });
    writeFileSync(join(modelDir(onlyModel), "emotion2vec.int8.onnx"), "x");
    expect(isEmotionInstalled(onlyModel)).toBe(false);

    const onlyRuntime = mkdtempSync(join(tmpdir(), "emotion-installer-"));
    writeManifest(onlyRuntime, {
      version: EMOTION_RUNTIME_VERSION,
      model: EMOTION_MODEL_ID,
    });
    mkdirSync(
      join(runtimeDir(onlyRuntime), "node_modules", "onnxruntime-node"),
      {
        recursive: true,
      },
    );
    expect(isEmotionInstalled(onlyRuntime)).toBe(false);
  });
});
