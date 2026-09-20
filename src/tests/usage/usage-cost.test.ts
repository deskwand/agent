import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import type { ModelCost } from "@earendil-works/pi-ai";
import {
  aggregateCosts,
  buildPriceIndex,
  costOfRecord,
  localDateKey,
  providerModelKey,
  ratesFor,
  resolveModelCost,
  type UsageCostRow,
} from "../../main/usage/usage-cost";
import { MODEL_PRICE_OVERRIDES } from "../../main/usage/model-price-overrides";

const cost = (over: Partial<ModelCost> = {}): ModelCost => ({
  input: 1,
  output: 2,
  cacheRead: 0.1,
  cacheWrite: 0,
  ...over,
});

const RATES = { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 6.25 };
const TIERED: ModelCost = {
  ...RATES,
  tiers: [
    {
      inputTokensAbove: 272_000,
      input: 10,
      output: 45,
      cacheRead: 1,
      cacheWrite: 12.5,
    },
  ],
};

const registry = [
  {
    provider: "deepseek",
    id: "deepseek-v4-pro",
    cost: cost({ input: 0.435, output: 0.87 }),
  },
  { provider: "openai", id: "gpt-tier", cost: TIERED },
];

const row = (over: Partial<UsageCostRow> = {}): UsageCostRow => ({
  ts: 1_760_000_000_000,
  provider: "deepseek",
  model: "deepseek-v4-pro",
  input: 1_000_000,
  output: 1_000_000,
  cacheRead: 0,
  cacheWrite: 0,
  ...over,
});

describe("resolveModelCost", () => {
  it("hits the exact (provider, model) key", () => {
    const index = buildPriceIndex(registry, {});
    expect(resolveModelCost(index, "deepseek", "deepseek-v4-pro")?.input).toBe(
      0.435,
    );
  });

  it("falls back to the model id when the provider is not in the registry", () => {
    const index = buildPriceIndex(registry, {});
    // relay 场景：provider 名与模型不符（本机实测 openai/deepseek-v4-pro）
    expect(resolveModelCost(index, "openai", "deepseek-v4-pro")?.input).toBe(
      0.435,
    );
  });

  it("returns null when nothing matches", () => {
    const index = buildPriceIndex(registry, {});
    expect(resolveModelCost(index, "deepseek", "no-such-model")).toBeNull();
    expect(resolveModelCost(index, "deepseek", null)).toBeNull();
    expect(resolveModelCost(index, null, "deepseek-v4-pro")?.input).toBe(0.435);
  });

  it("drops negative sentinel prices instead of pricing them", () => {
    // 实测上游数据：openrouter/auto 的单价为负，按本机用量算出 -$3.1e8
    const index = buildPriceIndex(
      [{ provider: "openrouter", id: "auto", cost: cost({ input: -1 }) }],
      {},
    );
    expect(resolveModelCost(index, "openrouter", "auto")).toBeNull();
  });

  it("keeps a zero price as a real (free) price", () => {
    const index = buildPriceIndex(
      [
        {
          provider: "google",
          id: "gemma-x",
          cost: cost({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }),
        },
      ],
      {},
    );
    expect(resolveModelCost(index, "google", "gemma-x")).not.toBeNull();
  });
});

describe("override table precedence", () => {
  it("lets an override exact key beat the registry exact key", () => {
    const index = buildPriceIndex(registry, {
      [providerModelKey("deepseek", "deepseek-v4-pro")]: cost({ input: 9 }),
    });
    expect(resolveModelCost(index, "deepseek", "deepseek-v4-pro")?.input).toBe(
      9,
    );
  });

  it("lets a wildcard key price a runtime-generated provider id", () => {
    const index = buildPriceIndex(registry, {
      "*|deepseek-flash": cost({ input: 0.14 }),
    });
    // deskwand 自建的 relay provider 是运行期 uuid，代码里枚举不出来
    const provider = "deskwand:custom:0669dfbb-6c71-4c43-a952-654fba055647";
    expect(resolveModelCost(index, provider, "deepseek-flash")?.input).toBe(
      0.14,
    );
  });

  it("prefers the registry exact key over a wildcard override", () => {
    const index = buildPriceIndex(registry, {
      "*|deepseek-v4-pro": cost({ input: 99 }),
    });
    expect(resolveModelCost(index, "deepseek", "deepseek-v4-pro")?.input).toBe(
      0.435,
    );
  });

  it("ignores malformed override keys", () => {
    const index = buildPriceIndex(registry, {
      "no-separator": cost(),
      "deepseek|": cost(),
    });
    expect(resolveModelCost(index, "no-separator", "no-separator")).toBeNull();
    expect(index.overrideExact.size).toBe(0);
  });
});

