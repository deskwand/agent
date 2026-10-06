import { describe, it, expect, vi } from "vitest";
import { createStreamingSpeech } from "../../renderer/hooks/useStreamingSpeech";
import type {
  AudioQueue,
  QueuedAudio,
} from "../../renderer/utils/tts/audio-queue";
import type {
  SpeakStreamChunk,
  SpeakStreamHandlers,
} from "../../renderer/utils/tts/speak-stream";

function fakeQueue() {
  const enqueued: QueuedAudio[] = [];
  let startCb: ((i: number) => void) | null = null;
  let drainedCb: (() => void) | null = null;
  let lastCalls = 0;
  const queue: AudioQueue = {
    enqueue: (item) => {
      enqueued.push(item);
    },
    markLast: () => {
      lastCalls += 1;
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
    markLastCalls: () => lastCalls,
    fireStart: (i: number) => startCb?.(i),
    fireDrained: () => drainedCb?.(),
  };
}

/** 按句子文本抓住每条流的 handler，由测试自己驱动。 */
function fakeSpeak() {
  const streams = new Map<string, SpeakStreamHandlers>();
  const cancelled: string[] = [];
  return {
    streams,
    cancelled,
    speak: (text: string, handlers: SpeakStreamHandlers) => {
      streams.set(text, handlers);
      return () => {
        cancelled.push(text);
      };
    },
  };
}

const chunk = (length: number): SpeakStreamChunk => ({
  samples: new Float32Array(length),
  sampleRate: 24000,
});

describe("createStreamingSpeech", () => {
  it("按句序发布：后句的块先到也不能越位", () => {
    const { queue, enqueued } = fakeQueue();
    const speaker = fakeSpeak();
    const speech = createStreamingSpeech({
      speak: speaker.speak,
      createQueue: () => queue,
    });

    speech.begin();
    speech.push("第一句。第二句。");
    speech.end();

    // 第二句先完成
    speaker.streams.get("第二句。")!.onChunk(chunk(2));
    speaker.streams.get("第二句。")!.onDone();
    expect(enqueued.map((e) => e.sentenceIndex)).toEqual([]); // 被发布指针挡住

    speaker.streams.get("第一句。")!.onChunk(chunk(2));
    speaker.streams.get("第一句。")!.onDone();
    expect(enqueued.map((e) => e.sentenceIndex)).toEqual([0, 1]);
  });

  it("同一句的多个块按到达顺序排在同一个 sentenceIndex 下", () => {
    const { queue, enqueued } = fakeQueue();
    const speaker = fakeSpeak();
    const speech = createStreamingSpeech({
      speak: speaker.speak,
      createQueue: () => queue,
    });
    speech.begin();
    speech.push("第一句。");
    speech.end();

    speaker.streams.get("第一句。")!.onChunk(chunk(2));
    speaker.streams.get("第一句。")!.onChunk(chunk(3));
    speaker.streams.get("第一句。")!.onChunk(chunk(4));
    speaker.streams.get("第一句。")!.onDone();

    expect(enqueued.map((e) => e.samples.length)).toEqual([2, 3, 4]);
    expect(enqueued.every((e) => e.sentenceIndex === 0)).toBe(true);
  });

  it("所有在飞流都结束之后才 markLast", () => {
    const { queue, markLastCalls } = fakeQueue();
    const speaker = fakeSpeak();
    const speech = createStreamingSpeech({
      speak: speaker.speak,
      createQueue: () => queue,
    });
    speech.begin();
    speech.push("第一句。第二句。");
    speech.end();
    expect(markLastCalls()).toBe(0);

    speaker.streams.get("第一句。")!.onChunk(chunk(2));
    speaker.streams.get("第一句。")!.onDone();
    expect(markLastCalls()).toBe(0); // 第二句还在飞

    speaker.streams.get("第二句。")!.onChunk(chunk(2));
    speaker.streams.get("第二句。")!.onDone();
    expect(markLastCalls()).toBe(1);
  });

  it("首块前失败也要放行发布指针（否则后面几句永远不入队）", () => {
    const { queue, enqueued, markLastCalls } = fakeQueue();
    const speaker = fakeSpeak();
    const speech = createStreamingSpeech({
      speak: speaker.speak,
      createQueue: () => queue,
    });
    speech.begin();
    speech.push("第一句。第二句。");
    speech.end();

    speaker.streams.get("第一句。")!.onError("model not installed");
    speaker.streams.get("第二句。")!.onChunk(chunk(2));
    speaker.streams.get("第二句。")!.onDone();

    expect(speech.failedCount()).toBe(1);
    expect(enqueued.map((e) => e.sentenceIndex)).toEqual([1]);
    expect(markLastCalls()).toBe(1);
  });

  it("出过声之后失败：已入队的块留着，指针继续往前", () => {
    const { queue, enqueued } = fakeQueue();
    const speaker = fakeSpeak();
    const speech = createStreamingSpeech({
      speak: speaker.speak,
      createQueue: () => queue,
    });
    speech.begin();
    speech.push("第一句。第二句。");
    speech.end();

    speaker.streams.get("第一句。")!.onChunk(chunk(2));
    speaker.streams.get("第一句。")!.onError("boom");
    speaker.streams.get("第二句。")!.onChunk(chunk(5));
    speaker.streams.get("第二句。")!.onDone();

    expect(enqueued.map((e) => e.samples.length)).toEqual([2, 5]);
    expect(speech.failedCount()).toBe(1);
  });

  it("stop 取消在飞的流，之后 push 不再入队", () => {
    const { queue, enqueued } = fakeQueue();
    const speaker = fakeSpeak();
    const speech = createStreamingSpeech({
      speak: speaker.speak,
      createQueue: () => queue,
    });
    speech.begin();
    speech.push("第一句。");
    expect(speaker.cancelled).toEqual([]);

    speech.stop();
    expect(speaker.cancelled).toEqual(["第一句。"]);

    speech.push("第二句。");
    expect(enqueued).toHaveLength(0);
  });

  it("only fires drained after end()", () => {
    const { queue, fireDrained } = fakeQueue();
    const speaker = fakeSpeak();
    const speech = createStreamingSpeech({
      speak: speaker.speak,
      createQueue: () => queue,
    });
    const onDrained = vi.fn();
    speech.onDrained(onDrained);
    speech.begin();
    speech.push("一句。");
    fireDrained();
    expect(onDrained).not.toHaveBeenCalled();
    speech.end();
    fireDrained();
    expect(onDrained).toHaveBeenCalledTimes(1);
  });

  // 打断后恢复朗读：已经念过的部分不能重念。"第一句。" 占 4 个字符，
  // 所以从偏移 4 恢复应当只念第二句。
  it("begin 带偏移时只念偏移之后的部分", () => {
    const { queue } = fakeQueue();
    const speaker = fakeSpeak();
    const speech = createStreamingSpeech({
      speak: speaker.speak,
      createQueue: () => queue,
    });

    speech.begin(4);
    speech.push("第一句。第二句。");
    speech.end();

    expect([...speaker.streams.keys()]).toEqual(["第二句。"]);
  });

  it("不带偏移时从头念（默认行为不变）", () => {
    const { queue } = fakeQueue();
    const speaker = fakeSpeak();
    const speech = createStreamingSpeech({
      speak: speaker.speak,
      createQueue: () => queue,
    });

    speech.begin();
    speech.push("第一句。第二句。");
    speech.end();

    expect([...speaker.streams.keys()]).toEqual(["第一句。", "第二句。"]);
  });
});
