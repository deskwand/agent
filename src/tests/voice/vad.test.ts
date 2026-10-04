import { describe, it, expect } from "vitest";
import {
  createVad,
  estimateNoiseFloor,
  thresholdFromNoiseFloor,
  NOISE_MARGIN,
  MIN_THRESHOLD,
} from "../../renderer/utils/voice/vad";

describe("estimateNoiseFloor", () => {
  it("returns 0 for an empty sample", () => {
    expect(estimateNoiseFloor([])).toBe(0);
  });

  it("returns the median of a quiet room", () => {
    const levels = [0.01, 0.02, 0.02, 0.03, 0.03, 0.04, 0.05, 0.06, 0.08, 0.1];
    expect(estimateNoiseFloor(levels)).toBe(0.04);
  });

  it("ignores a single loud spike", () => {
    const levels = new Array(20).fill(0.03);
    levels.push(0.9);
    expect(estimateNoiseFloor(levels)).toBeLessThan(0.1);
  });

  // 真实的标定窗只有 8 帧。P90 在这个长度上等于最大值，一声咳嗽就能把阈值
  // 顶到嗓子以上、封死整次会话 —— 这条用例把窗口长度钉死。
  it("survives a spike inside the real 8-frame calibration window", () => {
    const window = [0.02, 0.02, 0.03, 0.02, 0.9, 0.02, 0.03, 0.02];
    expect(estimateNoiseFloor(window)).toBeLessThanOrEqual(0.03);
  });
});

describe("thresholdFromNoiseFloor", () => {
  it("never goes below the floor", () => {
    expect(thresholdFromNoiseFloor(0)).toBe(MIN_THRESHOLD);
    // 阈值下限与余量都是 0.12，所以本底 ≥0 时阈值就是本底加余量，
    // 下限只对负本底生效（浮点比较用 toBeCloseTo）。
    expect(thresholdFromNoiseFloor(0.05)).toBeCloseTo(0.05 + NOISE_MARGIN, 5);
  });

  it("adds the margin above a loud baseline", () => {
    expect(thresholdFromNoiseFloor(0.3)).toBeCloseTo(0.3 + NOISE_MARGIN, 5);
  });
});

describe("createVad", () => {
  const make = () =>
    createVad({ threshold: 0.3, speechMs: 150, silenceMs: 800 });

  it("does not fire on a short blip", () => {
    const vad = make();
    expect(vad.push(0.9, 100)).toBeNull();
    expect(vad.push(0.1, 100)).toBeNull();
    expect(vad.isSpeaking()).toBe(false);
  });

  it("fires speech-start once and only once", () => {
    const vad = make();
    expect(vad.push(0.9, 150)).toBe("speech-start");
    expect(vad.push(0.9, 100)).toBeNull();
    expect(vad.push(0.9, 100)).toBeNull();
    expect(vad.isSpeaking()).toBe(true);
  });

  it("needs the full silence window to end", () => {
    const vad = make();
    vad.push(0.9, 200);
    expect(vad.push(0.1, 400)).toBeNull();
    expect(vad.push(0.1, 400)).toBe("silence");
    expect(vad.isSpeaking()).toBe(false);
  });

  it("a brief pause does not end speech", () => {
    const vad = make();
    vad.push(0.9, 200);
    expect(vad.push(0.1, 300)).toBeNull();
    expect(vad.push(0.9, 100)).toBeNull();
    expect(vad.push(0.1, 300)).toBeNull();
    expect(vad.isSpeaking()).toBe(true);
  });

  it("reset clears both counters", () => {
    const vad = make();
    vad.push(0.9, 200);
    vad.reset();
    expect(vad.isSpeaking()).toBe(false);
    expect(vad.push(0.9, 100)).toBeNull();
  });
});
