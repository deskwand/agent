import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  createUsageSchema,
  loadUsageRows,
  queryUsage,
} from "../../main/usage/usage-store";
import { aggregateCosts, buildPriceIndex } from "../../main/usage/usage-cost";

/**
 * 验收阀值。默认跳过（性能断言不适合卡 CI）：
 *   DESKWAND_PERF=1 npx vitest run src/tests/usage/usage-cost-perf.test.ts
 *
 * 生成 75k 行对齐 2026-09-20 的真实规模。阀值锚在 spec §9 的实测上，并且**刻意
 * 不设端到端的绝对预算**：整条 queryUsage 里改动前就存在的四个 GROUP BY 聚合
 * 占大头，同一台机器上温态实测 196ms（空载）到 1014ms（负载 20+）—— 拿它当
 * 绝对阀值等于在赌机器有多忙，只会训练人忽略这条测试。
 *
 * 所以量两件事：
 *  1. 本次改动新增的两步（全表取数 + 逐条定价）< 300ms。spec §9 实测 152 + 35 = 187ms，
 *     独立复查的最小值 149ms（负载 40+）。
 *  2. 新增部分不得成为页面主体：added < 2 × baseline（baseline 是同样条件下重跑那
 *     四个既有聚合查询）。比值是尺度无关的，机器慢了两边一起慢。
 */
const enabled = process.env.DESKWAND_PERF === "1";

describe.skipIf(!enabled)("usage cost performance", () => {
  it("keeps the added cost work under the spec budget", () => {
    const db = new DatabaseSync(":memory:");
    createUsageSchema(db);
    const base = Date.parse("2026-09-20T12:00:00Z");
    const cutoff = base - 30 * 86_400_000;
    const insert = db.prepare(
      `INSERT INTO usage_records
         (ts, session_id, model, provider, source, purpose,
          input, output, cache_read, cache_write, dedup_key)
       VALUES (?, 's', 'deepseek-v4-pro', 'deepseek', 'chat', NULL, 3000, 500, 120000, 0, ?)`,
    );
    db.exec("BEGIN");
    for (let i = 0; i < 75_000; i += 1) insert.run(base - i * 60_000, `k${i}`);
    db.exec("COMMIT");

    const index = buildPriceIndex(
      [
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

    // 与 usage-store.ts 里那四个查询同形，只作基线用（spans the whole table, no cost work）
    const baseline = () => {
      db.prepare(
        `SELECT COALESCE(SUM(input),0) AS input, COUNT(*) AS calls
           FROM usage_records WHERE ts >= ?`,
      ).get(cutoff);
      db.prepare(
        `SELECT date(ts / 1000, 'unixepoch', 'localtime') AS date,
                COALESCE(SUM(input),0) AS input
           FROM usage_records GROUP BY date`,
      ).all();
      db.prepare(
        `SELECT CAST(strftime('%w', ts / 1000, 'unixepoch', 'localtime') AS INTEGER) AS weekday,
                CAST(strftime('%H', ts / 1000, 'unixepoch', 'localtime') AS INTEGER) AS hour,
                COALESCE(SUM(output),0) AS output
           FROM usage_records GROUP BY weekday, hour`,
      ).all();
      db.prepare(
        `SELECT model, provider, COALESCE(SUM(input),0) AS input
           FROM usage_records WHERE ts >= ? GROUP BY model, provider`,
      ).all(cutoff);
    };

    // 预热：同一条调用路径跑一次，把 JIT 与首次 GC 移出计时区间
    queryUsage(db, "30d", base, index);
    baseline();
    loadUsageRows(db);
    aggregateCosts(loadUsageRows(db), cutoff, index);

    // 取 3 次最小值：这台开发机的负载在 8~40 之间漂移，单次计时会被调度器抖动
    // 直接顶穿预算（实测同一段代码 93ms 与 331ms 都出现过）。最小值衡量的是
    // "这台机器做得到多快"，才是可比的量。
    const bestMs = (runs: number, fn: () => void): number => {
      let best = Number.POSITIVE_INFINITY;
      for (let i = 0; i < runs; i += 1) {
        const started = performance.now();
        fn();
        best = Math.min(best, performance.now() - started);
      }
      return best;
    };

    const addedElapsed = bestMs(3, () => {
      aggregateCosts(loadUsageRows(db), cutoff, index);
    });
    expect(
      aggregateCosts(loadUsageRows(db), cutoff, index).total,
    ).toBeGreaterThan(0);
    expect(addedElapsed).toBeLessThan(300);

    const baselineElapsed = bestMs(3, baseline);

    expect(addedElapsed).toBeLessThan(2 * baselineElapsed);

    // 用 "all" 对账：它的 cutoff 是 0，与上面手写的 cutoff 不是一回事 ——
    // queryUsage 的区间起点会吸附到本地午夜，拿它和 `base - 30d` 比会差出几小时。
    const all = queryUsage(db, "all", base, index);
    expect(all.totals.cost).toBeCloseTo(
      aggregateCosts(loadUsageRows(db), 0, index).total,
      10,
    );

    db.close();
  });
});
