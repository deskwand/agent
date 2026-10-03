/**
 * @module main/tts/local-engine
 *
 * sherpa-onnx 的 OfflineTts。模块由外部注入 —— 单测塞假模块，不必下 157MB 模型。
 */
import { createRequire } from "node:module";
import { join } from "node:path";
import type { SynthesizedAudio, TtsEngine } from "./tts-engine";

/** 只有一个音色（模型 README 写明），也不是给用户调的 —— 固定住，免得散落各处。 */
const SPEAKER_ID = 0;
const SPEED = 1.0;

/** 只声明用到的那一小块。名字照 sherpa-onnx 1.13.8 的 node 包装核对过。 */
export interface SherpaOfflineTts {
  /**
   * 异步合成。**不要换回同步的 `generate`**：实测一句 4.45 秒的音频里，同步版
   * 让主进程事件循环 0 次 tick（聊天流、文件、遥测 IPC 全部停摆），而
   * generateAsync 的最大停顿是 7ms，总耗时一样。
   */
  generateAsync(options: {
    text: string;
    sid: number;
    speed: number;
    generationConfig: unknown;
    onProgress: (info: { samples: Float32Array }) => void;
  }): Promise<SynthesizedAudio>;
}

export interface SherpaTtsModule {
  OfflineTts: new (config: unknown) => SherpaOfflineTts;
  GenerationConfig: new (options: { sid: number; speed: number }) => unknown;
}

export interface LocalTtsOptions {
  /** 模型目录：`<userData>/voice/models/vits-melo-tts-zh_en`。 */
  modelDir: string;
  createTts: (config: unknown) => SherpaOfflineTts;
  createGenerationConfig: (options: { sid: number; speed: number }) => unknown;
  numThreads?: number;
}

/**
 * 配置形状有一处**会静默失效**的坑：`ruleFsts` 必须与 `model` 同级。
 *
 * 放进 `model.vits` 里不报错、也不生效 —— 实测那时 `12` / `3.14` / `2026` 全部走
 * `OOV ... Ignore it!`，读出来是断的。带上之后不再有 OOV（时长 2.6s → 4.3s）。
 * 助手回复里到处是数字，所以这条不是小事。
 */
export function buildLocalTtsConfig(opts: LocalTtsOptions): unknown {
  const { modelDir } = opts;
  return {
    model: {
      vits: {
        model: join(modelDir, "model.onnx"),
        lexicon: join(modelDir, "lexicon.txt"),
        tokens: join(modelDir, "tokens.txt"),
        dictDir: modelDir,
      },
    },
    ruleFsts: ["date.fst", "number.fst", "phone.fst"]
      .map((name) => join(modelDir, name))
      .join(","),
    numThreads: opts.numThreads ?? 4,
    provider: "cpu",
  };
}

export function createLocalTtsEngine(opts: LocalTtsOptions): TtsEngine {
  let tts: SherpaOfflineTts | null = null;
  return {
    isLoaded: () => tts !== null,
    async load() {
      if (tts) return;
      tts = opts.createTts(buildLocalTtsConfig(opts));
    },
    async synthesize(text) {
      if (!tts) throw new Error("tts engine not loaded");
      return await tts.generateAsync({
        text,
        sid: SPEAKER_ID,
        speed: SPEED,
        generationConfig: opts.createGenerationConfig({
          sid: SPEAKER_ID,
          speed: SPEED,
        }),
        onProgress: () => {},
      });
    },
  };
}

/**
 * 从「用户启用时下载」的运行时目录加载**高层包装**。
 *
 * 与语音输入的区别：那边要底层 addon（`addon.js`，挂着 `createOnlineRecognizer`），
 * 这里要高层包装（`sherpa-onnx.js`，导出 `OfflineTts` 类）—— 它把配置校验与内存
 * 管理包好了。拿错文件报的是 `OfflineTts is not a constructor`。
 *
 * 锚点用 `process.cwd()`：路径本身是绝对的，而 `__filename` 与 `import.meta.url`
 * 各在一半运行环境里不存在（CJS / ESM），用哪个都会让另一半抛 ReferenceError ——
 * 语音输入那边已经踩过并记在注释里。
 */
export function loadSherpaTts(runtimeRoot: string): SherpaTtsModule {
  const requireFromRuntime = createRequire(join(process.cwd(), "package.json"));
  return requireFromRuntime(
    join(runtimeRoot, "sherpa-onnx-node", "sherpa-onnx.js"),
  ) as SherpaTtsModule;
}
