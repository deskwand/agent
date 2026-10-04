/**
 * @module renderer/hooks/useStreamingSpeech
 *
 * 流式朗读：模型还在生成时就把完整句送去合成并排队。
 *
 * 两个必须做对的地方：
 *  1. **入队顺序**。合成是并发的，回来的顺序不保证；乱序入队会让朗读跳句。
 *     所以用一个 ready 表按句号顺序出队。
 *  2. **「读完了」的判定**。audio-queue 靠 isLast 标记认结尾，而流式文本在
 *     end() 之前没人知道哪句是最后一句。所以 end() 时补一个 1 采样的静音哨兵，
 *     并等所有合成回来后才能入队它 —— 否则哨兵会插到句子前面，提前触发 drained。
 */
import type { TtsSpeakResult } from "../../shared/ipc-types";
import type { AudioQueue } from "../utils/tts/audio-queue";
import { createSentenceStream } from "../utils/tts/stream-sentences";

export interface StreamingSpeechDeps {
  speak: (text: string) => Promise<TtsSpeakResult>;
  createQueue: () => AudioQueue;
}

export interface StreamingSpeech {
  /**
   * 开始一轮朗读。
   *
   * `fromCharOffset` 是**累计全量文本**里的字符偏移：打断后恢复朗读时用它
   * 跳过已经念过的部分。句子流只看偏移之后的内容，所以索引从 0 重新排也不
   * 影响外部 —— 调用方只认 `onSentence` 回传的文本。
   */
  begin(fromCharOffset?: number): void;
  push(fullText: string): void;
  end(): void;
  stop(): void;
  onSentence(cb: (index: number, text: string) => void): void;
  onDrained(cb: () => void): void;
  /** 合成失败被跳过的句子数量，用于字幕标注。 */
  failedCount(): number;
}

/** 1 采样的静音：只为了让队列知道「后面没有了」。 */
const TAIL_SAMPLES = new Float32Array(1);
const TAIL_RATE = 24000;

export function createStreamingSpeech(
  deps: StreamingSpeechDeps,
): StreamingSpeech {
  const queue = deps.createQueue();
  let stream = createSentenceStream();
  let sentences: string[] = [];
  let generation = 0;
  let ended = false;
  let inFlight = 0;
  let waitingTail = false;
  let nextToEnqueue = 0;
  let failures = 0;
  /** 本轮忽略前多少个字符。见 begin 的说明。 */
  let offset = 0;

  const ready = new Map<
    number,
    { samples: Float32Array; sampleRate: number }
  >();
  const sentenceCbs = new Set<(index: number, text: string) => void>();
  const drainedCbs = new Set<() => void>();

  queue.onSentenceStart((index) => {
    const text = sentences[index];
    if (text === undefined) return; // 哨兵
    for (const cb of sentenceCbs) cb(index, text);
  });
  queue.onDrained(() => {
    if (!ended) return;
    for (const cb of drainedCbs) cb();
  });

  const enqueueReady = () => {
    for (;;) {
      const item = ready.get(nextToEnqueue);
      if (!item) break;
      ready.delete(nextToEnqueue);
      queue.enqueue({
        index: nextToEnqueue,
        samples: item.samples,
        sampleRate: item.sampleRate,
        isLast: false,
      });
      nextToEnqueue += 1;
    }
    if (waitingTail && inFlight === 0) {
      waitingTail = false;
      queue.enqueue({
        index: -1,
        samples: TAIL_SAMPLES,
        sampleRate: TAIL_RATE,
        isLast: true,
      });
    }
  };

  const synthesize = (index: number, text: string) => {
    const token = generation;
    inFlight += 1;
    void deps
      .speak(text)
      .then((result) => {
        if (token !== generation) return;
        if (result.ok) {
          ready.set(index, {
            samples: result.samples,
            sampleRate: result.sampleRate,
          });
        } else {
          failures += 1;
        }
      })
      .catch(() => {
        if (token === generation) failures += 1;
      })
      .finally(() => {
        if (token !== generation) return;
        inFlight -= 1;
        enqueueReady();
      });
  };

  const addSentence = (text: string) => {
    const index = sentences.length;
    sentences.push(text);
    synthesize(index, text);
  };

  return {
    begin(fromCharOffset = 0) {
      generation += 1;
      queue.stop();
      stream = createSentenceStream();
      sentences = [];
      ready.clear();
      ended = false;
      inFlight = 0;
      waitingTail = false;
      nextToEnqueue = 0;
      failures = 0;
      offset = fromCharOffset;
    },
    push(fullText) {
      if (ended) return;
      // 偏移在这里切，不在调用方：调用方永远交**累计全文**，一个入口一个语义。
      // 句子流的 consumed 是单调的，而 `slice(offset)` 对同一份前缀也单调，
      // 两者一致。
      for (const text of stream.push(fullText.slice(offset))) addSentence(text);
    },
    end() {
      if (ended) return;
      ended = true;
      for (const text of stream.flush()) addSentence(text);
      waitingTail = true;
      enqueueReady();
    },
    stop() {
      generation += 1;
      queue.stop();
      ready.clear();
      ended = false;
      inFlight = 0;
      waitingTail = false;
      nextToEnqueue = 0;
    },
    onSentence(cb) {
      sentenceCbs.add(cb);
    },
    onDrained(cb) {
      drainedCbs.add(cb);
    },
    failedCount() {
      return failures;
    },
  };
}

// 刻意不提供"默认依赖"工厂：队列背后的 AudioContext 必须由调用方持有，
// 才能在自己的清理钩子里 close 掉（见 useVoiceMode）。多一个默认工厂，就等于
// 多一条没人负责释放的 AudioContext 泄漏路径。
