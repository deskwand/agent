/**
 * @module main/voice/session
 *
 * 一次录音的会话：把引擎的段落累积成完整文本，并处理两件本地方案特有的事。
 *
 * 1. **误触丢弃**：按下即开始录（不切字），松开时若总时长不足 400ms 且没出任何
 *    文字，就当误触丢掉。云端方案必须加"按住 200ms 才启动"的门槛，而那会切掉
 *    真实说话的开头；本地不计费，所以可以反过来设计。见设计文档 §3.4。
 * 2. **收尾**：松开后引擎还有未定稿的尾巴，finish() 才吐出来。
 */
import type { VoiceErrorCode } from "../../shared/ipc-types";
import {
  SAMPLE_RATE,
  type TranscriptionEngine,
  type TranscriptionStream,
} from "./transcription-engine";

/** 短于这个时长且没出文字 → 判为误触。 */
export const WRONG_TOUCH_MS = 400;

export interface VoiceSessionEvents {
  /** 累积到此刻的完整文本（段落 + 实时那一段）。 */
  onPartial: (text: string) => void;
  onDone: (payload: { text: string; discarded: boolean }) => void;
  onError: (code: VoiceErrorCode, message: string) => void;
}

export interface VoiceSessionOptions {
  engine: TranscriptionEngine;
  events: VoiceSessionEvents;
}

export class VoiceSession {
  private readonly stream: TranscriptionStream;
  private readonly events: VoiceSessionEvents;
  private readonly segments: string[] = [];
  private partial = "";
  private pushedSamples = 0;
  private closed = false;
  private aborted = false;
  /** 上一次推给渲染层的文本。帧率是 10Hz，而文字可能几秒不动。 */
  private lastEmitted = "";

  constructor({ engine, events }: VoiceSessionOptions) {
    this.events = events;
    this.stream = engine.createStream();
  }

  push(samples: Int16Array): void {
    if (this.closed) return;
    try {
      // 引擎吃 Float32；ipc 过来的就是 16k 单声道 PCM16
      const floats = new Float32Array(samples.length);
      for (let i = 0; i < samples.length; i += 1)
        floats[i] = samples[i] / 0x8000;
      const update = this.stream.push(floats);
      this.pushedSamples += samples.length;

      if (update.segment) {
        this.segments.push(update.segment);
        this.partial = "";
      } else {
        this.partial = update.partial;
      }

      const text = this.text();
      // 只在真变了才推：不判的话 30 秒听写会推 300 次，每次都让输入框 re-render 一次。
      if (text && text !== this.lastEmitted) {
        this.lastEmitted = text;
        this.events.onPartial(text);
      }
    } catch (error) {
      this.events.onError(
        "VOICE_ENGINE_FAILED",
        error instanceof Error ? error.message : String(error),
      );
      this.closed = true;
    }
  }

  async stop(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    if (this.aborted) return;

    const durationMs = (this.pushedSamples / SAMPLE_RATE) * 1000;
    let tail = "";
    try {
      tail = (await this.stream.finish()).text;
    } catch {
      // 收尾失败不丢弃已有结果
    }
    // finish() 返回的是**这一段的最终完整文本**（含 partial 里已经推过的内容），
    // 不是增量 —— 见 TranscriptionResult 的注释。所以有 tail 就用 tail 取代 partial，
    // 没有才退回落最后一次 partial。
    if (tail) this.segments.push(tail);
    else if (this.partial) this.segments.push(this.partial);
    this.partial = "";

    const text = this.text();
    const discarded = !text && durationMs < WRONG_TOUCH_MS;
    this.events.onDone({ text, discarded });
  }

  /** 丢弃：不发 done，也不发 error。 */
  abort(): void {
    if (this.closed) return;
    this.aborted = true;
    this.closed = true;
    this.stream.abort();
  }

  private text(): string {
    return this.segments.join("") + this.partial;
  }
}
