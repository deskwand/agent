// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { speakStream } from "../../renderer/utils/tts/speak-stream";
import type { TtsStreamEvent } from "../../shared/ipc-types";

function fakeBridge() {
  let listener: ((event: TtsStreamEvent) => void) | null = null;
  const bridge = {
    speakStream: vi.fn(async () => ({ streamId: 7 })),
    cancelStream: vi.fn(async () => {}),
    onStream: vi.fn((callback: (event: TtsStreamEvent) => void) => {
      listener = callback;
      return () => {
        if (listener === callback) listener = null;
      };
    }),
  };
  return { bridge, emit: (event: TtsStreamEvent) => listener?.(event) };
}

let original: typeof window.electronAPI;

beforeEach(() => {
  original = window.electronAPI;
});

afterEach(() => {
  window.electronAPI = original;
});

function install(bridge: unknown) {
  window.electronAPI = { tts: bridge } as unknown as typeof window.electronAPI;
}

const chunk = (
  streamId: number,
  seq: number,
  length: number,
): TtsStreamEvent => ({
  streamId,
  type: "chunk",
  seq,
  samples: new Float32Array(length),
  sampleRate: 24000,
});

describe("speakStream", () => {
  it("只把属于自己 streamId 的块交给调用方", async () => {
    const { bridge, emit } = fakeBridge();
    install(bridge);
    const chunks: number[] = [];
    const onDone = vi.fn();
    speakStream("文本", undefined, {
      onChunk: (c) => chunks.push(c.samples.length),
      onDone,
      onError: () => {},
    });
    await vi.waitFor(() => expect(bridge.speakStream).toHaveBeenCalled());

    emit(chunk(999, 0, 9)); // 别的流
    emit(chunk(7, 0, 3));
    emit({ streamId: 7, type: "done" });

    expect(chunks).toEqual([3]);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("把 error 事件交给 onError", async () => {
    const { bridge, emit } = fakeBridge();
    install(bridge);
    const onError = vi.fn();
    speakStream("文本", undefined, {
      onChunk: () => {},
      onDone: () => {},
      onError,
    });
    await vi.waitFor(() => expect(bridge.speakStream).toHaveBeenCalled());

    emit({ streamId: 7, type: "error", error: "read aloud disabled" });
    expect(onError).toHaveBeenCalledWith("read aloud disabled");
  });

  it("done 之后再来的块不再打扰调用方", async () => {
    const { bridge, emit } = fakeBridge();
    install(bridge);
    const onChunk = vi.fn();
    speakStream("文本", undefined, {
      onChunk,
      onDone: () => {},
      onError: () => {},
    });
    await vi.waitFor(() => expect(bridge.speakStream).toHaveBeenCalled());

    emit({ streamId: 7, type: "done" });
    emit(chunk(7, 1, 3));
    expect(onChunk).not.toHaveBeenCalled();
  });

  it("取消后不再触发任何 handler，并通知主进程", async () => {
    const { bridge, emit } = fakeBridge();
    install(bridge);
    const onChunk = vi.fn();
    const cancel = speakStream("文本", undefined, {
      onChunk,
      onDone: () => {},
      onError: () => {},
    });
    await vi.waitFor(() => expect(bridge.speakStream).toHaveBeenCalled());

    cancel();
    emit(chunk(7, 0, 3));
    expect(onChunk).not.toHaveBeenCalled();
    expect(bridge.cancelStream).toHaveBeenCalledWith(7);
  });

  it("invoke 还没回来就取消：拿到 id 后补一次取消", async () => {
    let resolveSpeak!: (value: { streamId: number }) => void;
    const { bridge } = fakeBridge();
    bridge.speakStream.mockImplementation(
      () => new Promise((resolve) => (resolveSpeak = resolve)),
    );
    install(bridge);

    const cancel = speakStream("文本", undefined, {
      onChunk: () => {},
      onDone: () => {},
      onError: () => {},
    });
    cancel(); // 此刻还不知道 streamId
    resolveSpeak({ streamId: 42 });
    await vi.waitFor(() =>
      expect(bridge.cancelStream).toHaveBeenCalledWith(42),
    );
  });

  it("终态之后再调取消：不再通知主进程（否则那边会留下一项永不清理的 id）", async () => {
    const { bridge, emit } = fakeBridge();
    install(bridge);
    const cancel = speakStream("文本", undefined, {
      onChunk: () => {},
      onDone: () => {},
      onError: () => {},
    });
    await vi.waitFor(() => expect(bridge.speakStream).toHaveBeenCalled());

    emit({ streamId: 7, type: "done" });
    cancel();
    expect(bridge.cancelStream).not.toHaveBeenCalled();
  });

  it("桥不可用时直接报错，不抛异常", () => {
    window.electronAPI = {} as unknown as typeof window.electronAPI;
    const onError = vi.fn();
    const cancel = speakStream("文本", undefined, {
      onChunk: () => {},
      onDone: () => {},
      onError,
    });
    expect(onError).toHaveBeenCalledWith("tts streaming unavailable");
    expect(() => cancel()).not.toThrow();
  });
});
