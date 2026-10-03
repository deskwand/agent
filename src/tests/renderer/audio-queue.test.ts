// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createAudioQueue } from "../../renderer/utils/tts/audio-queue";

/** 极简 AudioContext 替身：只实现队列用到的那几个成员。 */
function fakeContext() {
  const started: number[] = [];
  const sources: Array<{
    onended: (() => void) | null;
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

const item = (index: number) => ({
  index,
  samples: new Float32Array(4410),
  sampleRate: 44100,
});

describe("播放队列", () => {
  it("按入队顺序播，每句开始时通知一次", () => {
    const { context, sources } = fakeContext();
    const queue = createAudioQueue({ createContext: () => context as never });
    const onStart = vi.fn();
    queue.onSentenceStart(onStart);

    queue.enqueue(item(0));
    expect(onStart).toHaveBeenLastCalledWith(0);
    expect(sources).toHaveLength(1);

    // 第一句播完才起第二句
    sources[0].onended?.();
    queue.enqueue(item(1));
    expect(onStart).toHaveBeenLastCalledWith(1);
  });

  it("上一句还没播完时入队，不会打断它", () => {
    const { context, sources } = fakeContext();
    const queue = createAudioQueue({ createContext: () => context as never });
    queue.enqueue(item(0));
    queue.enqueue(item(1));
    expect(sources).toHaveLength(1); // 第二句排队等着
    sources[0].onended?.();
    expect(sources).toHaveLength(2);
  });

  it("最后一句播完才通知 drained", () => {
    const { context, sources } = fakeContext();
    const queue = createAudioQueue({ createContext: () => context as never });
    const drained = vi.fn();
    queue.onDrained(drained);

    queue.enqueue(item(0));
    queue.enqueue({ ...item(1), isLast: true });
    sources[0].onended?.();
    expect(drained).not.toHaveBeenCalled();
    sources[1].onended?.();
    expect(drained).toHaveBeenCalledTimes(1);
  });

  it("合成比播放慢时，队列播空不算读完", () => {
    // MeloTTS 的 RTF 是 0.71：慢机器上合成会跟不上播放，队列会短暂播空。
    // 那一刻**不能**判定为读完，否则朗读会在句子之间被中途切断。
    const { context, sources } = fakeContext();
    const queue = createAudioQueue({ createContext: () => context as never });
    const drained = vi.fn();
    queue.onDrained(drained);

    queue.enqueue(item(0));
    sources[0].onended?.();
    expect(drained).not.toHaveBeenCalled();

    queue.enqueue({ ...item(1), isLast: true });
    sources[1].onended?.();
    expect(drained).toHaveBeenCalledTimes(1);
  });

  it("停止后，迟到的 onended 不会触发 drained", () => {
    const { context, sources } = fakeContext();
    const queue = createAudioQueue({ createContext: () => context as never });
    const drained = vi.fn();
    queue.onDrained(drained);
    queue.enqueue({ ...item(0), isLast: true });

    queue.stop();
    sources[0].onended?.(); // stop() 触发的 onended 是异步到的
    expect(drained).not.toHaveBeenCalled();
  });

  it("停止后清空队列，并且不再播", () => {
    const { context, sources } = fakeContext();
    const queue = createAudioQueue({ createContext: () => context as never });
    queue.enqueue(item(0));
    queue.enqueue(item(1));

    queue.stop();
    expect(sources[0].stop).toHaveBeenCalled();
    sources[0].onended?.(); // stop 触发的 ended 不能被当成「播完了」
    expect(sources).toHaveLength(1);
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
