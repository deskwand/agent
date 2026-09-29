import { describe, expect, it } from "vitest";
import {
  TURN_CLOCK_LINGER_MS,
  formatDurationShort,
  isLingering,
} from "../../renderer/utils/execution-clock";

describe("isLingering", () => {
  it("is false until a run has ended", () => {
    expect(isLingering({ startAt: 1000, endAt: null }, 1000)).toBe(false);
    expect(isLingering({ startAt: null, endAt: null }, 1000)).toBe(false);
  });

  it("is true inside the window and false at the boundary", () => {
    const clock = { startAt: 0, endAt: 10_000 };
    expect(isLingering(clock, 10_000)).toBe(true);
    expect(isLingering(clock, 10_000 + TURN_CLOCK_LINGER_MS - 1)).toBe(true);
    expect(isLingering(clock, 10_000 + TURN_CLOCK_LINGER_MS)).toBe(false);
    expect(isLingering(clock, 10_000 + TURN_CLOCK_LINGER_MS + 1)).toBe(false);
  });

  it("treats a backwards clock as still lingering", () => {
    // now 比 endAt 早（时钟回拨 / 时区偏移）：宁可当成同一任务，也不要凭空开新的一轮
    expect(isLingering({ startAt: 0, endAt: 10_000 }, 0)).toBe(true);
  });
});

describe("formatDurationShort", () => {
  it("prints whole seconds below a minute", () => {
    expect(formatDurationShort(0)).toBe("0s");
    expect(formatDurationShort(12)).toBe("12s");
    expect(formatDurationShort(59)).toBe("59s");
  });

  it("prints minutes and zero-padded seconds below an hour", () => {
    expect(formatDurationShort(60)).toBe("1m00s");
    expect(formatDurationShort(83)).toBe("1m23s");
    expect(formatDurationShort(3599)).toBe("59m59s");
  });

  it("prints hours and zero-padded minutes at an hour and above", () => {
    expect(formatDurationShort(3600)).toBe("1h00m");
    expect(formatDurationShort(3900)).toBe("1h05m");
    expect(formatDurationShort(86_399)).toBe("23h59m");
  });

  it("rounds to the nearest second and never goes negative", () => {
    expect(formatDurationShort(12.4)).toBe("12s");
    expect(formatDurationShort(12.6)).toBe("13s");
    expect(formatDurationShort(-5)).toBe("0s");
  });
});
