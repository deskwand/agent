/**
 * @module renderer/utils/tts/audio-queue
 *
 * 顺序播放一串合成好的音频。一次只播一句，上一句结束立刻起下一句。
 *
 * AudioContext 是注入的：单测塞替身，不必真的出声（jsdom 里也没有 Web Audio）。
 */

export interface QueuedAudio {
  /** 句子在整条回复里的序号，用于高亮。 */
  index: number;
  samples: Float32Array;
  sampleRate: number;
  /** 最后一句。**只有它播完才算「全部读完」** —— 见下面 playNext 的注释。 */
  isLast?: boolean;
}

export interface AudioQueue {
  enqueue(item: QueuedAudio): void;
  onSentenceStart(callback: (index: number) => void): void;
  onDrained(callback: () => void): void;
  pause(): void;
  resume(): void;
  stop(): void;
  playing(): boolean;
}

export function createAudioQueue({
  createContext,
}: {
  createContext: () => AudioContext;
}): AudioQueue {
  const context = createContext();
  const startCallbacks = new Set<(index: number) => void>();
  const drainedCallbacks = new Set<() => void>();
  const pending: QueuedAudio[] = [];
  let current: AudioBufferSourceNode | null = null;
  let sawLast = false;
  /**
   * 场次号。stop() 也会触发 onended（而且是异步到的）—— 用它把「主动停」与
   * 「播完了」分开，否则停止后迟到的 onended 会把刚开始的新会话清掉。
   */
  let generation = 0;

  const playNext = () => {
    if (current) return;
    const next = pending.shift();
    if (!next) {
      // 只有「最后一句已经播完」才算读完。合成比播放慢时队列会短暂播空
      // （MeloTTS 的 RTF 是 0.71）—— 那一刻不能判定为读完，否则朗读会在
      // 句子之间被中途切断。
      if (sawLast) for (const callback of drainedCallbacks) callback();
      return;
    }
    if (next.isLast) sawLast = true;
    const token = generation;

    const buffer = context.createBuffer(
      1,
      next.samples.length,
      next.sampleRate,
    );
    // TS 5.9 起 `Float32Array` 默认是 `Float32Array<ArrayBufferLike>`，而
    // copyToChannel 要 `Float32Array<ArrayBuffer>`。我们的采样来自 sherpa 的
    // Float32Array + 结构化克隆，一定是普通 ArrayBuffer —— 断言就是说明这件事，
    // 不是绕过类型检查。用 getChannelData().set() 也行，但那要动测试替身。
    buffer.copyToChannel(next.samples as Float32Array<ArrayBuffer>, 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.onended = () => {
      if (token !== generation) return;
      current = null;
      playNext();
    };
    current = source;

    for (const callback of startCallbacks) callback(next.index);
    source.start();
  };

  return {
    enqueue(item) {
      pending.push(item);
      playNext();
    },
    onSentenceStart(callback) {
      startCallbacks.add(callback);
    },
    onDrained(callback) {
      drainedCallbacks.add(callback);
    },
    pause() {
      void context.suspend();
    },
    resume() {
      void context.resume();
    },
    stop() {
      generation++;
      pending.length = 0;
      sawLast = false;
      current?.stop();
      current = null;
      void context.resume(); // 挂着暂停时停止，下次开始要能出声
    },
    playing() {
      return current !== null || pending.length > 0;
    },
  };
}
