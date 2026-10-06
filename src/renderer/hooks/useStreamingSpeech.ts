/**
 * @module renderer/hooks/useStreamingSpeech
 *
 * 流式朗读：模型还在生成时就把完整句送去合成并排队。
 *
 * 两个必须做对的地方：
 *  1. **入队顺序**。合成是并发的，块回来的顺序不保证；乱序入队会让朗读跳句。
 *     所以有一个**发布指针**：只有轮到的那一句的块能进队列，后句的块先缓存 ——
 *     等前一句的块全部排完（`done`）才放行。
 *  2. **「读完了」的判定**。流式文本在 end() 之前没人知道哪句是最后一句，而且
 *     每句的块是分批到的。所以等**所有在飞的流都结束**之后才调
 *     `queue.markLast()` —— 队列靠它区分「读完」与「合成还没跟上」。
 */
import type { AudioQueue } from "../utils/tts/audio-queue";
import type {
  SpeakStreamChunk,
  SpeakStreamHandlers,
} from "../utils/tts/speak-stream";
import { createSentenceStream } from "../utils/tts/stream-sentences";

export interface StreamingSpeechDeps {
  /** 发一次流式合成，返回取消函数。块按引擎的标点分段到达。 */
  speak: (text: string, handlers: SpeakStreamHandlers) => () => void;
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

export function createStreamingSpeech(
  deps: StreamingSpeechDeps,
): StreamingSpeech {
  const queue = deps.createQueue();
  let stream = createSentenceStream();
  let sentences: string[] = [];
  let generation = 0;
  let ended = false;
  let inFlight = 0;
  let waitingLast = false;
  let failures = 0;
  /** 本轮忽略前多少个字符。见 begin 的说明。 */
  let offset = 0;

  /**
   * 每句的块缓冲。块按到达顺序进这里；**只有发布指针轮到这一句时**才搬进队列。
   * 后句先到是常态（不同句是各自独立的流），所以这是必需的，不是防御性代码。
   * 缓存有界：只缓存「还没轮到」的句子，上界是一整句音频。
   */
  const buffers = new Map<
    number,
    { chunks: SpeakStreamChunk[]; done: boolean }
  >();
  /** 在飞的取消函数。只用 values/clear，所以是 Set 不是 Map。 */
  const cancels = new Set<() => void>();
  let nextToPublish = 0;
  const sentenceCbs = new Set<(index: number, text: string) => void>();
  const drainedCbs = new Set<() => void>();

  queue.onSentenceStart((index) => {
    const text = sentences[index];
    if (text === undefined) return;
    for (const cb of sentenceCbs) cb(index, text);
  });
  queue.onDrained(() => {
    if (!ended) return;
    for (const cb of drainedCbs) cb();
  });

  /**
   * 按句序把块搬进队列：句子 i 的块要全部排完，才允许 i+1 的块入队 ——
   * 否则后句的音频会排到前句前面。
   */
  const publish = () => {
    for (;;) {
      const buffer = buffers.get(nextToPublish);
      if (!buffer) break;
      for (const chunk of buffer.chunks) {
        queue.enqueue({
          sentenceIndex: nextToPublish,
          samples: chunk.samples,
          sampleRate: chunk.sampleRate,
        });
      }
      buffer.chunks = [];
      if (!buffer.done) break; // 这一句还没合成完，等它
      buffers.delete(nextToPublish);
      nextToPublish += 1;
    }
    // 所有在飞的流都结束之后，才允许宣布「读完」（markLast）。这替代了改造前
    // 那个 1 采样静音哨兵：时机一样，只是不再需要假音频。
    if (waitingLast && inFlight === 0) {
      waitingLast = false;
      queue.markLast();
    }
  };

  const synthesize = (index: number, text: string) => {
    const token = generation;
    inFlight += 1;
    /**
     * 必须**先声明再赋值**：桥缺失时 `speak` 会同步回调 `onError`，那时
     * `cancel` 还在 TDZ 里，直接读会抛 ReferenceError。
     */
    let cancel: (() => void) | null = null;
    const forget = () => {
      if (cancel) cancels.delete(cancel);
    };

    const bufferFor = () => {
      const existing = buffers.get(index);
      if (existing) return existing;
      const created = { chunks: [] as SpeakStreamChunk[], done: false };
      buffers.set(index, created);
      return created;
    };

    cancel = deps.speak(text, {
      onChunk: (chunk) => {
        if (token !== generation) return;
        bufferFor().chunks.push(chunk);
        if (index === nextToPublish) publish();
      },
      onDone: () => {
        forget();
        if (token !== generation) return;
        bufferFor().done = true;
        inFlight -= 1;
        publish();
      },
      onError: () => {
        forget();
        if (token !== generation) return;
        // 首块前失败与出过声后失败走同一条：**补出 buffer 再标 done**，否则发布
        // 指针会永远卡在这一句上。已经入队的块留着（已播部分不收回）。
        failures += 1;
        bufferFor().done = true;
        inFlight -= 1;
        publish();
      },
    });
    cancels.add(cancel);
  };

  const addSentence = (text: string) => {
    const index = sentences.length;
    sentences.push(text);
    synthesize(index, text);
  };

  return {
    begin(fromCharOffset = 0) {
      generation += 1;
      for (const cancel of cancels) cancel();
      cancels.clear();
      queue.stop();
      stream = createSentenceStream();
      sentences = [];
      buffers.clear();
      ended = false;
      inFlight = 0;
      waitingLast = false;
      nextToPublish = 0;
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
      waitingLast = true;
      publish();
    },
    stop() {
      generation += 1;
      for (const cancel of cancels) cancel();
      cancels.clear();
      queue.stop();
      buffers.clear();
      ended = false;
      inFlight = 0;
      waitingLast = false;
      nextToPublish = 0;
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
