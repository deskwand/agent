/**
 * @module renderer/utils/tts/audio-queue
 *
 * 顺序播放一串合成好的音频块。同一句的多个块**首尾相接**（无缝），上一句结束
 * 立刻起下一句。
 *
 * 两个必须做对的地方：
 *  1. **无缝**。块之间不能各播各的 —— 那时每一块都要等主线程把 `start()` 排上，
 *     接缝会以爆音/断续的形式被听见。所以这里用 `nextStartTime` 提前排期，不靠
 *     `onended` 串联。
 *  2. **高亮按播放时刻推**。队列能跑到声音前面去（朗读会把整段音频很快排完），
 *     按"入队"或"排期"触发高亮会让字幕跑到音频前面。判据只能用
 *     `context.currentTime`，它在 `suspend()` 时冻结 —— 挂起/播空/超前排期三种
 *     情况下都对。
 *
 * AudioContext 是注入的：单测塞替身，不必真的出声（jsdom 里也没有 Web Audio）。
 */

/** 排期提前量。给主线程抖动留余量；接缝的正当性由"无 >5ms 空隙"的验收兜底。 */
const LOOKAHEAD_SECONDS = 0.02;
/** 高亮轮询间隔。只在有等待触发的句子时运行。 */
const TICK_MS = 25;

export interface QueuedAudio {
  /** 句子序号：同一句的多个块共享它，高亮按它推进。 */
  sentenceIndex: number;
  samples: Float32Array;
  sampleRate: number;
}

export interface AudioQueue {
  enqueue(item: QueuedAudio): void;
  /**
   * 由调用方在"不会再有块"时调用（语音对话：所有在飞的流结束；朗读：最后一段发完）。
   * **只有它设过之后，队列播空才算「读完」** —— 否则合成比播放慢时会在句子之间
   * 被判定为读完。
   */
  markLast(): void;
  onSentenceStart(callback: (sentenceIndex: number) => void): void;
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
  const startCallbacks = new Set<(sentenceIndex: number) => void>();
  const drainedCallbacks = new Set<() => void>();
  const pending: QueuedAudio[] = [];
  /**
   * 场次号。stop() 也会触发 onended（而且是异步到的）—— 用它把「主动停」与
   * 「播完了」分开，否则停止后迟到的 onended 会把刚开始的新会话清掉。
   */
  let generation = 0;
  const scheduled = new Set<AudioBufferSourceNode>();
  /** 下一块的**播放起点**（AudioContext 时间轴）。挂起时它跟着冻结。 */
  let nextStartTime = 0;
  /** 已触发过高亮的句子。 */
  const announced = new Set<number>();
  /** 等待触发的句子起点。 */
  const markers: Array<{ sentenceIndex: number; at: number }> = [];
  let ticker: ReturnType<typeof setInterval> | null = null;
  let sawLast = false;

  const stopTicker = () => {
    if (ticker) clearInterval(ticker);
    ticker = null;
  };

  const startTicker = () => {
    if (ticker) return;
    ticker = setInterval(() => {
      const now = context.currentTime;
      while (markers.length > 0 && markers[0].at <= now) {
        const marker = markers.shift()!;
        if (announced.has(marker.sentenceIndex)) continue;
        announced.add(marker.sentenceIndex);
        for (const callback of startCallbacks) callback(marker.sentenceIndex);
      }
      if (
        markers.length === 0 &&
        scheduled.size === 0 &&
        pending.length === 0
      ) {
        stopTicker();
      }
    }, TICK_MS);
  };

  const fireDrained = () => {
    if (!sawLast || pending.length > 0 || scheduled.size > 0) return;
    stopTicker();
    for (const callback of drainedCallbacks) callback();
  };

  const scheduleItem = (next: QueuedAudio) => {
    const token = generation;

    const buffer = context.createBuffer(
      1,
      next.samples.length,
      next.sampleRate,
    );
    // TS 5.9 起 `Float32Array` 默认是 `Float32Array<ArrayBufferLike>`，而
    // copyToChannel 要 `Float32Array<ArrayBuffer>`。我们的采样来自 sherpa 的
    // Float32Array + 结构化克隆，一定是普通 ArrayBuffer —— 断言就是说明这件事，
    // 不是绕过类型检查。
    buffer.copyToChannel(next.samples as Float32Array<ArrayBuffer>, 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);

    // 首尾相接：下一块的起点就是上一块的终点。第一块从「现在 + 提前量」起。
    const startAt = Math.max(
      context.currentTime + LOOKAHEAD_SECONDS,
      nextStartTime,
    );
    nextStartTime = startAt + buffer.duration;
    if (!announced.has(next.sentenceIndex)) {
      markers.push({ sentenceIndex: next.sentenceIndex, at: startAt });
      markers.sort((a, b) => a.at - b.at);
    }

    scheduled.add(source);
    source.onended = () => {
      scheduled.delete(source);
      if (token !== generation) return;
      fireDrained();
    };
    startTicker();
    source.start(startAt);
  };

  /**
   * 入队即排期（全部排完，不保留 pending 里的等待项）：排期本身不吃 CPU，
   * 留着不做只会让块之间出现接缝。代价是排期后 AudioBuffer 会再存一份
   * Float32 —— 与朗读最长一段音频同量级，不值得为它引入前瞻窗口。
   */
  const drainPending = () => {
    for (let next = pending.shift(); next; next = pending.shift()) {
      scheduleItem(next);
    }
  };

  return {
    enqueue(item) {
      pending.push(item);
      drainPending();
    },
    markLast() {
      sawLast = true;
      fireDrained(); // 音频可能早就播完了（markLast 比播放晚到）
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
      stopTicker();
      pending.length = 0;
      // 逐个停：只清 pending 会漏掉「已排期但还没响」的块 —— 症状是打断后还在出声。
      for (const source of scheduled) source.stop();
      scheduled.clear();
      markers.length = 0;
      announced.clear();
      nextStartTime = 0;
      sawLast = false;
      void context.resume(); // 挂着暂停时停止，下次开始要能出声
    },
    playing() {
      return scheduled.size > 0 || pending.length > 0;
    },
  };
}
