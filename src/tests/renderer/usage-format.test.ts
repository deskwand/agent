import { describe, expect, it } from "vitest";
import {
  bucketHitRate,
  bucketVolume,
  compactNumber,
  formatCost,
  formatHitRate,
  resolveCellLevel,
  sumUnpricedCalls,
} from "../../renderer/utils/usage-format";
import type { UsageDayRow, UsageModelRow } from "../../shared/usage";

describe("compactNumber", () => {
  it("scales to K/M/B with one decimal", () => {
    expect(compactNumber(999)).toBe("999");
    expect(compactNumber(1_500)).toBe("1.5K");
    expect(compactNumber(2_400_000)).toBe("2.4M");
    expect(compactNumber(13_990_180_224)).toBe("13.99B");
  });
});

describe("formatHitRate", () => {
  it("renders an em dash when the provider reports no cache", () => {
    expect(formatHitRate(null)).toBe("—");
  });

  it("renders one decimal otherwise", () => {
    expect(formatHitRate(98.19)).toBe("98.2%");
  });
});

describe("bucketVolume", () => {
  const all = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

  it("returns 0 for missing data", () => {
    expect(bucketVolume(undefined as unknown as number, all)).toBe(0);
  });

  it("buckets into four levels by quantile", () => {
    expect(bucketVolume(1, all)).toBe(1);
    expect(bucketVolume(4, all)).toBe(2);
    expect(bucketVolume(7, all)).toBe(3);
    expect(bucketVolume(12, all)).toBe(4);
  });

  it("keeps any non-zero value visible even when tiny", () => {
    expect(bucketVolume(1, all)).toBeGreaterThan(0);
  });
});

