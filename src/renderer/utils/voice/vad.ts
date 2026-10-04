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

/** 阈值下限。安静房间里人声也能轻松超过它。 */
export const MIN_THRESHOLD = 0.12;
/** 阈值超出噪声底的余量。 */
export const NOISE_MARGIN = 0.12;
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
  const silenceMs = config.silenceMs ?? 800;
  let aboveMs = 0;
  let belowMs = 0;
  let speaking = false;

  return {
    push(level, deltaMs) {
      if (level > config.threshold) {
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
  };
}
