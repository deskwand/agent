import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  computeHitRate,
  createUsageSchema,
  queryUsage,
  recordUsage,
} from "../../main/usage/usage-store";
import type { UsageRecordInput } from "../../shared/usage";
import { buildPriceIndex, type PriceIndex } from "../../main/usage/usage-cost";

const base = (over: Partial<UsageRecordInput> = {}): UsageRecordInput => ({
  ts: 1_760_000_000_000,
  sessionId: "s1",
  model: "m1",
  provider: "p1",
  source: "chat",
  purpose: null,
  dedupKey: "chat:s1:1",
  input: 10,
  output: 20,
  cacheRead: 30,
  cacheWrite: 0,
  ...over,
});

// Fixed reference instant: the assertions below are relative to it.
const DAY = 86_400_000;
const NOW = Date.parse("2026-09-13T12:00:00Z");

describe("usage-store schema + recordUsage", () => {
  let db: DatabaseSync;
  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    createUsageSchema(db);
  });
  afterEach(() => db.close());

  it("stores every token column verbatim", () => {
    recordUsage(db, base());
    const row = db.prepare("SELECT * FROM usage_records").get() as Record<
      string,
      unknown
    >;
    expect(row).toMatchObject({
      ts: 1_760_000_000_000,
      session_id: "s1",
      model: "m1",
      provider: "p1",
      source: "chat",
      purpose: null,
      input: 10,
      output: 20,
      cache_read: 30,
      cache_write: 0,
      dedup_key: "chat:s1:1",
    });
  });

  it("is idempotent for a repeated dedup_key", () => {
    expect(recordUsage(db, base())).toBe(true);
    expect(recordUsage(db, base({ output: 999 }))).toBe(false);
    const { c } = db
      .prepare("SELECT COUNT(*) AS c FROM usage_records")
      .get() as { c: number };
    expect(c).toBe(1);
  });

  it("keeps every aux row when dedup_key is NULL (same ms, same purpose)", () => {
    const aux = base({ source: "aux", purpose: "title", dedupKey: null });
    expect(recordUsage(db, aux)).toBe(true);
    expect(recordUsage(db, aux)).toBe(true);
    const { c } = db
      .prepare("SELECT COUNT(*) AS c FROM usage_records")
      .get() as { c: number };
    expect(c).toBe(2);
  });

  it("allows a NULL session_id and a NULL model", () => {
    recordUsage(db, base({ sessionId: null, model: null, dedupKey: null }));
    const row = db
      .prepare("SELECT session_id, model FROM usage_records")
      .get() as { session_id: string | null; model: string | null };
    expect(row).toEqual({ session_id: null, model: null });
  });

  it("creating the schema twice is a no-op", () => {
    createUsageSchema(db);
    expect(() => recordUsage(db, base())).not.toThrow();
  });
});

describe("computeHitRate", () => {
  it("divides cacheRead by prompt total", () => {
    expect(computeHitRate(25, 75, 0)).toBeCloseTo(75);
  });

  it("returns null when the provider reports no cache at all", () => {
    expect(computeHitRate(100, 0, 0)).toBeNull();
  });

  it("returns 0 when a cache-capable provider missed everything", () => {
    expect(computeHitRate(100, 0, 10)).toBe(0);
  });
});

