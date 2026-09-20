import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  createUsageSchema,
  loadUsageRows,
  queryUsage,
  recordUsage,
} from "../../main/usage/usage-store";
import {
  aggregateCosts,
  buildPriceIndex,
  providerModelKey,
} from "../../main/usage/usage-cost";
import { sumUnpricedCalls } from "../../renderer/utils/usage-format";
import type { UsageRecordInput } from "../../shared/usage";

/**
 * 端到端对账：定价链路整条对得上，而不只是各自单测通过。
 *
 * fixture 里的期望值是手算的，并且刻意与"先聚合再套价"（C 口径）不同 ——
 * 那个写法实测在本机真实数据上偏差 +64%，是最容易顺手写出来的错误实现。
 */
describe("usage cost reconciliation", () => {
  const NOW = Date.parse("2026-09-20T12:00:00Z");
  const TIER = 272_000;
  const priceIndex = buildPriceIndex(
    [
      {
        provider: "openai",
        id: "gpt-tier",
        cost: {
          input: 5,
          output: 30,
          cacheRead: 0.5,
          cacheWrite: 6.25,
          tiers: [
            {
              inputTokensAbove: TIER,
              input: 10,
              output: 45,
              cacheRead: 1,
              cacheWrite: 12.5,
            },
          ],
        },
      },
      {
        provider: "deepseek",
        id: "deepseek-v4-pro",
        cost: {
          input: 0.435,
          output: 0.87,
          cacheRead: 0.003625,
          cacheWrite: 0,
        },
      },
    ],
    {},
  );

  let db: DatabaseSync;
  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    createUsageSchema(db);
  });
  afterEach(() => db.close());

  const insert = (over: Partial<UsageRecordInput>) =>
    recordUsage(db, {
      // 用 NOW 本身：区间起点是本地午夜，NOW 永远在区间内（NOW-1000ms 在极西时区会掉到前一天）
      ts: NOW,
      sessionId: "s1",
      model: "gpt-tier",
      provider: "openai",
      source: "chat",
      purpose: null,
      dedupKey: null,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      ...over,
    });

  it("prices each record with its own tier, not the aggregated total", () => {
    // 记录 1：prompt = 100k + 200k = 300k > 272k → 高档
    //   (10×100000 + 45×10 + 1×200000) / 1e6 = 1.20045
    insert({ input: 100_000, output: 10, cacheRead: 200_000, dedupKey: "a" });
    // 记录 2：prompt = 1000 < 272k → 基础档
    //   (5×1000 + 30×2) / 1e6 = 0.00506
    insert({ input: 1_000, output: 2, dedupKey: "b" });

    const span = queryUsage(db, "1d", NOW, priceIndex);
    expect(span.totals.cost).toBeCloseTo(1.20551, 10);
    // C 口径（把聚合量套高档）会得到 1.21054，B 口径（全基础价）会得到 0.60536
    expect(span.totals.cost).not.toBeCloseTo(1.21054, 5);
    expect(span.totals.cost).not.toBeCloseTo(0.60536, 5);
  });

  it("reconciles totals.cost with the model rows and keeps unpriced rows out", () => {
    insert({
      input: 1_000_000,
      output: 1_000_000,
      dedupKey: "a",
      provider: "deepseek",
      model: "deepseek-v4-pro",
    });
    insert({
      input: 5_000,
      output: 5_000,
      dedupKey: "b",
      provider: "deepseek",
      model: "deepseek-flash",
    });

    const span = queryUsage(db, "1d", NOW, priceIndex);
    const priced = span.byModel.filter((row) => row.cost !== null);
    expect(priced).toHaveLength(1);
    expect(priced[0].cost).toBeCloseTo(1.305, 10);
    expect(span.totals.cost).toBeCloseTo(1.305, 10);
    // deepseek-flash 无价目：行在，金额是 null —— 不是 0
    expect(
      span.byModel.find((row) => row.model === "deepseek-flash")?.cost,
    ).toBeNull();
  });

  it("gives every range-scoped model row a byModel key", () => {
    // 防的是"归集键与查询侧键写得不一致"这类静默缺陷：换个参数顺序不会报错，
    // 只会让 cost 变 null —— 金额偏小，同时把无价目的计数顶上去。
    insert({
      input: 1_000_000,
      output: 1_000_000,
      dedupKey: "a",
      provider: "deepseek",
      model: "deepseek-v4-pro",
    });
    insert({
      input: 5_000,
      output: 5_000,
      dedupKey: "b",
      provider: "deepseek",
      model: "deepseek-flash",
    });
    const span = queryUsage(db, "1d", NOW, priceIndex);
    const costs = aggregateCosts(
      loadUsageRows(db),
      NOW - 86_400_000,
      priceIndex,
    );
    for (const row of span.byModel) {
      expect(costs.byModel.has(providerModelKey(row.provider, row.model))).toBe(
        true,
      );
    }
  });

  it("derives the unpriced call count that the card shows", () => {
    // 卡片上的计数是渲染层从 byModel 推出来的（spec §5 决定不新增契约字段），
    // 所以拿它和"直接数无价目的行"交叉核一次，而不是自证自洽
    insert({ dedupKey: "p1", provider: "deepseek", model: "deepseek-v4-pro" });
    insert({ dedupKey: "p2", provider: "deepseek", model: "deepseek-v4-pro" });
    insert({ dedupKey: "u1", provider: "deepseek", model: "deepseek-flash" });
    insert({
      dedupKey: "u2",
      provider: "deskwand:custom:x",
      model: "some-new-model",
    });
    insert({
      dedupKey: "u3",
      provider: "deskwand:custom:x",
      model: "some-new-model",
    });

    const span = queryUsage(db, "1d", NOW, priceIndex);
    const unpriced = db
      .prepare(
        `SELECT COUNT(*) AS n FROM usage_records
          WHERE model IS NULL OR model NOT IN ('deepseek-v4-pro')`,
      )
      .get() as unknown as { n: number };
    expect(unpriced.n).toBe(3);
    expect(sumUnpricedCalls(span.byModel)).toBe(unpriced.n);
  });

  it("prices the same tokens differently across providers of one model", () => {
    // 精确键是 (供应商, 模型)：同名模型两个 provider 两份价
    const index = buildPriceIndex(
      [
        {
          provider: "openai",
          id: "gpt-tier",
          cost: { input: 4, output: 20, cacheRead: 0.4, cacheWrite: 5 },
        },
        {
          provider: "openai-codex",
          id: "gpt-tier",
          cost: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 6.25 },
        },
      ],
      {},
    );
    const plain = queryUsage(db, "1d", NOW, index);
    expect(plain.totals.cost).toBe(0);
    insert({
      provider: "openai",
      model: "gpt-tier",
      input: 1_000_000,
      output: 1_000_000,
      dedupKey: "a",
    });
    insert({
      provider: "openai-codex",
      model: "gpt-tier",
      input: 1_000_000,
      output: 1_000_000,
      dedupKey: "b",
    });
    const span = queryUsage(db, "1d", NOW, index);
    // (4 + 20) + (5 + 30) = 59
    expect(span.totals.cost).toBeCloseTo(59, 10);
  });
});
