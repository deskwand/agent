import { describe, expect, it, vi } from "vitest";
import {
  buildLocalTtsConfig,
  createLocalTtsEngine,
} from "../../main/tts/local-engine";

const MODEL_DIR = "/tmp/models/vits-melo-tts-zh_en";

describe("local tts config", () => {
  it("puts ruleFsts next to model, not inside model.vits", () => {
    const config = buildLocalTtsConfig({
      modelDir: MODEL_DIR,
      createTts: () => ({ generateAsync: vi.fn() }),
      createGenerationConfig: (options) => options,
    }) as Record<string, unknown>;

    const vits = (config.model as { vits: Record<string, unknown> }).vits;
    expect(vits.ruleFsts).toBeUndefined();
    expect(config.ruleFsts).toBe(
      [
        `${MODEL_DIR}/date.fst`,
        `${MODEL_DIR}/number.fst`,
        `${MODEL_DIR}/phone.fst`,
      ].join(","),
    );
  });
});

describe("local tts engine", () => {
  it("loads once and stays loaded", async () => {
    const instance = { generateAsync: vi.fn() };
    const createTts = vi.fn(() => instance);
    const engine = createLocalTtsEngine({
      modelDir: MODEL_DIR,
      createTts,
      createGenerationConfig: (options) => options,
    });

    expect(engine.isLoaded()).toBe(false);
    await engine.load();
    await engine.load();
    expect(createTts).toHaveBeenCalledTimes(1);
    expect(engine.isLoaded()).toBe(true);
  });

  it("refuses to synthesize before load", async () => {
    const engine = createLocalTtsEngine({
      modelDir: MODEL_DIR,
      createTts: () => ({ generateAsync: vi.fn() }),
      createGenerationConfig: (options) => options,
    });
    await expect(engine.synthesize("你好")).rejects.toThrow("not loaded");
  });

  it("asks for speaker 0 at normal speed through the async path", async () => {
    const audio = { samples: new Float32Array(4), sampleRate: 44100 };
    const generateAsync = vi.fn(async () => audio);
    const engine = createLocalTtsEngine({
      modelDir: MODEL_DIR,
      createTts: () => ({ generateAsync }),
      createGenerationConfig: (options) => ({ wrapped: options }),
    });
    await engine.load();

    await expect(engine.synthesize("你好")).resolves.toBe(audio);
    // 必须是 generateAsync：同步版会让主进程事件循环停摆（见 local-engine 注释）
    expect(generateAsync).toHaveBeenCalledWith({
      text: "你好",
      sid: 0,
      speed: 1.0,
      generationConfig: { wrapped: { sid: 0, speed: 1.0 } },
      onProgress: expect.any(Function),
    });
  });
});
