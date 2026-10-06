// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createAudioQueue } from "../../renderer/utils/tts/audio-queue";

/** 极简 AudioContext 替身：只实现队列用到的那几个成员。 */
function fakeContext() {
  const started: number[] = [];
  const sources: Array<{
    onended: (() => void) | null;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  }> = [];
  const context = {
    currentTime: 0,
    destination: {},
    createBuffer: (_channels: number, length: number, sampleRate: number) => ({
      length,
      duration: length / sampleRate,
      copyToChannel: vi.fn(),
    }),
    createBufferSource: () => {
      const source = {
        buffer: null as unknown,
        connect: vi.fn(),
        start: vi.fn(() => started.push(sources.length)),
        stop: vi.fn(),
        onended: null as (() => void) | null,
      };
      sources.push(source);
      return source;
    },
    suspend: vi.fn(async () => {}),
    resume: vi.fn(async () => {}),
  };
  return { context, sources, started };
}

const item = (sentenceIndex: number) => ({
  sentenceIndex,
  samples: new Float32Array(4410), // 0.1s @44.1kHz
  sampleRate: 44100,
});

describe("播放队列", () => {
  it("同一句的多个块首尾相接：第二块的 start 等于第一块的结束时刻", () => {
    const { context, sources } = fakeContext();
    const queue = createAudioQueue({ createContext: () => context as never });
    queue.enqueue(item(0));
    queue.enqueue(item(0));

    expect(sources[0].start).toHaveBeenCalledWith(0.02); // LOOKAHEAD
    expect(sources[1].start).toHaveBeenCalledWith(0.02 + 0.1);
  });

  it("跨句也首尾相接，且不打断正在播的那一块", () => {
    const { context, sources } = fakeContext();
    const queue = createAudioQueue({ createContext: () => context as never });
    queue.enqueue(item(0));
    queue.enqueue(item(1));

    expect(sources[0].stop).not.toHaveBeenCalled();
    expect(sources[1].start).toHaveBeenCalledWith(0.02 + 0.1);
  });

  it("高亮按句触发一次，且与播放时刻对齐（不是入队时刻）", () => {
    vi.useFakeTimers();
    try {
      const { context } = fakeContext();
      const queue = createAudioQueue({ createContext: () => context as never });
      const started: number[] = [];
      queue.onSentenceStart((i) => started.push(i));

      queue.enqueue(item(0));
      queue.enqueue(item(0)); // 同句第二块
      queue.enqueue(item(1));
      expect(started).toEqual([]); // 还没到播放时刻

      context.currentTime = 0.03;
      vi.advanceTimersByTime(25);
      expect(started).toEqual([0]);

      context.currentTime = 0.23;
      vi.advanceTimersByTime(25);
      expect(started).toEqual([0, 1]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("markLast 之后、最后一块播完才通知 drained", () => {
    const { context, sources } = fakeContext();
    const queue = createAudioQueue({ createContext: () => context as never });
    const drained = vi.fn();
    queue.onDrained(drained);

    queue.enqueue(item(0));
    queue.enqueue(item(0));
    queue.markLast();
    expect(drained).not.toHaveBeenCalled(); // 还没播完

    sources[0].onended?.();
    expect(drained).not.toHaveBeenCalled();
    sources[1].onended?.();
    expect(drained).toHaveBeenCalledTimes(1);
  });

  it("合成比播放慢时，队列播空不算读完", () => {
    // MeloTTS 的 RTF 是 0.69：慢机器上合成会跟不上播放，队列会短暂播空。
    // 那一刻**不能**判定为读完，否则朗读会在句子之间被中途切断。
    const { context, sources } = fakeContext();
    const queue = createAudioQueue({ createContext: () => context as never });
    const drained = vi.fn();
    queue.onDrained(drained);

    queue.enqueue(item(0));
    sources[0].onended?.();
    expect(drained).not.toHaveBeenCalled();

    queue.enqueue(item(1));
    queue.markLast();
    sources[1].onended?.();
    expect(drained).toHaveBeenCalledTimes(1);
  });

  it("音频早就播完后才 markLast，也要补一次 drained", () => {
    const { context, sources } = fakeContext();
    const queue = createAudioQueue({ createContext: () => context as never });
    const drained = vi.fn();
    queue.onDrained(drained);

    queue.enqueue(item(0));
    sources[0].onended?.();
    queue.markLast();
    expect(drained).toHaveBeenCalledTimes(1);
  });

  it("停止后，迟到的 onended 不会触发 drained", () => {
    const { context, sources } = fakeContext();
    const queue = createAudioQueue({ createContext: () => context as never });
    const drained = vi.fn();
    queue.onDrained(drained);
    queue.enqueue(item(0));
    queue.markLast();

    queue.stop();
    sources[0].onended?.(); // stop() 触发的 onended 是异步到的
    expect(drained).not.toHaveBeenCalled();
  });

  it("停止会逐个停掉已排期的块（打断后不能还在出声）", () => {
    const { context, sources } = fakeContext();
    const queue = createAudioQueue({ createContext: () => context as never });
    queue.enqueue(item(0));
    queue.enqueue(item(0));
    queue.enqueue(item(1));

    queue.stop();
    expect(sources.every((s) => s.stop.mock.calls.length === 1)).toBe(true);
    expect(queue.playing()).toBe(false);
  });

  it("暂停与继续走 context.suspend / resume", () => {
    const { context } = fakeContext();
    const queue = createAudioQueue({ createContext: () => context as never });
    queue.enqueue(item(0));

    queue.pause();
    expect(context.suspend).toHaveBeenCalled();
    queue.resume();
    expect(context.resume).toHaveBeenCalled();
  });
});