describe("MODEL_PRICE_OVERRIDES invariants", () => {
  it("stays clean: well-formed keys and no negative rates", () => {
    // 这张表是人手改的维护口子，失败模式是静默的：负值会被 isUsableCost 丢掉、
    // 键写坏会被静默忽略，两者都不报错。所以把不变量钉在测试里。
    const entries = Object.entries(MODEL_PRICE_OVERRIDES);
    // 触雷式计数：新增一条就必须来改这里，顺便重读上面的规则
    expect(entries).toHaveLength(7);
    for (const [key, value] of entries) {
      const separator = key.indexOf("|");
      expect(separator).toBeGreaterThan(-1);
      const provider = key.slice(0, separator);
      const model = key.slice(separator + 1);
      expect(provider.length).toBeGreaterThan(0);
      // 空 model 的键会被 buildPriceIndex 静默忽略
      expect(model.length).toBeGreaterThan(0);
      expect(value.input).toBeGreaterThanOrEqual(0);
      expect(value.output).toBeGreaterThanOrEqual(0);
      expect(value.cacheRead).toBeGreaterThanOrEqual(0);
      expect(value.cacheWrite).toBeGreaterThanOrEqual(0);
      for (const tier of value.tiers ?? []) {
        // 阈值必须是正数：0 或负数会让所有请求都落进这一档
        expect(tier.inputTokensAbove).toBeGreaterThan(0);
        expect(tier.input).toBeGreaterThanOrEqual(0);
        expect(tier.output).toBeGreaterThanOrEqual(0);
        expect(tier.cacheRead).toBeGreaterThanOrEqual(0);
        expect(tier.cacheWrite).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe("ratesFor", () => {
  it("uses the base rate below the tier threshold", () => {
    expect(ratesFor(TIERED, 272_000).input).toBe(5);
  });

  it("uses the tier rate above the threshold", () => {
    expect(ratesFor(TIERED, 272_001).input).toBe(10);
  });

  it("picks the highest matching threshold when several apply", () => {
    const multi: ModelCost = {
      ...RATES,
      tiers: [
        {
          inputTokensAbove: 100_000,
          input: 7,
          output: 7,
          cacheRead: 7,
          cacheWrite: 7,
        },
        {
          inputTokensAbove: 272_000,
          input: 10,
          output: 45,
          cacheRead: 1,
          cacheWrite: 12.5,
        },
      ],
    };
    expect(ratesFor(multi, 300_000).input).toBe(10);
  });
});

describe("costOfRecord", () => {
  it("multiplies rates by tokens and divides by a million", () => {
    const index = buildPriceIndex(registry, {});
    // 1M input @0.435 + 1M output @0.87
    expect(costOfRecord(index, row())).toBeCloseTo(1.305, 10);
  });

  it("takes the tier from the single record's prompt size", () => {
    const index = buildPriceIndex(registry, {});
    const big = row({
      provider: "openai",
      model: "gpt-tier",
      input: 100_000,
      output: 10,
      cacheRead: 200_000,
    });
    // prompt = 300k > 272k → tier rates
    expect(costOfRecord(index, big)).toBeCloseTo(1.20045, 10);
  });

  it("returns null when the model has no price", () => {
    const index = buildPriceIndex(registry, {});
    expect(costOfRecord(index, row({ model: "nope" }))).toBeNull();
  });
});

describe("localDateKey", () => {
  it("matches SQLite's localtime day key character for character", () => {
    // 归集用 JS、聚合用 SQL，两侧日界必须一致，否则同一天会被拆成两行。
    // 直接拿 SQLite 自己的输出当基准，所以这个断言在任何时区都成立。
    const db = new DatabaseSync(":memory:");
    const timestamps: number[] = [];
    for (const day of [
      "2026-11-01",
      "2026-03-08",
      "2026-09-06",
      "2026-01-01",
    ]) {
      for (const hour of [0, 1, 2, 23]) {
        timestamps.push(
          Date.parse(`${day}T${String(hour).padStart(2, "0")}:30:00`),
        );
      }
    }
    for (const ts of timestamps) {
      const sql = (
        db
          .prepare("SELECT date(? / 1000, 'unixepoch', 'localtime') AS d")
          .get(ts) as unknown as { d: string }
      ).d;
      expect(localDateKey(ts)).toBe(sql);
    }
    db.close();
  });
});

describe("aggregateCosts", () => {
  const index = buildPriceIndex(registry, {});
  const DAY = 86_400_000;
  const cutoff = Date.parse("2026-09-12T00:00:00");
  const deepseekRow = (ts: number, input = 1_000_000): UsageCostRow => ({
    ts,
    provider: "deepseek",
    model: "deepseek-v4-pro",
    input,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  });

  it("sums the requested range into total and keys by model+provider", () => {
    const result = aggregateCosts(
      [deepseekRow(cutoff + 1), deepseekRow(cutoff + 2)],
      cutoff,
      index,
    );
    expect(result.total).toBeCloseTo(0.87, 10);
    expect(
      result.byModel.get(providerModelKey("deepseek", "deepseek-v4-pro")),
    ).toBeCloseTo(0.87, 10);
  });

  it("keeps byDay all-time even when a row is outside the range", () => {
    const old = cutoff - DAY;
    const result = aggregateCosts(
      [deepseekRow(old), deepseekRow(cutoff + 1)],
      cutoff,
      index,
    );
    expect(result.total).toBeCloseTo(0.435, 10);
    expect(result.byDay.get(localDateKey(old))).toBeCloseTo(0.435, 10);
    expect(result.byDay.get(localDateKey(cutoff + 1))).toBeCloseTo(0.435, 10);
  });

  it("records an unpriced model as null rather than zero", () => {
    const result = aggregateCosts(
      [
        deepseekRow(cutoff + 1),
        { ...deepseekRow(cutoff + 1), model: "unknown-model" },
      ],
      cutoff,
      index,
    );
    expect(
      result.byModel.get(providerModelKey("deepseek", "unknown-model")),
    ).toBeNull();
    expect(result.total).toBeCloseTo(0.435, 10);
  });

  it("adds up several rows of the same model", () => {
    const result = aggregateCosts(
      [
        deepseekRow(cutoff + 1),
        deepseekRow(cutoff + 2),
        deepseekRow(cutoff + 3),
      ],
      cutoff,
      index,
    );
    expect(
      result.byModel.get(providerModelKey("deepseek", "deepseek-v4-pro")),
    ).toBeCloseTo(1.305, 10);
  });
});
