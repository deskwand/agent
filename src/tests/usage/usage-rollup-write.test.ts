import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  ROLLUP_VERSION,
  createUsageSchema,
  recordUsage,
} from "../../main/usage/usage-store";
import type { UsageRecordInput } from "../../shared/usage";

const MON_PEAK = Date.parse("2026-10-12T02:00:00Z");
const MON_OFF_PEAK = Date.parse("2026-10-12T05:00:00Z");

const base = (over: Partial<UsageRecordInput> = {}): UsageRecordInput => ({
  ts: MON_OFF_PEAK,
  sessionId: "s1",
  model: "deepseek-flash",
  provider: "deepseek",
  source: "chat",
  purpose: null,
  dedupKey: "chat:s1:1",
  input: 10,
  output: 20,
  cacheRead: 30,
  cacheWrite: 0,
  ...over,
});

/**
 * 夹具：建立有效的 state 行 = 声称"聚合已完整"。
 *
 * 写入闸门读的就是这一行（重建进行中 = 这行被删），所以不建它的话 `recordUsage`
 * 只插原始行、不碰聚合 —— 这是**重建期间防重复计数**的机制，不是本测试的噪声。
 */
const markFresh = (db: DatabaseSync) =>
  db
    .prepare(
      "INSERT OR REPLACE INTO usage_rollup_state (id, rollup_version, built_at) VALUES (1, ?, 0)",
    )
    .run(ROLLUP_VERSION);

interface DailyRow {
  day: string;
  provider: string;
  model: string;
  peak: number;
  tier: number;
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
  calls: number;
}

const daily = (db: DatabaseSync): DailyRow[] =>
  db
    .prepare(
      `SELECT day, provider, model, peak, tier, input, output, cache_read,
              cache_write, calls
         FROM usage_daily ORDER BY day, provider, model, peak, tier`,
    )
    .all() as unknown as DailyRow[];

const hourly = (db: DatabaseSync) =>
  db
    .prepare(
      "SELECT weekday, hour, output FROM usage_hour ORDER BY weekday, hour",
    )
    .all() as unknown as Array<{
    weekday: number;
    hour: number;
    output: number;
  }>;

const rawRows = (db: DatabaseSync) =>
  (
    db.prepare("SELECT COUNT(*) AS n FROM usage_records").get() as {
      n: number;
    }
  ).n;

describe("usage rollup write path", () => {
  let db: DatabaseSync;
  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    createUsageSchema(db);
  });
  afterEach(() => db.close());

  it("createUsageSchema 幂等，且三张表都建出来", () => {
    createUsageSchema(db);
    const names = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as unknown as Array<{ name: string }>
    ).map((r) => r.name);
    expect(names).toContain("usage_daily");
    expect(names).toContain("usage_hour");
    expect(names).toContain("usage_rollup_state");
  });

  it("没有 state 行时只插原始行，不碰聚合（首次安装 / 重建进行中）", () => {
    expect(rawRows(db)).toBe(0);
    recordUsage(db, base());
    expect(rawRows(db)).toBe(1);
    // 闸门关着：聚合表必须保持为空，否则重建期间这条写入会被计两次
    expect(daily(db)).toEqual([]);
    expect(hourly(db)).toEqual([]);
  });

  it("写一条记录：原始行与聚合行同时出现", () => {
    markFresh(db);
    expect(recordUsage(db, base())).toBe(true);
    expect(daily(db)).toEqual([
      {
        day: "2026-10-12",
        provider: "deepseek",
        model: "deepseek-flash",
        peak: 0, // 05:00Z 不在高峰窗口内
        tier: -1,
        input: 10,
        output: 20,
        cache_read: 30,
        cache_write: 0,
        calls: 1,
      },
    ]);
    expect(hourly(db)).toHaveLength(1);
  });

  it("同一天同一个桶的多次写入累加", () => {
    markFresh(db);
    recordUsage(db, base({ dedupKey: "k1" }));
    recordUsage(
      db,
      base({ dedupKey: "k2", input: 5, output: 7, cacheRead: 1 }),
    );
    const rows = daily(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      input: 15,
      output: 27,
      cache_read: 31,
      calls: 2,
    });
  });

  it("重放同一个 dedupKey 不重复计（幂等）", () => {
    markFresh(db);
    expect(recordUsage(db, base())).toBe(true);
    expect(recordUsage(db, base())).toBe(false);
    expect(daily(db)[0]).toMatchObject({ calls: 1, input: 10 });
    expect(hourly(db)[0].output).toBe(20);
  });

  it("峰谷与跨天落到不同的桶", () => {
    markFresh(db);
    recordUsage(db, base({ dedupKey: "k1", ts: MON_PEAK }));
    recordUsage(db, base({ dedupKey: "k2", ts: MON_OFF_PEAK }));
    const rows = daily(db);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.peak).sort()).toEqual([0, 1]);
  });

  it("provider / model 为 NULL 时桶键存成空串", () => {
    markFresh(db);
    recordUsage(db, base({ model: null, provider: null }));
    expect(daily(db)[0]).toMatchObject({ provider: "", model: "" });
  });

  it("aux 行（dedupKey 为 NULL）每次都插入，聚合累加", () => {
    markFresh(db);
    const aux = base({ source: "aux", purpose: "title", dedupKey: null });
    expect(recordUsage(db, aux)).toBe(true);
    expect(recordUsage(db, aux)).toBe(true);
    expect(daily(db)[0]).toMatchObject({ calls: 2 });
  });

  it("在外层事务里调用也成立（回填路径就是这么调的）", () => {
    markFresh(db);
    db.exec("BEGIN");
    recordUsage(db, base({ dedupKey: "k1" }));
    recordUsage(db, base({ dedupKey: "k2" }));
    db.exec("COMMIT");
    expect(daily(db)[0]).toMatchObject({ calls: 2 });
  });

  it("没有写入时两张聚合表都是空的", () => {
    markFresh(db);
    expect(daily(db)).toEqual([]);
    expect(hourly(db)).toEqual([]);
  });
});
