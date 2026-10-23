import { describe, expect, it } from "vitest";
import {
  TokenSpeedReporter,
  countStreamChars,
  nextCalibration,
  rawTokenEstimate,
  type TokenSpeedSample,
} from "../../main/agent/token-speed";

function makeClock(start = 0) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

function makeReporter(clock: ReturnType<typeof makeClock>) {
  const samples: TokenSpeedSample[] = [];
  const reporter = new TokenSpeedReporter({
    emit: (sample) => samples.push(sample),
    now: clock.now,
  });
  return { samples, reporter };
}

describe("countStreamChars", () => {
  it("splits ASCII from CJK because they cost different tokens", () => {
    expect(countStreamChars("hello")).toEqual({ ascii: 5, nonAscii: 0 });
    expect(countStreamChars("你好")).toEqual({ ascii: 0, nonAscii: 2 });
    expect(countStreamChars("OK 可以")).toEqual({ ascii: 3, nonAscii: 2 });
  });

  it("counts an emoji as one non-ASCII character", () => {
    expect(countStreamChars("🙂")).toEqual({ ascii: 0, nonAscii: 1 });
  });
});

describe("rawTokenEstimate", () => {
  it("uses 4 chars/token for ASCII and 1.2 chars/token for CJK", () => {
    expect(rawTokenEstimate({ ascii: 400, nonAscii: 0 })).toBeCloseTo(100);
    expect(rawTokenEstimate({ ascii: 0, nonAscii: 120 })).toBeCloseTo(100);
  });
});

describe("nextCalibration", () => {
  it("learns the ratio from real usage", () => {
    expect(nextCalibration(1, 100, 120)).toBeCloseTo(1.2);
  });

  it("clamps outliers and keeps the current value on bad input", () => {
    expect(nextCalibration(1, 10, 1000)).toBe(2);
    expect(nextCalibration(1, 1000, 10)).toBe(0.5);
    expect(nextCalibration(1.3, 0, 100)).toBe(1.3);
    expect(nextCalibration(1.3, 100, Number.NaN)).toBe(1.3);
  });
});

describe("TokenSpeedReporter", () => {
  it("times from the first delta, so first-token latency is excluded", () => {
    const clock = makeClock();
    const { samples, reporter } = makeReporter(clock);

    reporter.startMessage();
    clock.advance(30_000); // 首 token 等了 30s，绝不能进分母
    reporter.observeDelta("a".repeat(4000)); // 1000 tokens，起点 t=30000
    clock.advance(1000);
    reporter.observeDelta("b"); // t=31000 触发发射

    expect(samples).toHaveLength(1);
    expect(samples[0].estimated).toBe(true);
    expect(samples[0].tokensPerSecond).toBeCloseTo(1000, 0);
  });

  it("throttles estimates to one per 500ms", () => {
    const clock = makeClock();
    const { samples, reporter } = makeReporter(clock);

    reporter.startMessage();
    reporter.observeDelta("aaaa"); // 起点 t=0
    clock.advance(499);
    reporter.observeDelta("a"); // 499ms：不发射
    expect(samples).toHaveLength(0);

    clock.advance(1);
    reporter.observeDelta("a"); // 500ms：发射
    expect(samples).toHaveLength(1);
  });

  it("emits the exact value at message end and reuses the calibration next message", () => {
    const clock = makeClock();
    const { samples, reporter } = makeReporter(clock);

    reporter.startMessage();
    reporter.observeDelta("x".repeat(1400)); // raw ≈ 350 tokens
    clock.advance(10_000);
    reporter.finish(380);

    expect(samples[samples.length - 1]).toEqual({
      tokensPerSecond: 38,
      estimated: false,
    });

    // 校准比 = 380 / 350；下一条 700 ASCII 字符 + 1 字符，1s 窗口
    reporter.startMessage();
    reporter.observeDelta("y".repeat(700));
    clock.advance(1000);
    reporter.observeDelta("y");

    const live = samples[samples.length - 1];
    expect(live.estimated).toBe(true);
    expect(live.tokensPerSecond).toBeCloseTo(175.25 * (380 / 350), 0);
  });

  it("skips the exact value when no delta was streamed", () => {
    const clock = makeClock();
    const { samples, reporter } = makeReporter(clock);

    reporter.startMessage();
    clock.advance(5000);
    reporter.finish(120);

    expect(samples).toEqual([]);
  });

  it("skips an exact value when the generation window is implausibly short", () => {
    const clock = makeClock();
    const { samples, reporter } = makeReporter(clock);

    reporter.startMessage();
    reporter.observeDelta("abc"); // 起点 t=0
    clock.advance(5);
    reporter.finish(3); // 3 tokens / 5ms 会是 600 tok/s，不能当精确值

    expect(samples).toEqual([]);
  });

  it("skips a zero-length window instead of dividing by zero", () => {
    const clock = makeClock();
    const { samples, reporter } = makeReporter(clock);

    reporter.startMessage();
    reporter.observeDelta("abc");
    reporter.finish(10); // elapsed 0

    expect(samples).toEqual([]);
  });

  it("restarts the clock when a new message begins", () => {
    const clock = makeClock();
    const { samples, reporter } = makeReporter(clock);

    reporter.startMessage();
    reporter.observeDelta("a".repeat(400)); // 起点 t=0
    clock.advance(60_000); // 上一轮被中止：没有 finish
    reporter.startMessage();
    reporter.observeDelta("a".repeat(400)); // 新起点 t=60000
    clock.advance(1000);
    reporter.observeDelta("a");

    expect(samples).toHaveLength(1);
    expect(samples[0].tokensPerSecond).toBeCloseTo(100, 0);
  });
});
