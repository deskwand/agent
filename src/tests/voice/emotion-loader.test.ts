import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { loadEmotionRecognizer } from "../../main/voice/emotion/engine";
import {
  EMOTION_MODEL_ID,
  EMOTION_RUNTIME_VERSION,
  emotionRoot,
} from "../../main/voice/emotion/installer";

describe("情感识别器装配", () => {
  it("未安装时不加载 ORT，返回的识别器永远 null", async () => {
    const dir = mkdtempSync(join(tmpdir(), "emotion-loader-"));
    const importOrt = vi.fn();
    const engine = loadEmotionRecognizer(dir, { importOrt });
    await expect(
      engine.recognize(new Int16Array(16000), 10),
    ).resolves.toBeNull();
    expect(importOrt).not.toHaveBeenCalled();
  });

  it("装好时从运行时目录动态 import，并把归一化后的样本喂给会话", async () => {
    const dir = mkdtempSync(join(tmpdir(), "emotion-loader-"));
    mkdirSync(emotionRoot(dir), { recursive: true });
    writeFileSync(
      join(emotionRoot(dir), "install.json"),
      JSON.stringify({
        version: EMOTION_RUNTIME_VERSION,
        model: EMOTION_MODEL_ID,
      }),
    );
    mkdirSync(
      join(
        dir,
        "emotion",
        "runtime",
        EMOTION_RUNTIME_VERSION,
        "node_modules",
        "onnxruntime-node",
      ),
      { recursive: true },
    );
    mkdirSync(join(dir, "emotion", "models", EMOTION_MODEL_ID), {
      recursive: true,
    });
    writeFileSync(
      join(dir, "emotion", "models", EMOTION_MODEL_ID, "emotion2vec.int8.onnx"),
      "x",
    );

    const run = vi.fn(async () => ({
      probabilities: {
        data: Float32Array.from([0, 0, 0, 0, 0, 0, 0.8, 0, 0]),
        dims: [1, 9],
      },
    }));
    const importOrt = vi.fn(async () => ({
      InferenceSession: { create: async () => ({ run }) },
      Tensor: class {},
    }));
    const engine = loadEmotionRecognizer(dir, { importOrt });
    const signal = await engine.recognize(new Int16Array(16000), 500);
    expect(importOrt).toHaveBeenCalledTimes(1);
    // 概率是 Float32 读回来的，0.8 会是 0.80000001 —— 别用 toEqual。
    expect(signal?.label).toBe("sad");
    expect(signal?.confidence).toBeCloseTo(0.8, 5);
  });
});
