/**
 * @module main/voice/transcription-engine
 *
 * 转写引擎的流式接口。
 *
 * 为什么是「流进、事件出」而不是「一段进一段出」：本地引擎原生就是流式的，
 * 而云端兜底（二期）需要会话层切片。把形态定成流式，两条路共用同一套上层。
 * 这也是设计文档 §3.2 与旧版的相反之处 —— 当时砍掉流式分支是因为它没有实现、
 * 无法测试；现在它有唯一实现且有明确第二实现，不再是投机抽象。
 */

/** 16kHz / 单声道 / PCM16 —— 全链路唯一口径。 */
export const SAMPLE_RATE = 16000;

export interface TranscribeUpdate {
  /** 当前这一段的实时文本（全量，不是增量）。 */
  partial: string;
  /** 本段已定稿（引擎命中 endpoint）。调用方应把它追加到累积结果里。 */
  segment?: string;
}

export interface TranscriptionResult {
  /**
   * 收尾时**当前这一段的最终完整文本**，不是增量。
   *
   * 约定成「整段」而不是「增量」是因为两边天然都这样：本地引擎的 decoder 里就存着
   * 整段（`readPartial()` 返回的就是它）；二期云端也是拿一个切片的全文。
   * 所以调用方遇到 `text` 非空时应当用它**取代**已累积的 partial，而不是追加。
   * 没有更多内容时返回空串。
   */
  text: string;
}

export interface TranscriptionStream {
  push(samples: Float32Array): TranscribeUpdate;
  /** 收尾：把尾巴吐出来。幂等。 */
  finish(): Promise<TranscriptionResult>;
  /** 丢弃。之后的 push 不再喂给引擎。 */
  abort(): void;
}

export interface TranscriptionEngine {
  createStream(): TranscriptionStream;
}
