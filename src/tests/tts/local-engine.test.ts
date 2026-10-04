import { describe, expect, it, vi } from "vitest";
import {
  ENGLISH_SPEAKER_ID,
  buildLocalTtsConfig,
  createLocalTtsEngine,
} from "../../main/tts/local-engine";

const MODEL_DIR = "/tmp/models/vits-melo-tts-zh_en";

describe("local tts config", () => {
  it("puts ruleFsts next to model, not inside model.vits", () => {
    const config = buildLocalTtsConfig({ modelDir: MODEL_DIR }) as Record<
      string,
      unknown
    >;

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
      // 缺了它 Electron 下必然失败（外部缓冲区），见 local-engine 注释
      enableExternalBuffer: false,
    });
  });
});

describe("local tts config by variant", () => {
  it("keeps dictDir and ruleFsts for the Chinese model", () => {
    const config = buildLocalTtsConfig({ modelDir: MODEL_DIR }) as Record<
      string,
      unknown
    >;
    const vits = (config.model as { vits: Record<string, unknown> }).vits;
    expect(vits.dictDir).toBe(MODEL_DIR);
    expect(typeof config.ruleFsts).toBe("string");
  });

  it("drops dictDir and ruleFsts for the English model", () => {
    // 英文模型包里没有 dict/ 也没有任何 .fst（实测）：带上它们会加载失败或静默失效
    const config = buildLocalTtsConfig({
      modelDir: MODEL_DIR,
      variant: "en",
    }) as Record<string, unknown>;
    const vits = (config.model as { vits: Record<string, unknown> }).vits;
    expect(vits.dictDir).toBeUndefined();
    expect(config.ruleFsts).toBeUndefined();
  });
});

describe("voice id contract", () => {
  it("uses the variant's speaker id and keeps external buffers off", async () => {
    const audio = { samples: new Float32Array(4), sampleRate: 44100 };
    const generateAsync = vi.fn(async () => audio);
    const engine = createLocalTtsEngine({
      modelDir: MODEL_DIR,
      variant: "en",
      createTts: () => ({ generateAsync }),
      createGenerationConfig: (options) => ({ wrapped: options }),
    });
    await engine.load();
    await expect(engine.synthesize("Hello.")).resolves.toBe(audio);
    expect(generateAsync).toHaveBeenCalledWith({
      text: "Hello.",
      sid: ENGLISH_SPEAKER_ID,
      speed: 1.0,
      generationConfig: { wrapped: { sid: ENGLISH_SPEAKER_ID, speed: 1.0 } },
      onProgress: expect.any(Function),
      enableExternalBuffer: false,
    });
  });
});
