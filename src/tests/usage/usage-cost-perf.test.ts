import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  createUsageSchema,
  queryUsage,
  rebuildUsageRollup,
} from "../../main/usage/usage-store";
import { buildPriceIndex } from "../../main/usage/usage-cost";

/**
 * 验收阀值。默认跳过（性能断言不适合卡 CI）：
 *   DESKWAND_PERF=1 npx vitest run src/tests/usage/usage-cost-perf.test.ts
 *
 * 生成 150k 行，对齐 2026-10-12 的真实规模（145,891 行）。
 *
 * 2026-10-12 起读取路径改为扫日聚合表（本机 357 行），所以这里量的是**聚合路径的
 * 绝对预算**：< 20ms。这条阈值不再是"赌机器有多忙"——它比改动前的 ~450ms 低了
 * 一个数量级，机器再忙也不会把它推过线；真推过了，说明聚合路径退化成了扫原始表。
 *
 * 实测（2026-10-12，本机）：150k 行 fixture 上聚合路径 **0.60ms**；真实库 146,397 行
 * 上 **0.59ms（1d）/ 0.78ms（all）**。同一个真实库上的一次完整重建是 420ms
 * （其组成与"逐行 prepare 会变成 3.5s"的教训见 design §6.2）。
 *
 * 重建耗时**刻意不做硬断言**：它是一次性的（只在版本变化时发生），由 design §11
 * 记录。
 */
const enabled = process.env.DESKWAND_PERF === "1";

describe.skipIf(!enabled)("usage rollup performance", () => {
  it("聚合路径的 queryUsage 在 150k 行规模上 < 20ms", async () => {
    const db = new DatabaseSync(":memory:");
    createUsageSchema(db);
    const base = Date.parse("2026-09-20T12:00:00Z");
    const insert = db.prepare(
      `INSERT INTO usage_records
         (ts, session_id, model, provider, source, purpose,
          input, output, cache_read, cache_write, dedup_key)
       VALUES (?, 's', 'deepseek-v4-pro', 'deepseek', 'chat', NULL, 3000, 500, 120000, 0, ?)`,
    );
    db.exec("BEGIN");
    for (let i = 0; i < 150_000; i += 1) insert.run(base - i * 60_000, `k${i}`);
    db.exec("COMMIT");

    const index = buildPriceIndex(
      [],
      {},
      {
        "*|deepseek-v4-pro": {
          peak: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0 },
          offPeak: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0 },
        },
      },
    );
    await rebuildUsageRollup(db, index);
    const started = performance.now();
    const snap = queryUsage(db, "30d", base, index);
    const elapsed = performance.now() - started;
    expect(elapsed).toBeLessThan(20);
    expect(snap.totals.calls).toBeGreaterThan(0);
    expect(
      (
        db.prepare("SELECT COUNT(*) AS n FROM usage_daily").get() as {
          n: number;
        }
      ).n,
    ).toBeGreaterThan(0);
    db.close();
  });
});