describe("queryUsage", () => {
  let db: DatabaseSync;
  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    createUsageSchema(db);
    recordUsage(
      db,
      base({
        ts: NOW - DAY,
        input: 25,
        output: 5,
        cacheRead: 75,
        dedupKey: "a",
      }),
    );
    recordUsage(
      db,
      base({
        ts: NOW - DAY,
        input: 0,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        model: "m2",
        dedupKey: "b",
      }),
    );
    recordUsage(
      db,
      base({
        ts: NOW - 40 * DAY,
        input: 1,
        output: 2,
        cacheRead: 3,
        model: "old",
        dedupKey: "c",
      }),
    );
    recordUsage(
      db,
      base({
        ts: NOW - DAY,
        input: 7,
        output: 8,
        cacheRead: 9,
        model: null,
        provider: null,
        source: "subagent",
        dedupKey: "d",
      }),
    );
  });
  afterEach(() => db.close());

  it("filters by range", () => {
    expect(queryUsage(db, "7d", NOW).totals.calls).toBe(3);
    expect(queryUsage(db, "all", NOW).totals.calls).toBe(4);
  });

  it("computes totals and hit rate over the selected range", () => {
    const snap = queryUsage(db, "7d", NOW);
    expect(snap.totals).toMatchObject({
      input: 32,
      output: 14,
      cacheRead: 84,
      cacheWrite: 0,
      calls: 3,
    });
    expect(snap.totals.hitRate).toBeCloseTo((84 / 116) * 100);
  });

  it("groups by local day, ascending", () => {
    const snap = queryUsage(db, "all", NOW);
    expect(snap.byDay).toHaveLength(2);
    expect(snap.byDay[0].date < snap.byDay[1].date).toBe(true);
    expect(snap.byDay[snap.byDay.length - 1].calls).toBe(3);
  });

  it("groups by model and keeps the subagent bucket as a NULL-model row", () => {
    const snap = queryUsage(db, "7d", NOW);
    expect(snap.byModel.map((m) => m.model)).toEqual([null, "m1", "m2"]);
    const sub = snap.byModel.find((m) => m.model === null);
    expect(sub).toMatchObject({ provider: null, output: 8, calls: 1 });
  });

  it("reports a null hit rate for a model whose provider reports no cache", () => {
    const snap = queryUsage(db, "7d", NOW);
    expect(snap.byModel.find((m) => m.model === "m2")?.hitRate).toBeNull();
  });

  it("keeps byDay all-time so the calendar heatmap does not move with the range", () => {
    const week = queryUsage(db, "7d", NOW);
    const all = queryUsage(db, "all", NOW);
    expect(week.byDay).toEqual(all.byDay);
    expect(week.byDay).toHaveLength(2);
  });

  it("returns the weekday × hour cross-tab for the hour heatmap", () => {
    const snap = queryUsage(db, "all", NOW);
    const total = snap.byHour.reduce((sum, cell) => sum + cell.output, 0);
    expect(total).toBe(16);
    for (const cell of snap.byHour) {
      expect(cell.weekday).toBeGreaterThanOrEqual(0);
      expect(cell.weekday).toBeLessThanOrEqual(6);
      expect(cell.hour).toBeGreaterThanOrEqual(0);
      expect(cell.hour).toBeLessThanOrEqual(23);
    }
  });
});

describe("local calendar-day ranges", () => {
  let db: DatabaseSync;
  /** 本地时间构造 epoch ms：月份 1-based，避免 UTC 偏移带来的歧义。 */
  const at = (y: number, m: number, d: number, h = 0, min = 0) =>
    new Date(y, m - 1, d, h, min, 0, 0).getTime();

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    createUsageSchema(db);
  });
  afterEach(() => db.close());

  it("1d includes local midnight and excludes the minute before it", () => {
    recordUsage(
      db,
      base({ ts: at(2026, 9, 13, 0, 0), output: 5, dedupKey: "midnight" }),
    );
    recordUsage(
      db,
      base({ ts: at(2026, 9, 12, 23, 59), output: 100, dedupKey: "before" }),
    );
    expect(queryUsage(db, "1d", at(2026, 9, 13, 15)).totals.output).toBe(5);
  });

  it("7d starts at the local midnight six days back", () => {
    recordUsage(
      db,
      base({ ts: at(2026, 9, 7, 0, 0), output: 1, dedupKey: "in-window" }),
    );
    recordUsage(
      db,
      base({ ts: at(2026, 9, 6, 23, 59), output: 500, dedupKey: "outside" }),
    );
    expect(queryUsage(db, "7d", at(2026, 9, 13, 15)).totals.output).toBe(1);
  });

  // byDay 只包含"有记录的自然日"，空白天不在里面 —— 这一点由下面的 gap 用例锁住。
  it("7d totals equal the sum of the last 7 byDay cells", () => {
    const now = at(2026, 9, 13, 15);
    for (let i = 0; i < 8; i += 1) {
      // 每天放在 23:00：这样"滚动 7×24h"会把第 8 天的那条也纳进来，
      // 而"最后 7 个自然日"不会 —— 这条断言才能在改动前后给出不同结果。
      // （若放在 now 之前的时刻，滚动窗口也排除了它，断言会变成恒真。）
      recordUsage(
        db,
        base({
          ts: at(2026, 9, 6 + i, 23),
          output: i + 1,
          dedupKey: `day-${i}`,
        }),
      );
    }
    const snap = queryUsage(db, "7d", now);
    expect(snap.byDay).toHaveLength(8);
    const lastSeven = snap.byDay
      .slice(-7)
      .reduce((sum, row) => sum + row.output, 0);
    expect(snap.totals.output).toBe(lastSeven);
    // 9-06 那条（output 1）必须被排除
    expect(snap.totals.output).toBe(2 + 3 + 4 + 5 + 6 + 7 + 8);
  });

  it("1d totals equal the last byDay cell", () => {
    const now = at(2026, 9, 13, 15);
    // 放在 23:00：滚动 24h（起点 9-12 15:00）会把它算进来，自然日语义不会 ——
    // 放在 now 之前的时刻这条断言在两种语义下都通过，等于没测。
    recordUsage(
      db,
      base({ ts: at(2026, 9, 12, 23), output: 7, dedupKey: "yesterday" }),
    );
    recordUsage(
      db,
      base({ ts: at(2026, 9, 13, 9), output: 3, dedupKey: "today" }),
    );
    const snap = queryUsage(db, "1d", now);
    expect(snap.totals.output).toBe(snap.byDay[snap.byDay.length - 1].output);
    expect(snap.totals.output).toBe(3);
  });

  it("ignores days with no records instead of counting them as empty cells", () => {
    const now = at(2026, 9, 13, 15);
    // 只有 5 天有数据（9-07/09-08/09-11/09-12/09-13），中间 9-09、09-10 为空：
    // 空白天不在 byDay 里，不应把窗口往前挤。
    for (const [day, output] of [
      [7, 1],
      [8, 2],
      [11, 4],
      [12, 8],
      [13, 16],
    ] as const) {
      recordUsage(
        db,
        base({ ts: at(2026, 9, day, 10), output, dedupKey: `gap-${day}` }),
      );
    }
    const snap = queryUsage(db, "7d", now);
    expect(snap.byDay).toHaveLength(5);
    expect(snap.totals.output).toBe(1 + 2 + 4 + 8 + 16);
  });

  it("keeps the boundary on local midnight across a month boundary", () => {
    // 2026-03-02 的 7 天窗口起点是 2026-02-24 00:00
    recordUsage(
      db,
      base({ ts: at(2026, 2, 24, 0, 0), output: 2, dedupKey: "feb-in" }),
    );
    recordUsage(
      db,
      base({ ts: at(2026, 2, 23, 23, 59), output: 400, dedupKey: "feb-out" }),
    );
    expect(queryUsage(db, "7d", at(2026, 3, 2, 10)).totals.output).toBe(2);
  });
});

