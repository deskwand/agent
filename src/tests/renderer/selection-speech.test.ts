// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  createSelectionSpeechController,
  type SelectionSpeechState,
} from "../../renderer/utils/tts/selection-speech";
import type {
  AudioQueue,
  QueuedAudio,
} from "../../renderer/utils/tts/audio-queue";
import type { SpeakStreamHandlers } from "../../renderer/utils/tts/speak-stream";

/** 手写的假队列：只记调用，不碰 AudioContext（jsdom 里没有）。 */
function fakeQueue() {
  const enqueued: QueuedAudio[] = [];
  let sentenceStart: ((sentenceIndex: number) => void) | null = null;
  let drained: (() => void) | null = null;
  let last = false;
  let stopped = 0;
  const queue: AudioQueue = {
    enqueue: (item) => void enqueued.push(item),
    markLast: () => void (last = true),
    onSentenceStart: (cb: (sentenceIndex: number) => void) => {
      sentenceStart = cb;
    },
    onDrained: (cb: () => void) => {
      drained = cb;
    },
    pause: () => {},
    resume: () => {},
    stop: () => void (stopped += 1),
    playing: () => false,
  };
  return {
    queue,
    enqueued,
    sawLast: () => last,
    stopped: () => stopped,
    announce: () => sentenceStart?.(0),
    drain: () => drained?.(),
  };
}

function setup() {
  const states: Partial<SelectionSpeechState>[] = [];
  const q = fakeQueue();
  let handlers: SpeakStreamHandlers | null = null;
  const cancel = vi.fn();
  const speak = vi.fn((_text: string, h: SpeakStreamHandlers) => {
    handlers = h;
    return cancel;
  });
  const closed = vi.fn();
  const createContext = vi.fn(
    () => ({ close: closed }) as unknown as AudioContext,
  );
  const controller = createSelectionSpeechController({
    speak,
    createContext,
    createQueue: () => q.queue,
    setState: (patch) => void states.push(patch),
  });
  return {
    controller,
    states,
    speak,
    cancel,
    q,
    closed,
    createContext,
    handler: () => handlers!,
  };
}

describe("划词朗读会话", () => {
  it("空文本不起播", () => {
    const { controller, speak, states } = setup();
    controller.start("   ");
    expect(speak).not.toHaveBeenCalled();
    expect(states).toEqual([]);
  });

  it("起播：先收上一场（发一次 idle），再 preparing → playing", () => {
    const { controller, speak, states, q } = setup();
    controller.start("  第一句 第二句  ");
    expect(speak.mock.calls[0]![0]).toBe("第一句 第二句"); // 只 trim
    expect(states[0]).toEqual({ status: "idle", error: undefined });
    expect(states[1]).toEqual({ status: "preparing", error: undefined });
    q.announce();
    expect(states[2]).toEqual({ status: "playing" });
  });

  it("音频块进队列，onDone 才 markLast，排空回 idle", () => {
    const { controller, handler, q } = setup();
    controller.start("一句话");
    handler().onChunk({ samples: new Float32Array(2), sampleRate: 24000 });
    expect(q.enqueued).toHaveLength(1);
    handler().onDone();
    expect(q.sawLast()).toBe(true);
    q.drain();
    expect(controller.getState().status).toBe("idle");
  });

  it("stop 会取消合成、停队列，并把状态收回 idle", () => {
    const { controller, cancel, q } = setup();
    controller.start("一句话");
    controller.stop();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(q.stopped()).toBe(1);
    expect(controller.getState().status).toBe("idle");
  });

  it("停止之后迟到的块不再进队列（不是第二次朗读）", () => {
    const { controller, handler, q } = setup();
    controller.start("一句话");
    const stale = handler();
    controller.stop();
    stale.onChunk({ samples: new Float32Array(2), sampleRate: 24000 });
    expect(q.enqueued).toHaveLength(0);
  });

  it("合成失败落到 error 并带上原因", () => {
    const { controller, handler } = setup();
    controller.start("一句话");
    handler().onError("tts streaming unavailable");
    expect(controller.getState()).toEqual({
      status: "error",
      error: "tts streaming unavailable",
    });
  });

  it("一场一个 AudioContext，收尾时关掉它（Chromium 有并发上限）", () => {
    const { controller, q, closed, createContext } = setup();
    controller.start("第一段");
    expect(createContext).toHaveBeenCalledTimes(1);
    controller.stop();
    expect(closed).toHaveBeenCalledTimes(1);

    // 排空（自然读完）也要关，而且第二场要拿一个新的
    controller.start("第二段");
    q.drain();
    expect(createContext).toHaveBeenCalledTimes(2);
    expect(closed).toHaveBeenCalledTimes(2);
  });

  it("new AudioContext() 抛错（到达上限）时落到 error，而不是卡在 preparing", () => {
    const q = fakeQueue();
    const states: Partial<SelectionSpeechState>[] = [];
    const controller = createSelectionSpeechController({
      speak: vi.fn(() => vi.fn()),
      createContext: () => {
        throw new Error("too many AudioContexts");
      },
      createQueue: () => q.queue,
      setState: (patch) => void states.push(patch),
    });
    controller.start("一句话");
    expect(controller.getState()).toEqual({
      status: "error",
      error: "too many AudioContexts",
    });
  });
});
