// @vitest-environment jsdom
/**
 * 跨模块集成：真 `speakStream` 原语 + 真 `createStreamingSpeech` + 真 `audio-queue`
 * （只替身 AudioContext 与 IPC 桥）。
 *
 * 各层的单测把相邻层都替身掉了：这里验的正是**替身之间**那段 —— 乱序到达、属于不同
 * 流的块，经过发布指针之后，是否按句序、无缝播放，高亮是否在播放时刻推进。
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createStreamingSpeech } from "../../renderer/hooks/useStreamingSpeech";
import { createAudioQueue } from "../../renderer/utils/tts/audio-queue";
import { speakStream } from "../../renderer/utils/tts/speak-stream";
import type { TtsStreamEvent } from "../../shared/ipc-types";

/** 极简 AudioContext：记下每次 start 的时刻，并允许测试推进时钟。 */
function fakeContext() {
  const started: Array<{ at: number; duration: number }> = [];
  const sources: Array<{ onended: (() => void) | null }> = [];
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
        buffer: null as unknown as { duration: number },
        connect: vi.fn(),
        onended: null as (() => void) | null,
        stop: vi.fn(),
        start: vi.fn((at: number) => {
          started.push({ at, duration: source.buffer.duration });
        }),
      };
      sources.push(source);
      return source;
    },
    suspend: vi.fn(async () => {}),
    resume: vi.fn(async () => {}),
  };
  return { context, started, sources };
}

/** 主进程那侧的替身：一个频道广播所有事件，每个 speakStream 自己按 id 过滤。 */
function fakeBridge() {
  const listeners = new Set<(event: TtsStreamEvent) => void>();
  let nextId = 1;
  return {
    bridge: {
      speakStream: vi.fn(async () => ({ streamId: nextId++ })),
      cancelStream: vi.fn(async () => {}),
      onStream: (callback: (event: TtsStreamEvent) => void) => {
        listeners.add(callback);
        return () => {
          listeners.delete(callback);
        };
      },
    },
    emit: (event: TtsStreamEvent) => {
      for (const listener of [...listeners]) listener(event);
    },
  };
}

let original: typeof window.electronAPI;

beforeEach(() => {
  original = window.electronAPI;
});

afterEach(() => {
  window.electronAPI = original;
});

const chunk = (
  streamId: number,
  seq: number,
  length: number,
): TtsStreamEvent => ({
  streamId,
  type: "chunk",
  seq,
  // 44.1kHz 下 44100 采样 = 1s
  samples: new Float32Array(length),
  sampleRate: 44100,
});

it("乱序到达的块最终按句序、无缝播放，高亮在播放时刻推进", async () => {
  vi.useFakeTimers();
  try {
    const { bridge, emit } = fakeBridge();
    window.electronAPI = {
      tts: bridge,
    } as unknown as typeof window.electronAPI;

    const { context, started, sources } = fakeContext();
    const speech = createStreamingSpeech({
      speak: (text, handlers) => speakStream(text, undefined, handlers),
      createQueue: () =>
        createAudioQueue({ createContext: () => context as never }),
    });
    const highlighted: number[] = [];
    speech.onSentence((index) => highlighted.push(index));

    speech.begin();
    speech.push("第一句。第二句。");
    speech.end();
    await vi.waitFor(() => expect(bridge.speakStream).toHaveBeenCalledTimes(2));
    // 先发出去的句子拿到的 id 更小
    const firstId = (await bridge.speakStream.mock.results[0].value).streamId;
    const secondId = (await bridge.speakStream.mock.results[1].value).streamId;

    // 第二句的流先回来：它的块不能越过第一句
    emit(chunk(secondId, 0, 8820)); // 0.2s
    emit({ streamId: secondId, type: "done" });
    expect(started).toHaveLength(0);

    // 第一句：两块 1s，然后才轮到第二句那一块
    emit(chunk(firstId, 0, 44100));
    emit(chunk(firstId, 1, 44100));
    emit({ streamId: firstId, type: "done" });

    // 排期顺序 = 句序；且每块紧接上一块（无缝）
    expect(started.map((s) => s.duration)).toEqual([1, 1, 0.2]);
    expect(started[1].at).toBeCloseTo(started[0].at + 1, 5);
    expect(started[2].at).toBeCloseTo(started[1].at + 1, 5);

    // 高亮按播放时刻推进，同句的多块不重复点亮
    context.currentTime = 0.03;
    vi.advanceTimersByTime(25);
    context.currentTime = 2.03;
    vi.advanceTimersByTime(25);
    expect(highlighted).toEqual([0, 1]);

    // 只有最后一块播完才算「读完」
    const drained = vi.fn();
    speech.onDrained(drained);
    sources[0].onended?.();
    sources[1].onended?.();
    expect(drained).not.toHaveBeenCalled();
    sources[2].onended?.();
    expect(drained).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});
