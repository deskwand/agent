import { describe, it, expect, vi } from "vitest";
import { createStreamingSpeech } from "../../renderer/hooks/useStreamingSpeech";
import type {
  AudioQueue,
  QueuedAudio,
} from "../../renderer/utils/tts/audio-queue";
import type { TtsSpeakResult } from "../../shared/ipc-types";

function fakeQueue() {
  const enqueued: QueuedAudio[] = [];
  let startCb: ((i: number) => void) | null = null;
  let drainedCb: (() => void) | null = null;
  const queue: AudioQueue = {
    enqueue: (item) => {
      enqueued.push(item);
    },
    onSentenceStart: (cb) => {
      startCb = cb;
    },
    onDrained: (cb) => {
      drainedCb = cb;
    },
    pause: () => {},
    resume: () => {},
    stop: () => {
      enqueued.length = 0;
    },
    playing: () => enqueued.length > 0,
  };
  return {
    queue,
    enqueued,
    fireStart: (i: number) => startCb?.(i),
    fireDrained: () => drainedCb?.(),
  };
}

function ok(text: string): TtsSpeakResult {
  return {
    ok: true,
    samples: new Float32Array([text.length]),
    sampleRate: 24000,
  };
}

describe("createStreamingSpeech", () => {
  it("enqueues sentences in order even when synthesis finishes out of order", async () => {
    const { queue, enqueued } = fakeQueue();
    const resolvers: Array<() => void> = [];
    const speak = vi.fn(
      (text: string): Promise<TtsSpeakResult> =>
        new Promise<TtsSpeakResult>((resolve) => {
          resolvers.push(() => resolve(ok(text)));
        }),
    );

    const speech = createStreamingSpeech({ speak, createQueue: () => queue });
    speech.begin();
    speech.push("第一句。第二句。第三句。");
    speech.end(); // 哨兵只在 end() 时补

    // 手动以「倒序」完成合成
    resolvers[2]();
    resolvers[1]();
    resolvers[0]();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(enqueued.map((e) => e.index)).toEqual([0, 1, 2, -1]); // -1 是结束哨兵
  });

  it("stop clears the queue and makes later pushes inert", async () => {
    const { queue, enqueued } = fakeQueue();
    const speech = createStreamingSpeech({
      speak: async (t: string): Promise<TtsSpeakResult> => ok(t),
      createQueue: () => queue,
    });
    speech.begin();
    speech.push("一句。");
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve(); // 等合成结果入队
    expect(enqueued.filter((e) => e.index >= 0)).toHaveLength(1);
    speech.stop();
    expect(enqueued.filter((e) => e.index >= 0)).toHaveLength(0);
    speech.push("二句。");
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(enqueued.filter((e) => e.index >= 0)).toHaveLength(0);
  });

  it("only fires drained after end()", async () => {
    const { queue, fireDrained } = fakeQueue();
    const speech = createStreamingSpeech({
      speak: async (t: string): Promise<TtsSpeakResult> => ok(t),
      createQueue: () => queue,
    });
    const onDrained = vi.fn();
    speech.onDrained(onDrained);
    speech.begin();
    speech.push("一句。");
    fireDrained();
    expect(onDrained).not.toHaveBeenCalled();
    speech.end();
    await Promise.resolve();
    fireDrained();
    expect(onDrained).toHaveBeenCalledTimes(1);
  });
  // 打断后恢复朗读：已经念过的部分不能重念。"第一句。" 占 4 个字符，
  // 所以从偏移 4 恢复应当只念第二句。
  it("begin 带偏移时只念偏移之后的部分", async () => {
    const { queue } = fakeQueue();
    const spoken: string[] = [];
    const speech = createStreamingSpeech({
      speak: async (t: string): Promise<TtsSpeakResult> => {
        spoken.push(t);
        return ok(t);
      },
      createQueue: () => queue,
    });

    speech.begin(4);
    speech.push("第一句。第二句。");
    speech.end();
    await Promise.resolve();
    await Promise.resolve();

    expect(spoken).toEqual(["第二句。"]);
  });

  it("不带偏移时从头念（默认行为不变）", async () => {
    const { queue } = fakeQueue();
    const spoken: string[] = [];
    const speech = createStreamingSpeech({
      speak: async (t: string): Promise<TtsSpeakResult> => {
        spoken.push(t);
        return ok(t);
      },
      createQueue: () => queue,
    });

    speech.begin();
    speech.push("第一句。第二句。");
    speech.end();
    await Promise.resolve();
    await Promise.resolve();

    expect(spoken).toEqual(["第一句。", "第二句。"]);
  });
});