describe("bucketHitRate", () => {
  it("uses semantic bands, 1-based so level 0 stays reserved for 'no record'", () => {
    expect(bucketHitRate(85)).toBe(1);
    expect(bucketHitRate(92)).toBe(2);
    expect(bucketHitRate(96)).toBe(3);
    expect(bucketHitRate(98)).toBe(4);
    expect(bucketHitRate(99.5)).toBe(5);
  });

  it("never returns 0, which would render a bad day as an empty cell", () => {
    for (const rate of [0, 10, 50, 89.9, 100]) {
      expect(bucketHitRate(rate)).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("resolveCellLevel", () => {
  const row = (
    input: number,
    output: number,
    cacheRead: number,
    hitRate: number | null,
  ): UsageDayRow => ({
    date: "2026-09-12",
    input,
    output,
    cacheRead,
    calls: 1,
    hitRate,
    cost: 0,
  });

  it("treats a missing day as empty", () => {
    expect(resolveCellLevel(undefined, "hit", [])).toBe(0);
  });

  it("gives a low but recorded hit rate a visible level (regression)", () => {
    const level = resolveCellLevel(row(100, 10, 20, 16.7), "hit", [30]);
    expect(level).toBe(1);
  });

  it("maps a day with no reported cache to empty rather than 0%", () => {
    expect(resolveCellLevel(row(100, 10, 0, null), "hit", [110])).toBe(0);
  });

  it("scales usage days by volume", () => {
    const level = resolveCellLevel(row(0, 0, 500, 99), "usage", [10, 100, 500]);
    expect(level).toBeGreaterThanOrEqual(1);
  });
});

describe("formatCost", () => {
  it("renders an em dash when there is no price for the model", () => {
    expect(formatCost(null)).toBe("—");
  });

  it("renders a plain zero for a free model", () => {
    expect(formatCost(0)).toBe("$0");
  });

  it("never rounds a real cost down to $0.00", () => {
    expect(formatCost(0.0004)).toBe("<$0.001");
    expect(formatCost(0.0009)).toBe("<$0.001");
  });

  it("uses four decimals below a dollar", () => {
    expect(formatCost(0.001)).toBe("$0.0010");
    expect(formatCost(0.5123)).toBe("$0.5123");
  });

  it("uses two decimals at or above a dollar", () => {
    expect(formatCost(1)).toBe("$1.00");
    expect(formatCost(12.3456)).toBe("$12.35");
    expect(formatCost(999.99)).toBe("$999.99");
  });

  it("thousands-groups at or above a thousand", () => {
    expect(formatCost(1000)).toBe("$1,000");
    expect(formatCost(2155.56)).toBe("$2,156");
  });

  it("keys the grouping branch on the rounded value, not the raw one", () => {
    // 否则 999.996 会输出 $1000.00，与 1000 的 $1,000 在同一张表里不一致
    expect(formatCost(999.994)).toBe("$999.99");
    expect(formatCost(999.996)).toBe("$1,000");
    expect(formatCost(999.999)).toBe("$1,000");
    expect(formatCost(999.995)).toBe("$1,000");
  });

  it("treats a negative or non-finite value as unusable", () => {
    expect(formatCost(-1)).toBe("—");
    expect(formatCost(Number.NaN)).toBe("—");
  });
});

describe("sumUnpricedCalls", () => {
  const row = (over: Partial<UsageModelRow>): UsageModelRow => ({
    model: "m",
    provider: "p",
    input: 0,
    output: 0,
    cacheRead: 0,
    calls: 1,
    hitRate: null,
    cost: 1,
    ...over,
  });

  it("counts only the rows without a price", () => {
    expect(
      sumUnpricedCalls([
        row({ cost: null, calls: 7 }),
        row({ calls: 3 }),
        row({ model: null, cost: null, calls: 2 }),
      ]),
    ).toBe(9);
  });

  it("is zero when everything is priced", () => {
    expect(sumUnpricedCalls([row({})])).toBe(0);
  });
});

describe("resolveCellLevel in cost mode", () => {
  const day = (over: Partial<UsageDayRow>): UsageDayRow => ({
    date: "2026-09-20",
    input: 0,
    output: 0,
    cacheRead: 0,
    calls: 1,
    hitRate: null,
    cost: 0,
    ...over,
  });

  it("returns 0 for a day with no record", () => {
    expect(resolveCellLevel(undefined, "cost", [1])).toBe(0);
  });

  it("buckets by the day's cost, not by its token volume", () => {
    const values = [0.01, 0.5, 1, 5, 20];
    const rich = day({ cost: 20, input: 1 });
    const poor = day({ cost: 0.01, input: 10_000_000 });
    expect(resolveCellLevel(rich, "cost", values)).toBe(4);
    // 同一张图上 token 量巨大的那天可能最便宜 —— 这正是要有金额模式的原因
    expect(resolveCellLevel(poor, "cost", values)).toBe(1);
    expect(resolveCellLevel(poor, "usage", values)).toBe(4);
  });
});

describe("formatCost with currency", () => {
  it("converts USD to CNY with yuan tiers", () => {
    expect(formatCost(null, "CNY", 7.1, "zh-CN")).toBe("—");
    expect(formatCost(0, "CNY", 7.1, "zh-CN")).toBe("¥0");
    // 0.00284 元 < 最小单位 0.01：不能显示成 ¥0.00（静默归零）
    expect(formatCost(0.0004, "CNY", 7.1, "zh-CN")).toBe("<¥0.01");
    expect(formatCost(0.01, "CNY", 7.1, "zh-CN")).toBe("¥0.0710");
    expect(formatCost(1, "CNY", 7.1, "zh-CN")).toBe("¥7.10");
    expect(formatCost(1000, "CNY", 7.1, "zh-CN")).toBe("¥7,100");
  });

  it("JPY has no decimals and its underflow marker is one yen", () => {
    // $0.0004 → ¥0.06：JPY 0 位小数会显示成 ¥0，看着像免费，必须用 <¥1
    expect(formatCost(0.0004, "JPY", 157, "en-US")).toBe("<¥1");
    // $0.008 → ¥1.256 → 0 位小数 → ¥1
    expect(formatCost(0.008, "JPY", 157, "en-US")).toBe("¥1");
    expect(formatCost(1, "JPY", 157, "en-US")).toBe("¥157");
    expect(formatCost(1000, "JPY", 157, "en-US")).toBe("¥157,000");
    // zh 下符号变 JP¥（Intl 自带），合法且更清晰，不锁死它
    expect(formatCost(157, "JPY", 1, "zh-CN")).toBe("JP¥157");
  });

  it("uses the locale's symbol and placement", () => {
    expect(formatCost(1000, "CNY", 7.1, "en-US")).toBe("CN¥7,100");
    expect(formatCost(1000, "EUR", 0.92, "en-US")).toBe("€920.00");
    expect(formatCost(1000, "EUR", 0.92, "zh-CN")).toBe("€920.00");
  });

  it("falls back to dollars when the rate is missing or unusable", () => {
    expect(formatCost(1, "CNY", null)).toBe("$1.00");
    expect(formatCost(1, "CNY", 0)).toBe("$1.00");
    expect(formatCost(1, "CNY", Number.NaN)).toBe("$1.00");
  });

  it("keeps USD identical to the legacy path regardless of extras", () => {
    expect(formatCost(0.0004, "USD", 7.1)).toBe("<$0.001");
    expect(formatCost(1000, "USD", 7.1)).toBe("$1,000");
  });
});
