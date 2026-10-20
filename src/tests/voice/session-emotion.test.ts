import { describe, expect, it, vi } from "vitest";
import { VoiceSession } from "../../main/voice/session";
import {
  EMOTION_MIN_SAMPLES,
  EMOTION_TIMEOUT_MS,
} from "../../shared/voice-emotion";

function fakeEngine() {
  return {
    createStream: () => ({
      push: () => ({ partial: "" }),
      finish: async () => ({ text: "你好" }),
      abort: () => {},
    }),
  };
}

const samples = (count: number) => new Int16Array(count).fill(1000);

describe("VoiceSession 与情感", () => {
  it("够长时把情感挂到 done 上", async () => {
    const recognize = vi.fn(async () => ({
      label: "sad" as const,
      confidence: 0.9,
    }));
    const onDone = vi.fn();
    const session = new VoiceSession({
      engine: fakeEngine(),
      emotion: { recognize },
      events: { onPartial: () => {}, onDone, onError: () => {} },
    });
    session.push(samples(16000));
    await session.stop();
    expect(recognize).toHaveBeenCalledWith(
      expect.any(Int16Array),
      EMOTION_TIMEOUT_MS,
    );
    expect(onDone).toHaveBeenCalledWith({
      text: "你好",
      discarded: false,
      emotion: { label: "sad", confidence: 0.9 },
    });
  });

  it("太短就不跑情感，done 不带字段", async () => {
    const recognize = vi.fn();
    const onDone = vi.fn();
    const session = new VoiceSession({
      engine: fakeEngine(),
      emotion: { recognize },
      events: { onPartial: () => {}, onDone, onError: () => {} },
    });
    session.push(samples(EMOTION_MIN_SAMPLES - 1));
    await session.stop();
    expect(recognize).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledWith({ text: "你好", discarded: false });
  });

  it("引擎返回 null 时 done 不带情感", async () => {
    const onDone = vi.fn();
    const session = new VoiceSession({
      engine: fakeEngine(),
      emotion: { recognize: async () => null },
      events: { onPartial: () => {}, onDone, onError: () => {} },
    });
    session.push(samples(16000));
    await session.stop();
    expect(onDone).toHaveBeenCalledWith({ text: "你好", discarded: false });
  });

  it("缓冲只留最后一截（超过上限丢头部）", async () => {
    const recognize = vi.fn(async (_samples: Int16Array) => null);
    const session = new VoiceSession({
      engine: fakeEngine(),
      emotion: { recognize },
      events: { onPartial: () => {}, onDone: () => {}, onError: () => {} },
    });
    session.push(samples(16000 * 10));
    session.push(samples(16000 * 10));
    await session.stop();
    const passed = recognize.mock.calls[0][0] as Int16Array;
    expect(passed.length).toBeLessThanOrEqual(16000 * 15);
    expect(passed.length).toBeGreaterThanOrEqual(16000 * 5);
  });
});
