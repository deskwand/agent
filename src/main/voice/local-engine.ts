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

/**
 * 收尾时补的静音长度（秒）。
 *
 * 流式 zipformer 要有**右上下文**才能定稿最后几个 token，而
 * `inputFinished()` 只冲刷特征帧、不管右上下文（见 sherpa-onnx 的
 * `csrc/online-stream.h` 注释）。录音在最后一个字上结束时，最后这截没有
 * 右上下文，永远进不了可解码状态。
 *
 * 短句里**整句**都落在这一截里 —— 实测「你好」（0.54s）不补时一个字都不出，
 * 补 0.6s 才出「你好」；长句只是丢尾巴一两个词，所以这个 bug 长句测不出来。
 *
 * 取 1.5s 而不是实测需求的最大值 1.0s：需求在 0.6~1.0s 之间波动，而这个方向上
 * 「差一点」的代价是**空文本** —— 正是本次要修的那个失败模式。代价是 `finish()`
 * 在主进程上同步多阻塞约 75~90ms（实测短句 90ms / 长句 74ms，含必须的那 1.0s），
 * 而这发生在用户说完之后。
 *
 * **这个值会触发虚假端点，但那是惰性的**：`finish()` 不查 `isEndpoint`、
 * 不调 `reset`，所以端点信号没人消费。实证：同一段音频补 1s/2s/3s 输出完全相同。
 *
 * ⚠️ **这个值与分块大小正相关，换分块必须重测**：官方示例补 0.3~0.66s，是因为
 * 它们用 160ms 分块的模型；我们 480ms 实测约 1.0s；1920ms 档实测要 1.6s。
 */
export const TAIL_PAD_SECONDS = 1.5;

export class LocalTranscriptionEngine implements TranscriptionEngine {
  /**
   * 建一次就复用。这一步把模型读进内存（实测约 2.2s），而它曾经在
   * `createStream()` 里 —— 每条录音都会调一次，于是每按一次麦克风都重付一遍。
   * 识别状态跟着 stream 走，所以 stream 仍要每条会话新建，recognizer 不必。
   */
  private recognizer: unknown = null;

  constructor(private readonly options: LocalEngineOptions) {}

  createStream(): TranscriptionStream {
    const { addon, modelDir, numThreads = 4 } = this.options;
    if (!this.recognizer) {
      // modelType 与 bpeVocab 缺一不可：这个模型是 BPE 词表的 zipformer2，
      // 少了就报 "Errors in config!"，而报错完全不提示是哪个字段。
      this.recognizer = addon.createOnlineRecognizer({
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
    }
    const recognizer = this.recognizer;
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

        // 先补静音，再 inputFinished —— 跟官方示例的顺序一致。
        // （实测在 sherpa-onnx 1.13.8 上把两者对调，输出完全相同，所以顺序不是
        //   当下的承重墙；保留它是为了跟随官方约定。）
        // 一次性喂完即可 —— sherpa 的 AcceptWaveform 只是往内部缓冲追加，
        // 不要求分片（官方 Python 示例也是整段一次喂）。
        //
        // `Math.round` 是结构性保证，不是防御式编程：`Float32Array` 的长度必须
        // 是整数，而改常量时手滑（例如 1.001）会抛 RangeError —— 那个异常会被
        // `session.stop()` 的 catch 吞掉，退化成「静默空文本」，正是本次要修的
        // 那个失败模式。取整后，任何常量值都不会把这个路径打回原形。
        addon.acceptWaveformOnline(stream, {
          sampleRate: SAMPLE_RATE,
          samples: new Float32Array(Math.round(SAMPLE_RATE * TAIL_PAD_SECONDS)),
        });
        drain();

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