describe("queryUsage cost fields", () => {
  let db: DatabaseSync;
  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    createUsageSchema(db);
  });
  afterEach(() => db.close());

  /** 1M input @0.435 + 1M output @0.87 = 1.305 */
  const priceIndex: PriceIndex = buildPriceIndex(
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

  it("fills totals.cost, byDay.cost and byModel.cost", () => {
    const row = (over: Partial<UsageRecordInput> = {}) =>
      base({
        // 用 NOW 本身而不是 NOW-1000ms：区间起点是本地午夜，NOW 永远在区间内，
        // 而任何毫秒级的回退在极西时区都会掉到前一天
        ts: NOW,
        provider: "deepseek",
        model: "deepseek-v4-pro",
        input: 1_000_000,
        output: 1_000_000,
        cacheRead: 0,
        dedupKey: null,
        ...over,
      });
    recordUsage(db, row({ dedupKey: "a" }));
    recordUsage(db, row({ ts: NOW - 90 * DAY, dedupKey: "b" }));

    const span = queryUsage(db, "1d", NOW, priceIndex);
    // 只有区间内的那一行进合计
    expect(span.totals.cost).toBeCloseTo(1.305, 10);
    // byDay 恒为全部区间，所以两行都在
    expect(span.byDay.reduce((sum, r) => sum + r.cost, 0)).toBeCloseTo(
      2.61,
      10,
    );
    const models = span.byModel.filter((r) => r.model === "deepseek-v4-pro");
    expect(models).toHaveLength(1);
    expect(models[0].cost).toBeCloseTo(1.305, 10);
  });

  it("keeps totals.cost equal to the sum of the range-scoped model rows", () => {
    recordUsage(
      db,
      base({
        ts: NOW,
        provider: "deepseek",
        model: "deepseek-v4-pro",
        dedupKey: "a",
      }),
    );
    recordUsage(
      db,
      base({
        ts: NOW - 2000,
        provider: "deepseek",
        model: "no-price",
        dedupKey: "b",
      }),
    );
    const span = queryUsage(db, "1d", NOW, priceIndex);
    const sum = span.byModel.reduce((n, r) => n + (r.cost ?? 0), 0);
    expect(span.totals.cost).toBeCloseTo(sum, 10);
    expect(span.byModel.some((r) => r.cost === null)).toBe(true);
  });
});
