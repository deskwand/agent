import { describe, expect, it } from "vitest";
import {
  TURN_CLOCK_LINGER_MS,
  TURN_CLOCK_SLOT_SENTINEL_SECONDS,
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

describe("TURN_CLOCK_SLOT_SENTINEL_SECONDS", () => {
  it("is the widest 6-character token, i.e. 10h00m", () => {
    expect(formatDurationShort(TURN_CLOCK_SLOT_SENTINEL_SECONDS)).toBe(
      "10h00m",
    );
  });

  it("is a width upper bound for everything below 100 hours", () => {
    // 宽度上界的证明只能停在「结构」这一层：jsdom 没有布局引擎，
    // getBoundingClientRect 恒为 0，像素差无法断言。三条合起来才是证明——
    //   ① 输出只有三种形态 ⇒ ② 6 字符只有 NNmNNs 与 NNhNNm 两种
    //   ⇒ ③ NNhNNm 更宽（实测 85.297px vs 84.57px，见设计文档附录）
    // 于是「最长且最宽的形态」= 哨兵。下面是 ① 与长度上界的采样断言。
    const SHAPE = /^(\d+s|\d+m\d{2}s|\d+h\d{2}m)$/;
    const sentinelLength = formatDurationShort(
      TURN_CLOCK_SLOT_SENTINEL_SECONDS,
    ).length;
    // 先钉住哨兵自身的长度。少了这一条，常量缺失时上面会得到 "NaNhNaNm"
    // （长度 8），下面的长度上界断言就变成空过 —— 测试会绿着放过一个 bug。
    expect(sentinelLength).toBe(6);

    // 边界两侧必须先显式钉住：采样范围必须止于 359_999。
    // 把 360_000 纳入采样会让下面的 toBeLessThanOrEqual 必挂——
    // 那时输出是 100h00m（7 字符），已经溢出哨兵，属设计上接受的退化。
    expect(formatDurationShort(359_999)).toBe("99h59m");
    expect(formatDurationShort(360_000)).toBe("100h00m");

    const probes = new Set<number>();
    for (let s = 0; s <= 400; s++) probes.add(s);
    for (const boundary of [60, 600, 3600, 36000]) {
      for (let delta = -3; delta <= 3; delta++) probes.add(boundary + delta);
    }
    for (let s = 0; s <= 359_999; s += 997) probes.add(s);
    for (let s = 359_990; s <= 359_999; s++) probes.add(s);

    for (const seconds of probes) {
      const token = formatDurationShort(seconds);
      expect(token, `token for ${seconds}s`).toMatch(SHAPE);
      expect(token.length, `length for ${seconds}s`).toBeLessThanOrEqual(
        sentinelLength,
      );
    }
  });
});
