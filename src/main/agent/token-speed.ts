/**
 * @module main/agent/token-speed
 *
 * 生成速度（tokens/s）的纯计算 + 节流发射器。
 *
 * 口径：`output tokens ÷ (message_end − 首个增量)`。首 token 等待与工具执行都在
 * 窗口外，所以数字与 OpenRouter 的 tokens/s 接近，可横向比模型。
 *
 * 估算不按单一「字符/token」比例：中英混排差 3 倍以上（ASCII ≈ 4 字符/token，
 * CJK ≈ 1.2）。先按字符类别分别折算，再用上一条消息的真实 usage.output 校准
 * 一个标量（clamp 0.5–2，防止单条脏数据把估算带飞）。
 */

export interface TokenSpeedSample {
  tokensPerSecond: number;
  estimated: boolean;
}

export interface StreamCharCounts {
  ascii: number;
  nonAscii: number;
}

/** 流式估算的广播间隔；也是首个估算值的最小窗口。 */
export const SPEED_EMIT_INTERVAL_MS = 500;

/** 精确值的最小窗口：非流式 provider 可能只留几毫秒，不能把它当成真实速度。 */
const MIN_EXACT_WINDOW_MS = 200;

const ASCII_CHARS_PER_TOKEN = 4;
const NON_ASCII_CHARS_PER_TOKEN = 1.2;
const MIN_CALIBRATION = 0.5;
const MAX_CALIBRATION = 2;

export function countStreamChars(delta: string): StreamCharCounts {
  let ascii = 0;
  let nonAscii = 0;
  for (const ch of delta) {
    if (ch.charCodeAt(0) < 0x80) ascii += 1;
    else nonAscii += 1;
  }
  return { ascii, nonAscii };
}

export function rawTokenEstimate(counts: StreamCharCounts): number {
  return (
    counts.ascii / ASCII_CHARS_PER_TOKEN +
    counts.nonAscii / NON_ASCII_CHARS_PER_TOKEN
  );
}

/** 用这一条消息的真实 output tokens 校准估算；异常输入保持原值。 */
export function nextCalibration(
  current: number,
  rawEstimate: number,
  outputTokens: number,
): number {
  if (
    !Number.isFinite(current) ||
    !Number.isFinite(rawEstimate) ||
    !Number.isFinite(outputTokens) ||
    rawEstimate <= 0 ||
    outputTokens <= 0
  ) {
    return current;
  }
  const ratio = outputTokens / rawEstimate;
  return Math.min(MAX_CALIBRATION, Math.max(MIN_CALIBRATION, ratio));
}

export interface TokenSpeedReporterOptions {
  emit: (sample: TokenSpeedSample) => void;
  /** 注入时钟；缺省 Date.now。测试用它避免 fake timers。 */
  now?: () => number;
}

/**
 * 每条 assistant 消息的生命周期：
 *
 *     startMessage() → observeDelta()* → finish(outputTokens)
 *
 * 发射上限约每秒 2 次。回合被中止时没有 finish：下一次 startMessage 自会归零，
 * 不会留一个跨越两轮的起点。
 */
export class TokenSpeedReporter {
  private chars: StreamCharCounts = { ascii: 0, nonAscii: 0 };
  private firstDeltaAt: number | null = null;
  private lastEmitAt = 0;
  private calibration = 1;
  private readonly emit: (sample: TokenSpeedSample) => void;
  private readonly now: () => number;

  constructor(options: TokenSpeedReporterOptions) {
    this.emit = options.emit;
    this.now = options.now ?? Date.now;
  }

  startMessage(): void {
    this.chars = { ascii: 0, nonAscii: 0 };
    this.firstDeltaAt = null;
    this.lastEmitAt = 0;
  }

  observeDelta(delta: string): void {
    if (!delta) return;
    const counts = countStreamChars(delta);
    this.chars = {
      ascii: this.chars.ascii + counts.ascii,
      nonAscii: this.chars.nonAscii + counts.nonAscii,
    };

    const now = this.now();
    if (this.firstDeltaAt === null) {
      this.firstDeltaAt = now;
      this.lastEmitAt = now;
      return;
    }
    if (now - this.lastEmitAt < SPEED_EMIT_INTERVAL_MS) return;
    this.lastEmitAt = now;

    const elapsedMs = now - this.firstDeltaAt;
    if (elapsedMs <= 0) return;
    this.emit({
      tokensPerSecond:
        (rawTokenEstimate(this.chars) * this.calibration * 1000) / elapsedMs,
      estimated: true,
    });
  }

  finish(outputTokens: number): void {
    const firstDeltaAt = this.firstDeltaAt;
    if (firstDeltaAt !== null) {
      const elapsedMs = this.now() - firstDeltaAt;
      if (elapsedMs >= MIN_EXACT_WINDOW_MS && outputTokens > 0) {
        this.emit({
          tokensPerSecond: (outputTokens * 1000) / elapsedMs,
          estimated: false,
        });
      }
      this.calibration = nextCalibration(
        this.calibration,
        rawTokenEstimate(this.chars),
        outputTokens,
      );
    }
    this.startMessage();
  }
}
