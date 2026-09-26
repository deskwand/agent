/**
 * Storage for local usage records: schema, append-only writer, aggregation.
 *
 * Only depends on node:sqlite's DatabaseSync (no Electron), so every unit test
 * runs against `new DatabaseSync(":memory:")`.
 *
 * Cost is priced per record via `usage-cost.ts` (pi-ai price table plus
 * deskwand's own override / peak-plan tables), never from a
 * provider-reported `Usage.cost` — see
 * design-docs/2026-09-25-deepseek-peak-pricing-design.md.
 */

import type { DatabaseSync } from "node:sqlite";
import {
  aggregateCosts,
  loadPriceIndex,
  providerModelKey,
  type PriceIndex,
  type UsageCostRow,
} from "./usage-cost";
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
    -- One row per session file whose usage rows have been fully imported. Keyed
    -- by a path relative to the sessions root so the fingerprint survives a
    -- userData move.
    CREATE TABLE IF NOT EXISTS usage_scan_files (
      path           TEXT PRIMARY KEY,
      mtime          INTEGER NOT NULL,
      size           INTEGER NOT NULL,
      parser_version INTEGER NOT NULL
    );
    -- 子代理回填的指纹表。**不共用 usage_scan_files**：主回填的 pruneScanRows()
    -- 会把不在它自己遍历结果里的行删掉，共用就会让子代理扫描每轮重读全部文件，
    -- 静默地把指纹短路废掉（design §8：2.1s → 35ms）。
    CREATE TABLE IF NOT EXISTS usage_scan_subagent_files (
      path           TEXT PRIMARY KEY,
      mtime          INTEGER NOT NULL,
      size           INTEGER NOT NULL,
      parser_version INTEGER NOT NULL
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
  "1d": 1,
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

/**
 * Range start: local midnight of (today − (N−1)).
 *
 * Deliberately not `now − N × 86_400_000`. That rolling window is timezone-blind
 * and, across a DST transition, lands on a non-midnight local clock time —
 * measured in America/New_York, a 7-day start drifts to 13:00 / 11:00. Keeping
 * the boundary on local midnight is also what lets the cards reconcile with the
 * heatmap, whose rows are grouped by local calendar date.
 */
function rangeCutoff(range: UsageRange, now: number): number {
  if (range === "all") return 0;
  const start = new Date(now);
  // Shift the day FIRST, then snap to midnight. Reversed (snap then shift) is
  // wrong in zones whose DST transition happens at 00:00 (America/Santiago):
  // today's midnight does not exist, so the snap resolves forward to 01:00 and
  // the day shift carries that 01:00 onto a day where 00:00 DOES exist,
  // silently dropping the first hour of real records (verified: the start
  // became Aug 31 01:00 instead of Aug 31 00:00).
  start.setDate(start.getDate() - (RANGE_DAYS[range] - 1));
  start.setHours(0, 0, 0, 0);
  return start.getTime();
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
 *
 * Cost is priced per record by `usage-cost.ts` and merged in here; the SQL
 * aggregation above is untouched.
 */
export function queryUsage(
  db: DatabaseSync,
  range: UsageRange,
  now: number,
  priceIndex: PriceIndex = loadPriceIndex(),
): UsageSnapshot {
  const cutoff = rangeCutoff(range, now);

  // 一次全量扫描逐条定价：byDay 是全部区间，所以这里不能加 WHERE，也不能按
  // (model, provider) 先聚合再套价（分档按单次请求判定，聚合套价实测偏差 +64%）。
  const costs = aggregateCosts(loadUsageRows(db), cutoff, priceIndex);

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
    cost: costs.byDay.get(row.date) ?? 0,
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
    cost: costs.byModel.get(providerModelKey(row.provider, row.model)) ?? null,
  }));

  const totals: UsageTotals = {
    input: totalsRow.input,
    output: totalsRow.output,
    cacheRead: totalsRow.cacheRead,
    cacheWrite: totalsRow.cacheWrite,
    calls: totalsRow.calls,
    hitRate: toHitRate(totalsRow),
    cost: costs.total,
  };

  return { totals, byDay, byHour, byModel };
}

/**
 * 一次全量取数，供热力图与成本归集。没有 WHERE：`byDay` 恒为全部区间。
 * 实测 75.6k 行 = 152ms 取数 + 35ms 定价，而同一函数里的 SQL 聚合只有毫秒级。
 */
export function loadUsageRows(db: DatabaseSync): UsageCostRow[] {
  return db
    .prepare(
      `SELECT ts,
              provider,
              model,
              input,
              output,
              cache_read AS cacheRead,
              cache_write AS cacheWrite
         FROM usage_records`,
    )
    .all() as unknown as UsageCostRow[];
}

/**
 * 一次性迁移：删掉旧的池化子代理行（`dedup_key LIKE 'sub:%'`）。
 *
 * 旧行的身份是"承载这次 drain 的那次工具调用"，池是全局的，所以归属粒度与模型都拿不到；
 * 新的子会话文件来源用 `submsg:` 前缀，两者不会互相覆盖 —— 不删就是同一笔花费被记两次。
 *
 * 每次 app 启动跑一次即可：删完就永远是 0 行，无新状态、无 schema 变更。
 */
export function removePooledSubagentRows(db: DatabaseSync): number {
  const result = db
    .prepare("DELETE FROM usage_records WHERE dedup_key LIKE 'sub:%'")
    .run();
  return Number(result.changes);
}
