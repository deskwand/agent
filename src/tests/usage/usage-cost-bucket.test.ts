import { describe, expect, it } from "vitest";
import {
  bucketOf,
  buildPriceIndex,
  costOfBucket,
  costOfRecord,
  isBucketResolvable,
  type PriceIndex,
  type UsageCostRow,
} from "../../main/usage/usage-cost";

/**
 * 三个固定时刻。2026-10-12 是周一；DeepSeek 峰谷时段按 **UTC** 定义
 * （高峰 = UTC 01:00–04:00 与 06:00–10:00 的周一至周五）。
 */
const MON_PEAK = Date.parse("2026-10-12T02:00:00Z"); // 周一 · 高峰窗口内
const MON_OFF_PEAK = Date.parse("2026-10-12T05:00:00Z"); // 周一 · 窗口外
const SAT_SAME_HOUR = Date.parse("2026-10-10T02:00:00Z"); // 同一钟点，但是周六

const row = (over: Partial<UsageCostRow> = {}): UsageCostRow => ({
  ts: MON_OFF_PEAK,
  provider: "p1",
  model: "plain",
  input: 1000,
  output: 100,
  cacheRead: 0,
  cacheWrite: 0,
  ...over,
});

const index: PriceIndex = buildPriceIndex(
  [
    {
      provider: "p1",
      id: "plain",
      cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0 },
    },
    {
      provider: "p1",
      id: "tiered",
      cost: {
        input: 1,
        output: 2,
        cacheRead: 0.1,
        cacheWrite: 0,
        tiers: [
          {
            inputTokensAbove: 200_000,
            input: 2,
            output: 4,
            cacheRead: 0.2,
            cacheWrite: 0,
          },
        ],
      },
    },
  ],
  {},
  {
    // 键必须以 `*|` 开头：buildPriceIndex 会静默丢弃其它形状的键
    "*|planned": {
      peak: { input: 5, output: 6, cacheRead: 0.5, cacheWrite: 0 },
      offPeak: { input: 1, output: 1, cacheRead: 0.1, cacheWrite: 0 },
    },
  },
);

describe("usage bucket", () => {
  it("costOfBucket(bucketOf(row)) 与 costOfRecord(row) 逐条相等", () => {
    const cases: UsageCostRow[] = [
      row(), // 普通模型
      row({ model: "tiered" }), // 有档位但不跨档
      row({ model: "tiered", input: 300_000 }), // 跨档
      row({ model: "planned", ts: MON_PEAK }), // 计划 · 高峰
      row({ model: "planned", ts: MON_OFF_PEAK }), // 计划 · 非高峰
      row({ model: "planned", ts: SAT_SAME_HOUR }), // 计划 · 周末
      row({ model: "unknown-model" }), // 无价目
      row({ model: null, provider: null }), // 子代理桶
    ];
    for (const r of cases) {
      expect(costOfBucket(index, bucketOf(index, r), r)).toBe(
        costOfRecord(index, r),
      );
    }
  });

  it("peak 对所有模型都判定，不只对有计划的那几个", () => {
    // spec §3.2：peak 必须对所有模型都记，这样某个模型将来被加进
    // MODEL_PEAK_PRICING 时历史桶已经带了正确的峰谷标记（自愈的前提）。
    expect(bucketOf(index, row({ ts: MON_PEAK })).peak).toBe(1);
    expect(bucketOf(index, row({ ts: MON_OFF_PEAK })).peak).toBe(0);
    expect(bucketOf(index, row({ model: "planned", ts: MON_PEAK })).peak).toBe(
      1,
    );
    expect(
      bucketOf(index, row({ model: "planned", ts: MON_OFF_PEAK })).peak,
    ).toBe(0);
    expect(
      bucketOf(index, row({ model: "planned", ts: SAT_SAME_HOUR })).peak,
    ).toBe(0);
  });

  it("档位桶存的是命中的 inputTokensAbove，不是它的下标", () => {
    // 这条同时钉住 matchedTierOf 的恒等比较：ratesFor 一旦改成返回复制品，这里会红
    expect(bucketOf(index, row({ model: "tiered" })).tier).toBe(-1);
    expect(bucketOf(index, row({ model: "tiered", input: 300_000 })).tier).toBe(
      200_000,
    );
  });

  it("档位解析不到 = 陈旧；-1 与无价目都不算陈旧", () => {
    const bucket = (tier: number, model = "tiered") =>
      ({ provider: "p1", model, peak: 0 as const, tier }) as const;
    expect(isBucketResolvable(index, bucket(-1))).toBe(true);
    expect(isBucketResolvable(index, bucket(200_000))).toBe(true);
    expect(isBucketResolvable(index, bucket(123))).toBe(false); // 表里没有这一档
    expect(isBucketResolvable(index, bucket(-1, "no-such-model"))).toBe(true); // 无价目 ≠ 陈旧
  });
});
