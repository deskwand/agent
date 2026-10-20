/**
 * @module main/voice/emotion/engine
 *
 * 情感推理：把一段 16 kHz PCM16 变成 { label, confidence }。
 *
 * 两种模型形态都要支持（spec §2.2）：
 * 1. 首选：头部已追加进图，输出即 [1, 9] 概率。
 * 2. 退回：输出 [1, T, 768] 帧级特征，这里自己池化并用注入的头部算概率。
 *
 * 失败一律返回 null：情感是加分项，不许弄坏一轮对话（spec §4）。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  EMOTION_LABELS,
  type EmotionLabel,
  type EmotionSignal,
} from "../../../shared/voice-emotion";
import { isEmotionInstalled, modelDir, runtimeDir } from "./installer";

export interface OrtTensorLike {
  data: Float32Array;
  dims: readonly number[];
}

export interface OrtSessionLike {
  /** 真实 ORT 会话上有这个属性；假会话可以不给。 */
  inputNames?: readonly string[];
  run(feeds: Record<string, unknown>): Promise<Record<string, OrtTensorLike>>;
  release?(): void;
}

/** 会话句柄：会话本体 + 「怎么造输入」。真实现用 `ort.Tensor`，测试用恒等函数。 */
export interface EmotionSessionHandle {
  session: OrtSessionLike;
  makeInput: (data: Float32Array, dims: readonly number[]) => unknown;
}

export interface OrtModuleLike {
  InferenceSession: {
    create(path: string, options?: unknown): Promise<OrtSessionLike>;
  };
  Tensor: new (
    type: string,
    data: Float32Array,
    dims: readonly number[],
  ) => unknown;
}

export interface EmotionHead {
  /** 行主序 [9, 768]。 */
  weight: Float32Array;
  /** 长度 9。 */
  bias: Float32Array;
}

export interface EmotionEngine {
  recognize(
    samples: Int16Array,
    timeoutMs: number,
  ): Promise<EmotionSignal | null>;
  /** 提前把会话读进内存：首次加载实测 274 ms，放在说话之前做掉。 */
  warmUp(): Promise<void>;
  release(): void;
}

export interface EmotionEngineOptions {
  loadSession: () => Promise<EmotionSessionHandle>;
  /** 退回形态（输出帧级特征）才需要。 */
  head?: EmotionHead;
}

const FEATURE_DIMS = 768;

function softmax(logits: readonly number[]): number[] {
  const max = Math.max(...logits);
  const exps = logits.map((value) => Math.exp(value - max));
  const sum = exps.reduce((acc, value) => acc + value, 0);
  return exps.map((value) => value / sum);
}

function argmax(values: readonly number[]): number {
  let best = 0;
  for (let i = 1; i < values.length; i += 1)
    if (values[i] > values[best]) best = i;
  return best;
}

/** 768 维均值。dims 必须是 [1, T, 768]，否则返回 null。 */
export function pooledFromFeatures(tensor: OrtTensorLike): Float32Array | null {
  const [, frames, dims] = tensor.dims;
  if (frames === undefined || dims !== FEATURE_DIMS || frames === 0)
    return null;
  const pooled = new Float32Array(dims);
  for (let t = 0; t < frames; t += 1) {
    for (let d = 0; d < dims; d += 1) pooled[d] += tensor.data[t * dims + d];
  }
  for (let d = 0; d < dims; d += 1) pooled[d] /= frames;
  return pooled;
}

/** 768 维均值 → 9 类概率。 */
export function headProbabilities(
  pooled: Float32Array,
  head: EmotionHead,
): number[] {
  const logits = new Array<number>(EMOTION_LABELS.length).fill(0);
  for (let label = 0; label < logits.length; label += 1) {
    let sum = head.bias[label];
    for (let d = 0; d < pooled.length; d += 1) {
      sum += head.weight[label * pooled.length + d] * pooled[d];
    }
    logits[label] = sum;
  }
  return softmax(logits);
}

