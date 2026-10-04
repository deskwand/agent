/**
 * @module main/voice/vad-engine
 *
 * 语音活动检测：100ms 的 PCM 帧进，`speech-start` / `speech-end` 边沿出。
 *
 * 换掉了渲染层的能量 VAD（`renderer/utils/voice/vad.ts`，已删）。那个模块用
 * RMS 阈值加噪声底标定，注释里记着三个手调余量（MIN_THRESHOLD 0.25、
 * NOISE_MARGIN 0.2、BARGE_IN_THRESHOLD_MARGIN 0.15）——都是在用参数补偿
 * "分不清人声与噪声"这件事。Silero 是训练过的模型，这类补偿不再需要。
 *
 * 它治的是**环境噪声**（风扇、键盘、远处说话）。**不治扬声器泄漏**：泄漏
 * 出来的是人声，模型会正确判定"有人在说话"。那个靠 AEC3 与渲染层的
 * "识别结果里有没有真内容"来兜。
 *
 * 包装器由外部注入：单测塞假的，不必为跑测试去下一份模型。
 */
import type { VadEdge, VadProfile } from "../../shared/ipc-types";

/** Silero 在 16kHz 下的窗口。 */
export const WINDOW_SAMPLES = 512;

/**
 * 只声明用到的那一小块。名字照 sherpa-onnx 1.13.8 的 `vad.js` 核对过。
 *
 * ⚠️ 不要换成 `front()` —— 它默认 `enableExternalBuffer = true`，而 Electron
 * 的 V8 不允许外部缓冲区，同步调用会报 `External buffers are not allowed`。
 * 本模块只用 `isDetected()` / `isEmpty()` / `pop()` / `reset()`，都不碰它。
 * （同一个坑在 `tts/local-engine.ts` 里已经记过一次。）
 */
export interface SherpaVad {
  acceptWaveform(samples: Float32Array): void;
  isDetected(): boolean;
  /** 内部段队列是否为空。我们不消费段，但必须排空（见 push 里的说明）。 */
  isEmpty(): boolean;
  pop(): void;
  reset(): void;
}

export interface VadEngine {
  push(pcm: Int16Array): void;
  setProfile(profile: VadProfile): void;
  reset(): void;
}

export interface VadEngineOptions {
  modelPath: string;
  createVad: (config: unknown) => SherpaVad;
  onEdge: (edge: VadEdge) => void;
}

/**
 * 两个 profile。
 *
 * 起值沿用被删掉的 `vad.ts` 与 `useVoiceConversation.ts` 里那两个手调常量：
 * `DEFAULT_SPEECH_MS = 150` 与 `BARGE_IN_SPEECH_MS = 300`——那是能量 VAD 上
 * 试出来的说话起点确认时长，语义与 `minSpeechDuration` 相同，正好搬过来。
 * `threshold` 的 0.5 是 Silero 默认值。
 *
 * ⚠️ `barge-in` 的 `threshold: 0.6` **待实测验证，且预期作用有限**：真正有效
 * 的杆是 `minSpeechDuration`（0.15 → 0.3）。抬阈值挡的是噪声，而扬声器泄漏
 * 听起来就是人声，Silero 会给它高概率。自我打断主要靠"识别结果里有没有真
 * 内容"来兜，不靠这个数字。
 */
const PROFILES: Record<
  VadProfile,
  { threshold: number; minSpeechDuration: number }
> = {
  interactive: { threshold: 0.5, minSpeechDuration: 0.15 },
  "barge-in": { threshold: 0.6, minSpeechDuration: 0.3 },
};

/** 报静音的静音时长。它是"该问一句了"的信号，不是"说完了"的结论。 */
const MIN_SILENCE_SECONDS = 0.3;

/** 采样率的唯一来源。PCM16 单声道，与 mic-capture 一致。 */
const SAMPLE_RATE = 16000;

export function createVadEngine(options: VadEngineOptions): VadEngine {
  const { modelPath, createVad, onEdge } = options;
  let profile: VadProfile = "interactive";
  let window = new Float32Array(WINDOW_SAMPLES);
  let filled = 0;
  let speaking = false;

  /**
   * 换实例后的第一次读数只做重新同步，不发边沿。
   *
   * 为什么必须这样：换实例（或复位）后，模型要重新积累若干窗口才认得出人声，
   * 于是第一个窗口必然报 `isDetected() === false`。若此时 `speaking` 还是
   * `true`，比较就成立，一个**伪造的 speech-end** 被发出去。而渲染层收到
   * speech-end 会直接关掉当前轮次 —— 换 profile 恰好发生在"朗读中用户开口"
   * 那一刻，于是每一次打断都产出空转写。
   */
  let resync = false;

  const build = (p: VadProfile): SherpaVad => {
    const { threshold, minSpeechDuration } = PROFILES[p];
    return createVad({
      sileroVad: {
        model: modelPath,
        threshold,
        minSpeechDuration,
        minSilenceDuration: MIN_SILENCE_SECONDS,
        windowSize: WINDOW_SAMPLES,
      },
      sampleRate: SAMPLE_RATE,
      numThreads: 1,
      debug: false,
    });
  };

  /**
   * 两个实例都在这里建好。
   *
   * 构造就是一次 ONNX 模型加载，而 profile 切换发生在"朗读开始"与"打断开始"
   * ——两个最不能卡主进程的时刻（主进程同时服务聊天流、文件、遥测 IPC）。
   * 所以切换只换指针，不重建。
   */
  const instances: Record<VadProfile, SherpaVad> = {
    interactive: build("interactive"),
    "barge-in": build("barge-in"),
  };
  let vad = instances.interactive;

  /** 换实例 + 复位 + 清累积。累积器必须清：否则新实例的第一个窗口是拼接的。 */
  const reseat = () => {
    vad = instances[profile];
    vad.reset();
    window = new Float32Array(WINDOW_SAMPLES);
    filled = 0;
    resync = true;
  };

  return {
    push(pcm) {
      for (let i = 0; i < pcm.length; i += 1) {
        window[filled] = pcm[i] / 0x8000;
        filled += 1;
        if (filled < WINDOW_SAMPLES) continue;
        filled = 0;
        // 必须传副本：window 会被复用，包装器可能持有引用。
        vad.acceptWaveform(window.slice());
        // 本模块只读 isDetected() 的边沿，不消费段。不排空的话段队列会随
        // 会话长度一直长（每段带音频），而缓冲满时的行为没有文档保证。
        while (!vad.isEmpty()) vad.pop();
        const now = vad.isDetected();
        if (resync) {
          resync = false;
          speaking = now;
          continue;
        }
        if (now !== speaking) {
          speaking = now;
          onEdge(now ? "speech-start" : "speech-end");
        }
      }
    },

    setProfile(next) {
      if (profile === next) return;
      profile = next;
      reseat();
    },

    reset() {
      // 必须报一声：消费端（渲染层）自己维护一个 speaking 标志，主进程默默
      // 复位会让两边失衡 —— 下一次真正的 speech-start 到了它也不认。
      if (speaking) onEdge("speech-end");
      speaking = false;
      reseat();
    },
  };
}
