/**
 * @module shared/voice-emotion
 *
 * 语音情感信号：引擎输出、IPC 载荷、注入门槛的唯一定义处。
 *
 * 为什么放共享层：主进程产出、跨进程传输、主进程再按同一套常量判断要不要注入。
 * 常量同源，避免出现「界面显示有情感、实际没注入」这类只有真机才看得见的偏差。
 */

/** 模型 9 类标签的英文部分。顺序与 tokens.txt 一致。 */
export type EmotionLabel =
  | "angry"
  | "disgusted"
  | "fearful"
  | "happy"
  | "neutral"
  | "other"
  | "sad"
  | "surprised"
  | "unknown";

export const EMOTION_LABELS = [
  "angry",
  "disgusted",
  "fearful",
  "happy",
  "neutral",
  "other",
  "sad",
  "surprised",
  "unknown",
] as const satisfies readonly EmotionLabel[];

export interface EmotionSignal {
  label: EmotionLabel;
  /** 最大类 softmax，0–1。 */
  confidence: number;
}

/** 注入门槛：最大类 softmax 低于它就不注入。首版值，待校准。 */
export const EMOTION_CONFIDENCE_THRESHOLD = 0.6;
/** 本轮缓冲上限（采样数，16 kHz）。超出丢头部。 */
export const EMOTION_BUFFER_LIMIT_SAMPLES = 16000 * 15;
/** 短于它完全不跑模型（咳嗽、关门声）。 */
export const EMOTION_MIN_SAMPLES = Math.round(16000 * 0.8);
/** `stop()` 里等情感的预算。 */
export const EMOTION_TIMEOUT_MS = 500;

function isLabel(value: unknown): value is EmotionLabel {
  return (
    typeof value === "string" &&
    (EMOTION_LABELS as readonly string[]).includes(value)
  );
}

export function isEmotionSignal(value: unknown): value is EmotionSignal {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { label?: unknown; confidence?: unknown };
  return (
    isLabel(candidate.label) &&
    typeof candidate.confidence === "number" &&
    Number.isFinite(candidate.confidence) &&
    candidate.confidence >= 0 &&
    candidate.confidence <= 1
  );
}
