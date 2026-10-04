/**
 * @module renderer/utils/voice/vad
 *
 * 纯函数的能量 VAD：噪声底估算 + 说话/静音判定。
 *
 * 为什么不引 silero-vad：要额外下模型、在主进程集成、核对许可证，
 * 而这个模块只有几十行且完全可测。等真的在嘈杂环境里不够用再换。
 *
 * 为什么必须先标定噪声底：固定阈值在风扇声、咖啡厅里会一直判成"在说话"，
 * 而让用户手动调阈值治不了它 —— 噪声底本身是浮动且随时间变化的。
 */

/**
 * 阈值下限，0.25 ≈ -50 dBFS。
 *
 * 原来的 0.12 约等于 -55 dBFS，几乎挡不住任何东西：典型房间噪声底就在
 * -50 ~ -60 dBFS 一带，扬声器经回声消除后的残留也在这一带。症状很特殊 ——
 * 朗读老是莫名被打断，但打断后 ASR 又识别不出任何文字（采到的是识别不出
 * 内容的弱信号）。开了自动增益后正常说话在 -20 ~ -35 dBFS，仍远高于此。
 */
export const MIN_THRESHOLD = 0.25;
/** 阈值超出噪声底的余量。0.12 → 0.20：余量太小时噪声底稍微浮动就越线。 */
export const NOISE_MARGIN = 0.2;
/**
 * 回答期在标定阈值之上再加的余量。
 *
 * 这一时期麦克风里除了用户，还有扬声器的残留与混响，它们比标定时测到的
 * 环境噪声更响。不加这一层，"开口打断"会持续被播放自己的尾巴触发。
 */
export const BARGE_IN_THRESHOLD_MARGIN = 0.15;
/** 说话起点需要持续超阈的时长（主动开口用）。 */
export const DEFAULT_SPEECH_MS = 150;

export type VadEvent = "speech-start" | "silence" | null;

export interface VadConfig {
  threshold: number;
  /** 默认 150ms。 */
  speechMs?: number;
  /** 静音结束时长，来自设置项，默认 800ms。 */
  silenceMs?: number;
}

export interface Vad {
  push(level: number, deltaMs: number): VadEvent;
  reset(): void;
  isSpeaking(): boolean;
  /**
   * 改「说话起点」的确认时长。
   *
   * 打断朗读时要调高：打断的代价（念到一半被掐断）比晚 150ms 响应更高，
   * 而咳嗽、关门、椅子声这些突发噪声的持续时长往往刚过 150ms —— 用它当
   * 起点阈值刚好会被误触发。
   */
  setSpeechMs(ms: number): void;
  /**
   * 改判定阈值。回答期要调高：那时麦克风里多了扬声器的残留与混响。
   */
  setThreshold(level: number): void;
}

/**
 * 取中位数作为噪声底。
 *
 * 为什么不是 P90：标定窗只有 8 帧（800ms ÷ 100ms），`floor(8 × 0.9) = 7`
 * 正好落在最大值上 —— 开窗时一声咳嗽、一次键盘敲击就能把阈值顶到嗓子以上，
 * 这一整次会话里人声再也不触发。中位数对单个尖峰免疫，正是这里要的性质。
 */
export function estimateNoiseFloor(levels: number[]): number {
  if (levels.length === 0) return 0;
  const sorted = [...levels].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export function thresholdFromNoiseFloor(floor: number): number {
  return Math.max(MIN_THRESHOLD, floor + NOISE_MARGIN);
}

export function createVad(config: VadConfig): Vad {
  let speechMs = config.speechMs ?? DEFAULT_SPEECH_MS;
  let threshold = config.threshold;
  const silenceMs = config.silenceMs ?? 800;
  let aboveMs = 0;
  let belowMs = 0;
  let speaking = false;

  return {
    push(level, deltaMs) {
      if (level > threshold) {
        aboveMs += deltaMs;
        belowMs = 0;
        if (!speaking && aboveMs >= speechMs) {
          speaking = true;
          return "speech-start";
        }
        return null;
      }
      aboveMs = 0;
      if (!speaking) return null;
      belowMs += deltaMs;
      if (belowMs >= silenceMs) {
        speaking = false;
        belowMs = 0;
        return "silence";
      }
      return null;
    },
    reset() {
      aboveMs = 0;
      belowMs = 0;
      speaking = false;
    },
    isSpeaking() {
      return speaking;
    },
    setSpeechMs(ms) {
      speechMs = ms;
    },
    setThreshold(level) {
      threshold = level;
    },
  };
}
