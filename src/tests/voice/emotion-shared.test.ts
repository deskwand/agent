import { describe, expect, it } from "vitest";
import { EMOTION_LABELS, isEmotionSignal } from "../../shared/voice-emotion";

describe("voice-emotion 共享面", () => {
  it("标签顺序与模型 tokens.txt 一致", () => {
    expect([...EMOTION_LABELS]).toEqual([
      "angry",
      "disgusted",
      "fearful",
      "happy",
      "neutral",
      "other",
      "sad",
      "surprised",
      "unknown",
    ]);
  });

  it("校验情感信号", () => {
    expect(isEmotionSignal({ label: "sad", confidence: 0.9 })).toBe(true);
    expect(isEmotionSignal({ label: "sad" })).toBe(false);
    expect(isEmotionSignal({ label: "grumpy", confidence: 0.9 })).toBe(false);
    expect(isEmotionSignal(null)).toBe(false);
  });
});
