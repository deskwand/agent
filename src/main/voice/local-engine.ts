/**
 * @module main/voice/local-engine
 *
 * sherpa-onnx 流式识别。addon 由外部注入 —— 这样单测能塞假 addon，
 * 不必为了跑测试去下一份 162MB 的模型。
 */
import { createRequire } from "node:module";
import { join } from "node:path";
import {
  SAMPLE_RATE,
  type TranscribeUpdate,
  type TranscriptionEngine,
  type TranscriptionResult,
  type TranscriptionStream,
} from "./transcription-engine";

/**
 * sherpa 的**原生 addon**（不是高层包装）。只声明我们用到的方法。
 *
 * ⚠️ 方法名**不要凭直觉改**：JavaScript addon 的名字与 Python 绑定**不一致**。
 * 例如 Python 里叫 `accept_waveform` / `input_finished`，而这里是
 * `acceptWaveformOnline` / `inputFinished`。下面 9 个名字是照着真实的
 * sherpa-onnx 1.13.8 addon 逐个核对过的（104 个导出方法里挑出来的）。
 *
 * 为什么单测拦不住名字写错：假 addon 是按本接口实现写的，名字与接口天然一致，
 * 两边一起错也照样绿。真正的把关是 `pipeline-real-engine.manual.test.ts`，
 * 它走 `loadSherpaAddon` 拿真 addon。
 */
export interface SherpaAddon {
  createOnlineRecognizer(config: unknown): unknown;
  createOnlineStream(recognizer: unknown): unknown;
  acceptWaveformOnline(
    stream: unknown,
    wave: { sampleRate: number; samples: Float32Array },
  ): void;
  isOnlineStreamReady(recognizer: unknown, stream: unknown): boolean;
  decodeOnlineStream(recognizer: unknown, stream: unknown): void;
  getOnlineStreamResultAsJson(recognizer: unknown, stream: unknown): string;
  isEndpoint(recognizer: unknown, stream: unknown): boolean;
  reset(recognizer: unknown, stream: unknown): void;
  inputFinished(stream: unknown): void;
}

/**
 * 从「用户启用时下载」的运行时目录加载**原生 addon**。
 *
 * 注意区分两个文件：`sherpa-onnx.js` 是高层包装（导出 `OnlineRecognizer` **类**）；
 * 本模块要的是它底下的 `addon.js` —— 那里才直接挂着 `createOnlineRecognizer` 等。
 * 拿错了报的是运行时的 `addon.createOnlineRecognizer is not a function`。
 *
 * `addon.js` 会去 `../sherpa-onnx-<platform>-<arch>/sherpa-onnx.node` 找同级原生包，
 * 动态库靠 rpath（macOS `@loader_path` / Linux `$ORIGIN`）自动解析，
 * 不需要 DYLD_LIBRARY_PATH。见设计文档 §2.3。
 *
 * 锚点用 `process.cwd()` 而不是 `__filename` / `import.meta.url`：路径本身是绝对的，
 * 锚点无所谓；而那两个引用一个在 ESM 下不存在、一个在 CJS 下不存在，用哪个都会
 * 让另一半运行环境（比如 vitest）抛 ReferenceError。
 */
export function loadSherpaAddon(
  runtimeRoot: string,
  version: string,
): SherpaAddon {
  const requireFrom = createRequire(join(process.cwd(), "package.json"));
  return requireFrom(
    `${runtimeRoot}/runtime/${version}/sherpa-onnx-node/addon.js`,
  );
}

export interface LocalEngineOptions {
  addon: SherpaAddon;
  modelDir: string;
  /** 默认 4。 */
  numThreads?: number;
}

export class LocalTranscriptionEngine implements TranscriptionEngine {
  constructor(private readonly options: LocalEngineOptions) {}

  createStream(): TranscriptionStream {
    const { addon, modelDir, numThreads = 4 } = this.options;
    // modelType 与 bpeVocab 缺一不可：这个模型是 BPE 词表的 zipformer2，
    // 少了就报 "Errors in config!"，而报错完全不提示是哪个字段。
    const recognizer = addon.createOnlineRecognizer({
      featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
      modelConfig: {
        transducer: {
          encoder: `${modelDir}/encoder.int8.onnx`,
          decoder: `${modelDir}/decoder.onnx`,
          joiner: `${modelDir}/joiner.int8.onnx`,
        },
        tokens: `${modelDir}/tokens.txt`,
        modelType: "zipformer2",
        bpeVocab: `${modelDir}/bpe.model`,
        numThreads,
        provider: "cpu",
      },
      decodingMethod: "greedy_search",
      enableEndpoint: true,
      // 断句规则：尾部静音 2.4s、或无新词 1.2s、或说了 20s
      rule1MinTrailingSilence: 2.4,
      rule2MinTrailingSilence: 1.2,
      rule3MinUtteranceLength: 20,
    });
    const stream = addon.createOnlineStream(recognizer);
    let closed = false;

    const readPartial = (): string => {
      try {
        const parsed = JSON.parse(
          addon.getOnlineStreamResultAsJson(recognizer, stream),
        ) as {
          text?: unknown;
        };
        return typeof parsed.text === "string" ? parsed.text : "";
      } catch {
        return "";
      }
    };

    const drain = (): void => {
      while (addon.isOnlineStreamReady(recognizer, stream)) {
        addon.decodeOnlineStream(recognizer, stream);
      }
    };

    return {
      push(samples: Float32Array): TranscribeUpdate {
        if (closed) return { partial: "" };

        addon.acceptWaveformOnline(stream, {
          sampleRate: SAMPLE_RATE,
          samples,
        });
        drain();

        if (addon.isEndpoint(recognizer, stream)) {
          const segment = readPartial().trim();
          addon.reset(recognizer, stream);
          return segment ? { partial: "", segment } : { partial: "" };
        }
        return { partial: readPartial() };
      },

      async finish(): Promise<TranscriptionResult> {
        if (closed) return { text: "" };
        closed = true;
        addon.inputFinished(stream);
        drain();
        return { text: readPartial().trim() };
      },

      abort(): void {
        closed = true;
      },
    };
  }
}