export function createEmotionEngine(
  options: EmotionEngineOptions,
): EmotionEngine {
  let handle: EmotionSessionHandle | null = null;

  const getSession = async (): Promise<EmotionSessionHandle> => {
    if (!handle) handle = await options.loadSession();
    return handle;
  };

  return {
    async recognize(samples, timeoutMs) {
      const task = (async (): Promise<EmotionSignal | null> => {
        const active = await getSession();
        const floats = new Float32Array(samples.length);
        for (let i = 0; i < samples.length; i += 1)
          floats[i] = samples[i] / 0x8000;
        const name = active.session.inputNames?.[0] ?? "waveform";
        const output = await active.session.run({
          [name]: active.makeInput(floats, [1, floats.length]),
        });
        const first = Object.values(output)[0];
        if (!first) return null;
        const probs =
          first.dims.length === 2 && first.dims[1] === EMOTION_LABELS.length
            ? Array.from(first.data)
            : (() => {
                const pooled = pooledFromFeatures(first);
                return pooled && options.head
                  ? headProbabilities(pooled, options.head)
                  : [];
              })();
        if (probs.length !== EMOTION_LABELS.length) return null;
        const best = argmax(probs);
        return {
          label: EMOTION_LABELS[best] as EmotionLabel,
          confidence: probs[best],
        };
      })();

      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      });
      try {
        return await Promise.race([task.catch(() => null), timeout]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
    async warmUp() {
      try {
        await getSession();
      } catch {
        // 未安装 / 模型缺失：保持静默，recognize 那条路本来也返回 null
      }
    },
    release() {
      const active = handle;
      handle = null;
      try {
        active?.session.release?.();
      } catch {
        // release 失败不影响下次加载
      }
    },
  };
}

/**
 * 读退回形态的头部权重。
 *
 * **必须逐字节拷**：readFileSync 的 Buffer 来自内存池，byteOffset 往往不是 4 的倍数，
 * 直接 `new Float32Array(raw.buffer, raw.byteOffset, …)` 会抛 RangeError。
 * 而这个函数在 loadEmotionRecognizer 里是同步执行的 —— 抛了会把整条 voice.start 打回失败。
 */
function readHeadFromDisk(dir: string): EmotionHead | null {
  const path = join(dir, "head.bin");
  if (!existsSync(path)) return null;
  const raw = readFileSync(path);
  if (raw.byteLength !== (9 * FEATURE_DIMS + 9) * 4) return null;
  const floats = new Float32Array(raw.byteLength / 4);
  for (let i = 0; i < floats.length; i += 1) floats[i] = raw.readFloatLE(i * 4);
  return {
    weight: floats.slice(0, 9 * FEATURE_DIMS),
    bias: floats.slice(9 * FEATURE_DIMS),
  };
}

/**
 * 从 userData 里装配识别器：动态 import 运行时（与 OCR 同一写法），模型目录指向 `models/<id>`。
 * 未安装时返回一个永远 null 的识别器 —— 调用方不用分支。
 *
 * onnxruntime-node 是 **CJS** 包（`main: dist/index.js`，无 `exports` 字段），具名导出不一定被
 * 互操作合成，所以 `default` 优先。
 */
export function loadEmotionRecognizer(
  userDataPath: string,
  deps: {
    importOrt?: (dir: string) => Promise<OrtModuleLike>;
    readHead?: (dir: string) => EmotionHead | null;
  } = {},
): EmotionEngine {
  const importOrt =
    deps.importOrt ??
    (async (dir: string) => {
      const entry = join(
        dir,
        "node_modules",
        "onnxruntime-node",
        "dist",
        "index.js",
      );
      const mod = (await import(pathToFileURL(entry).href)) as
        | { default?: OrtModuleLike }
        | OrtModuleLike;
      return (
        (mod as { default?: OrtModuleLike }).default ?? (mod as OrtModuleLike)
      );
    });
  const readHead = deps.readHead ?? readHeadFromDisk;
  const runtime = runtimeDir(userDataPath);
  const model = modelDir(userDataPath);

  if (!isEmotionInstalled(userDataPath)) {
    return createEmotionEngine({
      loadSession: async () => {
        throw new Error("emotion model not installed");
      },
    });
  }
  const head = readHead(model) ?? undefined;
  return createEmotionEngine({
    head,
    loadSession: async () => {
      const ort = await importOrt(runtime);
      const session = await ort.InferenceSession.create(
        join(model, "emotion2vec.int8.onnx"),
      );
      return {
        session,
        makeInput: (data, dims) => new ort.Tensor("float32", data, dims),
      };
    },
  });
}
