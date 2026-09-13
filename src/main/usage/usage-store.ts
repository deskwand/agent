/**
 * Storage for local usage records: schema, append-only writer, aggregation.
 *
 * Only depends on node:sqlite's DatabaseSync (no Electron), so every unit test
 * runs against `new DatabaseSync(":memory:")`.
 */

import type { DatabaseSync } from "node:sqlite";
import type {
  UsageDayRow,
  UsageHourRow,
  UsageModelRow,
  UsageRange,
  UsageRecordInput,
  UsageSnapshot,
  UsageTotals,
} from "../../shared/usage";

export function createUsageSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS usage_records (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      ts          INTEGER NOT NULL,
      session_id  TEXT,
      model       TEXT,
      provider    TEXT,
      source      TEXT NOT NULL,
      purpose     TEXT,
      input       INTEGER NOT NULL DEFAULT 0,
      output      INTEGER NOT NULL DEFAULT 0,
      cache_read  INTEGER NOT NULL DEFAULT 0,
      cache_write INTEGER NOT NULL DEFAULT 0,
      dedup_key   TEXT UNIQUE
    );
    CREATE INDEX IF NOT EXISTS idx_usage_ts ON usage_records(ts);
    CREATE INDEX IF NOT EXISTS idx_usage_model_ts ON usage_records(model, ts);
    -- Internal bookkeeping (currently the backfill corpus fingerprint). Lives in
    -- the same database as the rows it describes so both commit together.
    CREATE TABLE IF NOT EXISTS usage_meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

/**
 * Insert one record. Returns true when a row was written, false when the
 * dedup_key collided (replayed backfill, or a live write of the same message).
 */
export function recordUsage(db: DatabaseSync, rec: UsageRecordInput): boolean {
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO usage_records
         (ts, session_id, model, provider, source, purpose,
          input, output, cache_read, cache_write, dedup_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      rec.ts,
      rec.sessionId,
      rec.model,
      rec.provider,
      rec.source,
      rec.purpose,
      rec.input,
      rec.output,
      rec.cacheRead,
      rec.cacheWrite,
      rec.dedupKey,
    );
  // node:sqlite's run() returns { changes, lastInsertRowid }: 1 = inserted,
  // 0 = ignored. Callers use this instead of a COUNT(*) per row (which is O(n^2)
  // across a backfill).
  return result.changes === 1;
}

const RANGE_DAYS: Record<Exclude<UsageRange, "all">, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

/**
 * Cache hit rate = cache read ÷ prompt tokens.
 *
 * Returns null when the provider reports no cache at all (local models, some
 * OpenAI-compatible endpoints) — rendering that as 0% would read as "cache
 * always missed".
 */
export function computeHitRate(
  input: number,
  cacheRead: number,
  cacheWrite: number,
): number | null {
  if (cacheRead === 0 && cacheWrite === 0) return null;
  const promptTotal = input + cacheRead + cacheWrite;
  if (promptTotal <= 0) return null;
  return (cacheRead / promptTotal) * 100;
}

function rangeCutoff(range: UsageRange, now: number): number {
  if (range === "all") return 0;
  return now - RANGE_DAYS[range] * 86_400_000;
}

interface RawAgg {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  calls: number;
}

function toHitRate(row: RawAgg): number | null {
  return computeHitRate(row.input, row.cacheRead, row.cacheWrite);
}

/**
 * Aggregate usage.
 *
 * totals / byModel follow the requested range; byDay and byHour are always
 * all-time, because the heatmaps are the long view — scoping them to "7 days"
 * would blank out a 26-week grid and hide the pattern they exist to show.
 */
export function queryUsage(
  db: DatabaseSync,
  range: UsageRange,
  now: number,
): UsageSnapshot {
  const cutoff = rangeCutoff(range, now);

  const totalsRow = db
    .prepare(
      `SELECT COALESCE(SUM(input),0) AS input,
              COALESCE(SUM(output),0) AS output,
              COALESCE(SUM(cache_read),0) AS cacheRead,
              COALESCE(SUM(cache_write),0) AS cacheWrite,
              COUNT(*) AS calls
         FROM usage_records
        WHERE ts >= ?`,
    )
    .get(cutoff) as unknown as RawAgg;

  const byDay = (
    db
      .prepare(
        `SELECT date(ts / 1000, 'unixepoch', 'localtime') AS date,
                COALESCE(SUM(input),0) AS input,
                COALESCE(SUM(output),0) AS output,
                COALESCE(SUM(cache_read),0) AS cacheRead,
                COALESCE(SUM(cache_write),0) AS cacheWrite,
                COUNT(*) AS calls
           FROM usage_records
          GROUP BY date
          ORDER BY date ASC`,
      )
      .all() as unknown as Array<RawAgg & { date: string }>
  ).map<UsageDayRow>((row) => ({
    date: row.date,
    input: row.input,
    output: row.output,
    cacheRead: row.cacheRead,
    calls: row.calls,
    hitRate: toHitRate(row),
  }));

  const byHour = db
    .prepare(
      `SELECT CAST(strftime('%w', ts / 1000, 'unixepoch', 'localtime') AS INTEGER) AS weekday,
              CAST(strftime('%H', ts / 1000, 'unixepoch', 'localtime') AS INTEGER) AS hour,
              COALESCE(SUM(output),0) AS output
         FROM usage_records
        GROUP BY weekday, hour
        ORDER BY weekday ASC, hour ASC`,
    )
    .all() as unknown as UsageHourRow[];

  const byModel = (
    db
      .prepare(
        `SELECT model,
                provider,
                COALESCE(SUM(input),0) AS input,
                COALESCE(SUM(output),0) AS output,
                COALESCE(SUM(cache_read),0) AS cacheRead,
                COALESCE(SUM(cache_write),0) AS cacheWrite,
                COUNT(*) AS calls
           FROM usage_records
          WHERE ts >= ?
          GROUP BY model, provider
          ORDER BY output DESC`,
      )
      .all(cutoff) as unknown as Array<
      RawAgg & { model: string | null; provider: string | null }
    >
  ).map<UsageModelRow>((row) => ({
    model: row.model,
    provider: row.provider,
    input: row.input,
    output: row.output,
    cacheRead: row.cacheRead,
    calls: row.calls,
    hitRate: toHitRate(row),
  }));

  const totals: UsageTotals = {
    input: totalsRow.input,
    output: totalsRow.output,
    cacheRead: totalsRow.cacheRead,
    cacheWrite: totalsRow.cacheWrite,
    calls: totalsRow.calls,
    hitRate: toHitRate(totalsRow),
  };

  return { totals, byDay, byHour, byModel };
}
