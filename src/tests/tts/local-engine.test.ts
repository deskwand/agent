import { describe, expect, it, vi } from "vitest";
import {
  ENGLISH_SPEAKER_ID,
  buildLocalTtsConfig,
  buildMatchaTtsConfig,
  createLocalTtsEngine,
} from "../../main/tts/local-engine";

const MODEL_DIR = "/tmp/models/vits-melo-tts-zh_en";
const MATCHA_DIR = "/tmp/models/matcha-icefall-zh-en";

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
  /** 新用例记录引擎对 onChunk 返回值的处置（1 = 继续，0 = 中止）。 */
  const verdicts: number[] = [];

  it("loads once and stays loaded", async () => {
    const instance = { generateAsync: vi.fn(), sampleRate: 44100 };
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
      createTts: () => ({ generateAsync: vi.fn(), sampleRate: 44100 }),
      createGenerationConfig: (options) => options,
    });
    await expect(engine.synthesize("你好")).rejects.toThrow("not loaded");
  });

  it("asks for speaker 0 at normal speed through the async path", async () => {
    const audio = { samples: new Float32Array(4), sampleRate: 44100 };
    const generateAsync = vi.fn(async () => audio);
    const engine = createLocalTtsEngine({
      modelDir: MODEL_DIR,
      createTts: () => ({ generateAsync, sampleRate: 44100 }),
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

  it("forwards engine chunks to onChunk and passes its verdict back", async () => {
    const generateAsync = vi.fn(
      async (options: {
        onProgress: (i: { samples: Float32Array }) => unknown;
      }) => {
        const first = options.onProgress({ samples: new Float32Array([1, 2]) });
        const second = options.onProgress({ samples: new Float32Array([3]) });
        verdicts.push(first === false ? 0 : 1, second === false ? 0 : 1);
        return { samples: new Float32Array([1, 2, 3]), sampleRate: 44100 };
      },
    );
    const engine = createLocalTtsEngine({
      modelDir: MODEL_DIR,
      createTts: () => ({ generateAsync, sampleRate: 44100 }),
      createGenerationConfig: (options) => ({ wrapped: options }),
    });
    await engine.load();

    const chunks: Array<{ samples: Float32Array; sampleRate: number }> = [];
    const audio = await engine.synthesize("你好", (chunk) => {
      chunks.push(chunk);
      return chunks.length < 2; // 第二块之后请求中止
    });

    expect(chunks.map((c) => c.samples.length)).toEqual([2, 1]);
    // 分块回调不带采样率，必须从实例上取
    expect(chunks.every((c) => c.sampleRate === 44100)).toBe(true);
    expect(verdicts).toEqual([1, 0]);
    expect(audio.samples.length).toBe(3);
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

describe("matcha tts config", () => {
  const matcha = (dir = MATCHA_DIR) => {
    const config = buildMatchaTtsConfig({ modelDir: dir }) as Record<
      string,
      unknown
    >;
    return {
      config,
      model: (config.model as { matcha: Record<string, unknown> }).matcha,
    };
  };

  it("points at all five files and the vocoder", () => {
    const { model } = matcha();
    expect(model.acousticModel).toBe(`${MATCHA_DIR}/model-steps-3.onnx`);
    // 声码器必须打同一个包里：它不在上游 tarball 里，见 package-tts-model.sh
    expect(model.vocoder).toBe(`${MATCHA_DIR}/vocos-16khz-univ.onnx`);
    expect(model.lexicon).toBe(`${MATCHA_DIR}/lexicon.txt`);
    expect(model.tokens).toBe(`${MATCHA_DIR}/tokens.txt`);
  });

  it("keeps ruleFsts next to model, not inside model.matcha", () => {
    const { config, model } = matcha();
    expect(model.ruleFsts).toBeUndefined();
    expect(config.ruleFsts).toBe(
      ["phone-zh.fst", "date-zh.fst", "number-zh.fst"]
        .map((name) => `${MATCHA_DIR}/${name}`)
        .join(","),
    );
  });

  it("always sets dataDir", () => {
    // 不要删这一行。实测：不给 dataDir 时构造能过，但合成时原生层直接 exit 255，
    // JS 的 try/catch 抓不住 —— 会打死整个 Electron 主进程。
    const { model } = matcha();
    expect(model.dataDir).toBe(`${MATCHA_DIR}/espeak-ng-data`);
  });
});

describe("voice id contract", () => {
  it("uses the variant's speaker id and keeps external buffers off", async () => {
    const audio = { samples: new Float32Array(4), sampleRate: 44100 };
    const generateAsync = vi.fn(async () => audio);
    const engine = createLocalTtsEngine({
      modelDir: MODEL_DIR,
      variant: "en",
      createTts: () => ({ generateAsync, sampleRate: 44100 }),
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
