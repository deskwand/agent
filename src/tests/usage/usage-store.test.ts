import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  computeHitRate,
  createUsageSchema,
  queryUsage,
  recordUsage,
} from "../../main/usage/usage-store";
import type { UsageRecordInput } from "../../shared/usage";

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
