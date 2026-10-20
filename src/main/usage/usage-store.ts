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

import type { DatabaseSync, StatementSync } from "node:sqlite";
import {
  aggregateCosts,
  bucketOf,
  costOfBucket,
  isBucketResolvable,
  loadPriceIndex,
  localDateKey,
  providerModelKey,
  type PriceIndex,
  type UsageBucket,
  type UsageCostRow,
} from "./usage-cost";
import type {
  UsageDayRow,
  UsageHourRow,
  UsageModelRow,
  UsageRange,
  UsageRecordInput,
  UsageSnapshot,
  UsageTokens,
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
    -- 页面用量的唯一读取源。颗粒度 = 能精确重建定价的最小集合：日期 × 模型 × 峰谷 ×
    -- 档位。桶内的记录共享同一套费率，所以"先累加 token 再套价"与逐条套价精确相等。
    CREATE TABLE IF NOT EXISTS usage_daily (
      day         TEXT    NOT NULL,
      provider    TEXT    NOT NULL,
      model       TEXT    NOT NULL,
      peak        INTEGER NOT NULL,
      tier        INTEGER NOT NULL,
      input       INTEGER NOT NULL DEFAULT 0,
      output      INTEGER NOT NULL DEFAULT 0,
      cache_read  INTEGER NOT NULL DEFAULT 0,
      cache_write INTEGER NOT NULL DEFAULT 0,
      calls       INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, provider, model, peak, tier)
    ) WITHOUT ROWID;
    -- 全时段「周几 × 小时」热力图。它只消费 output，就聚合到正好这么多（≤168 行）。
    CREATE TABLE IF NOT EXISTS usage_hour (
      weekday INTEGER NOT NULL,
      hour    INTEGER NOT NULL,
      output  INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (weekday, hour)
    ) WITHOUT ROWID;
    -- 聚合表的水位。只建表，**绝不种行**：种了就等于声称"聚合已完整"，而实际是空表，
    -- 页面会读到全零。只在一次完整重建的末尾写入。
    CREATE TABLE IF NOT EXISTS usage_rollup_state (
      id             INTEGER PRIMARY KEY CHECK (id = 1),
      rollup_version INTEGER NOT NULL,
      built_at       INTEGER NOT NULL
    );
  `);
}

/**
 * Insert one record. Returns true when a row was written, false when the
 * dedup_key collided (replayed backfill, or a live write of the same message).
 */
export function recordUsage(db: DatabaseSync, rec: UsageRecordInput): boolean {
  // SAVEPOINT 而不是 BEGIN：回填路径已经在 BEGIN/COMMIT 里调用本函数，而 SQLite 不
  // 允许嵌套事务；SAVEPOINT 在有无外层事务两种情况下都合法，于是"原始行 + 聚合行"
  // 在任何调用点都是原子的。崩在两条语句之间 = 永久且静默的少报。
  //
  // 刻意放在 try **之外**：若这一步本身就失败（库被关掉/损坏），下面那个 catch 里的
  // `ROLLBACK TO record_usage` 会抛 "no such savepoint" 把真实原因盖掉。
  //
  // 原子性的代价要说清：聚合写入失败现在会把原始行一起回滚，也就是**这一次调用整笔
  // 丢失**（调用方 logWarn 后继续），而不是"原始行留下、聚合少一笔"。两害相权取其轻：
  // 少一笔会在下次启动被完整性校验抓到并重建，而"原始行与聚合脱节"是静默的。
  db.exec("SAVEPOINT record_usage");
  try {
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
    if (result.changes !== 1) {
      db.exec("RELEASE record_usage");
      return false;
    }
    // 重建进行中（state 行被删）时只插原始行：否则这条写入会既进聚合表、又被重建
    // 末尾的尾巴重放计一次，变成重复计数。跳过的行正好等于 `id > maxId` 的集合。
    // 闸门直接复用不变量——**state 行存在 ⟺ 聚合完整**（重建第一步删它、最后一步
    // 写回），所以不需要模块级标志，也就没有"标志忘了复位"这种状态。
    if (readRollupState(db)) {
      addToRollup(
        prepareRollupStatements(db),
        rec,
        bucketOf(loadPriceIndex(), rec),
      );
    }
    db.exec("RELEASE record_usage");
    return true;
  } catch (error) {
    db.exec("ROLLBACK TO record_usage");
    db.exec("RELEASE record_usage");
    throw error;
  }
}

/** 聚合写入用的两条语句。重建时一次 prepare、每行复用；实时路径每次调用现 prepare。 */
interface RollupStatements {
  daily: StatementSync;
  hour: StatementSync;
}

function prepareRollupStatements(db: DatabaseSync): RollupStatements {
  return {
    daily: db.prepare(
      `INSERT INTO usage_daily
         (day, provider, model, peak, tier,
          input, output, cache_read, cache_write, calls)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
       ON CONFLICT (day, provider, model, peak, tier) DO UPDATE SET
         input       = input + excluded.input,
         output      = output + excluded.output,
         cache_read  = cache_read + excluded.cache_read,
         cache_write = cache_write + excluded.cache_write,
         calls       = calls + 1`,
    ),
    hour: db.prepare(
      `INSERT INTO usage_hour (weekday, hour, output)
       VALUES (?, ?, ?)
       ON CONFLICT (weekday, hour) DO UPDATE SET output = output + excluded.output`,
    ),
  };
}

/**
 * 把一条记录并入日 / 周几×小时聚合。
 *
 * 只存 token，**绝不存金额**：定价永远发生在读取时，所以改费率不需要重建。
 *
 * 收已 prepare 的语句而不是自己 prepare：node:sqlite 不缓存语句，每次 prepare 都是
 * 一次完整的 SQL 解析（实测 ~10µs）。重建要跑 145k 行，逐行 prepare 让一次重建从
 * 秒级变成 3.5s —— 与取数（137ms）完全不成比例。
 */
function addToRollup(
  stmts: RollupStatements,
  source: {
    ts: number;
    provider: string | null;
    model: string | null;
  } & UsageTokens,
  bucket: UsageBucket,
): void {
  stmts.daily.run(
    localDateKey(source.ts),
    source.provider ?? "",
    source.model ?? "",
    bucket.peak,
    bucket.tier,
    source.input,
    source.output,
    source.cacheRead,
    source.cacheWrite,
  );

  const at = new Date(source.ts);
  stmts.hour.run(at.getDay(), at.getHours(), source.output);
}

/** 聚合表的水位；null = 从未建成，或**正在重建**（重建的第一步就是删掉它）。 */
export function readRollupState(
  db: DatabaseSync,
): { rollupVersion: number; builtAt: number } | null {
  const row = db
    .prepare(
      `SELECT rollup_version AS rollupVersion, built_at AS builtAt
         FROM usage_rollup_state WHERE id = 1`,
    )
    .get() as unknown as { rollupVersion: number; builtAt: number } | undefined;
  return row ?? null;
}

/**
 * 聚合表的失效版本号。**改了桶语义、或改了价目表的"形状"（加/删档位、增删计划、
 * 改峰谷时段常量）就必须 +1**，否则历史桶会按错误档位计价，而运行时检查抓不到
 * （`tier = -1` 永远解析得到）。纯改费率不需要 bump —— 定价发生在读取时。
 *
 * 与 BACKFILL_PARSER_VERSION 同一模式：bump 一下 = 下一次启动重建一次。
 */
export const ROLLUP_VERSION = 1;

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
export function queryUsageFromRecords(
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

interface RollupRow {
  day: string;
  provider: string;
  model: string;
  peak: number;
  tier: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  calls: number;
}

/** byDay 的累加器。cacheWrite 进不了 UsageDayRow，但算 hitRate 必须要它。 */
interface DayAccumulator {
  date: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  calls: number;
  cost: number;
}

/**
 * 聚合表的读取路径：只扫聚合行（本机 357 行），逐桶定价。
 *
 * 一次遍历同时算出三样：totals / byModel 按区间过滤，byDay 恒为全时段（热力图是
 * 长期视图，不能随区间变）。之所以一次遍历就够，是因为 `rangeCutoff()` 的目标恒为
 * **本地午夜**，而聚合的颗粒度就是本地日 —— 按日过滤与按 ts 过滤精确等价。
 */
export function queryUsageFromRollup(
  db: DatabaseSync,
  range: UsageRange,
  now: number,
  priceIndex: PriceIndex = loadPriceIndex(),
): UsageSnapshot {
  const rows = db
    .prepare(
      `SELECT day, provider, model, peak, tier, input, output,
              cache_read AS cacheRead, cache_write AS cacheWrite, calls
         FROM usage_daily`,
    )
    .all() as unknown as RollupRow[];

  const cutoffDay =
    range === "all" ? "" : localDateKey(rangeCutoff(range, now));

  const dayTotals = new Map<string, DayAccumulator>();
  const modelTokens = new Map<
    string,
    { provider: string | null; model: string | null } & UsageTokens & {
        calls: number;
      }
  >();
  const modelCost = new Map<string, number>();
  const totals = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    calls: 0,
    cost: 0,
  };

  for (const row of rows) {
    const tokens: UsageTokens = {
      input: row.input,
      output: row.output,
      cacheRead: row.cacheRead,
      cacheWrite: row.cacheWrite,
    };
    const cost = costOfBucket(
      priceIndex,
      {
        provider: row.provider || null,
        model: row.model || null,
        peak: row.peak === 1 ? 1 : 0,
        tier: row.tier,
      },
      tokens,
    );

    // byDay：全时段
    const day = dayTotals.get(row.day) ?? {
      date: row.day,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      calls: 0,
      cost: 0,
    };
    day.input += row.input;
    day.output += row.output;
    day.cacheRead += row.cacheRead;
    day.cacheWrite += row.cacheWrite;
    day.calls += row.calls;
    if (cost !== null) day.cost += cost;
    dayTotals.set(row.day, day);

    if (cutoffDay && row.day < cutoffDay) continue;

    totals.input += row.input;
    totals.output += row.output;
    totals.cacheRead += row.cacheRead;
    totals.cacheWrite += row.cacheWrite;
    totals.calls += row.calls;

    const key = providerModelKey(row.provider || null, row.model || null);
    const model = modelTokens.get(key) ?? {
      provider: row.provider || null,
      model: row.model || null,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      calls: 0,
    };
    model.input += row.input;
    model.output += row.output;
    model.cacheRead += row.cacheRead;
    model.cacheWrite += row.cacheWrite;
    model.calls += row.calls;
    modelTokens.set(key, model);

    // 与 aggregateCosts 同一口径：**有价优先**（有价行累加，全无价才是 null）
    if (cost === null) continue;
    modelCost.set(key, (modelCost.get(key) ?? 0) + cost);
    totals.cost += cost;
  }

  const byDay: UsageDayRow[] = [...dayTotals.values()]
    .map((day) => ({
      date: day.date,
      input: day.input,
      output: day.output,
      cacheRead: day.cacheRead,
      calls: day.calls,
      hitRate: computeHitRate(day.input, day.cacheRead, day.cacheWrite),
      cost: day.cost,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const byModel: UsageModelRow[] = [...modelTokens.entries()]
    .map(([key, model]) => ({
      provider: model.provider,
      model: model.model,
      input: model.input,
      output: model.output,
      cacheRead: model.cacheRead,
      calls: model.calls,
      hitRate: computeHitRate(model.input, model.cacheRead, model.cacheWrite),
      cost: modelCost.has(key) ? (modelCost.get(key) ?? null) : null,
    }))
    .sort(
      (a, b) =>
        b.output - a.output ||
        (a.provider ?? "").localeCompare(b.provider ?? "") ||
        (a.model ?? "").localeCompare(b.model ?? ""),
    );

  const byHour = db
    .prepare(
      `SELECT weekday, hour, output FROM usage_hour
        ORDER BY weekday ASC, hour ASC`,
    )
    .all() as unknown as UsageHourRow[];

  return {
    totals: {
      input: totals.input,
      output: totals.output,
      cacheRead: totals.cacheRead,
      cacheWrite: totals.cacheWrite,
      calls: totals.calls,
      hitRate: computeHitRate(
        totals.input,
        totals.cacheRead,
        totals.cacheWrite,
      ),
      cost: totals.cost,
    },
    byDay,
    byHour,
    byModel,
  };
}

/**
 * 聚合表当前能不能用。两步都按 357 行的规模设计，**刻意不做完整性校验**——
 * `COUNT(*)` 最坏 27ms，放进每次打开就是把这页的预算吃掉一半；那条校验属于启动预热。
 */
export function isRollupFresh(db: DatabaseSync, index: PriceIndex): boolean {
  const state = readRollupState(db);
  if (!state || state.rollupVersion !== ROLLUP_VERSION) return false;
  const buckets = db
    .prepare("SELECT DISTINCT provider, model, tier FROM usage_daily")
    .all() as unknown as Array<{
    provider: string;
    model: string;
    tier: number;
  }>;
  // 档位解析不到 = 价目表被改过而聚合表没重建（忘了 bump ROLLUP_VERSION）
  return buckets.every((row) =>
    isBucketResolvable(index, {
      provider: row.provider || null,
      model: row.model || null,
      peak: 0,
      tier: row.tier,
    }),
  );
}

/**
 * 用量快照入口：聚合表新鲜就走聚合路径，否则走原始路径并通知调用方去后台重建。
 *
 * 兜底**永远不阻塞这次请求**：返回的是与改动前完全相同的结果，只是慢。宁可慢一次，
 * 也不把重建塞进 IPC，更不在页面上显示一个会自己变的数字。
 */
export function queryUsage(
  db: DatabaseSync,
  range: UsageRange,
  now: number,
  priceIndex: PriceIndex = loadPriceIndex(),
  onRollupStale?: () => void,
): UsageSnapshot {
  if (isRollupFresh(db, priceIndex)) {
    return queryUsageFromRollup(db, range, now, priceIndex);
  }
  onRollupStale?.();
  return queryUsageFromRecords(db, range, now, priceIndex);
}

/** 聚合表与原始表的行数是否一致。启动预热用；**不要**放进查询路径（见 isRollupFresh）。 */
export function rollupIntegrityOk(db: DatabaseSync): boolean {
  const daily = db
    .prepare(
      "SELECT COALESCE(SUM(calls), 0) AS calls, COALESCE(SUM(output), 0) AS output FROM usage_daily",
    )
    .get() as unknown as { calls: number; output: number };
  const hour = db
    .prepare("SELECT COALESCE(SUM(output), 0) AS output FROM usage_hour")
    .get() as unknown as { output: number };
  const records = db
    .prepare("SELECT COUNT(*) AS n FROM usage_records")
    .get() as { n: number } | undefined;
  // 两条腿：行数对原始表，output 总量对**另一张聚合表**（都是几百行，代价可忽略）。
  // 后者不与原始表比 —— 那要全表扫 146k 行；两张聚合表由同一批记录维护，总量不等就是
  // 其中一张坏了（例如 usage_hour 被漏写或删掉，只查行数的版本看不见）。
  return daily.calls === (records?.n ?? 0) && hour.output === daily.output;
}

/** 重建时每页读取的记录数。分页是为了在页与页之间让出事件循环。 */
const ROLLUP_PAGE = 5000;

/**
 * 就地重建聚合表。
 *
 * 三步：① 删 state 行使聚合表失效（此后的查询全部自动走兜底路径，结果仍然正确）；
 * ② 清空 + 分页重建；③ 一个事务里补 `id > maxId` 的尾行并写回 state 行 —— 于是
 * "state 行有效 ⇒ 聚合一定完整"。中间没有影子表也不需要交换：半成品没人读。
 *
 * 崩溃/失败会留下一个无效的 state 行与半成品表，下次启动重来即可，`usage_records`
 * 全程未动。
 */
export async function rebuildUsageRollup(
  db: DatabaseSync,
  priceIndex: PriceIndex = loadPriceIndex(),
): Promise<number> {
  db.exec("DELETE FROM usage_rollup_state");
  db.exec("DELETE FROM usage_daily");
  db.exec("DELETE FROM usage_hour");

  const maxId = (
    db
      .prepare("SELECT COALESCE(MAX(id), 0) AS id FROM usage_records")
      .get() as {
      id: number;
    }
  ).id;

  const stmts = prepareRollupStatements(db);
  let merged = 0;
  let cursor = 0;
  for (;;) {
    const page = db
      .prepare(
        `SELECT id, ts, provider, model, input, output,
                cache_read AS cacheRead, cache_write AS cacheWrite
           FROM usage_records
          WHERE id > ? AND id <= ? ORDER BY id ASC LIMIT ?`,
      )
      .all(cursor, maxId, ROLLUP_PAGE) as unknown as Array<
      {
        id: number;
        ts: number;
        provider: string | null;
        model: string | null;
      } & UsageTokens
    >;
    if (page.length === 0) break;
    db.exec("BEGIN");
    try {
      for (const row of page) {
        addToRollup(stmts, row, bucketOf(priceIndex, row));
        merged += 1;
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    cursor = page[page.length - 1].id;
    // 让出事件循环：重建可能连续跑几十页，不能让主进程整段冻结
    await new Promise((resolve) => setImmediate(resolve));
  }

  // 尾行（重建期间新到的）与 state 行同事务：保证"state 有效 ⇒ 聚合完整"
  db.exec("BEGIN");
  try {
    const tail = db
      .prepare(
        `SELECT id, ts, provider, model, input, output,
                cache_read AS cacheRead, cache_write AS cacheWrite
           FROM usage_records WHERE id > ? ORDER BY id ASC`,
      )
      .all(maxId) as unknown as Array<
      {
        id: number;
        ts: number;
        provider: string | null;
        model: string | null;
      } & UsageTokens
    >;
    for (const row of tail) {
      addToRollup(stmts, row, bucketOf(priceIndex, row));
      merged += 1;
    }
    db.prepare(
      `INSERT OR REPLACE INTO usage_rollup_state (id, rollup_version, built_at)
       VALUES (1, ?, ?)`,
    ).run(ROLLUP_VERSION, Date.now());
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return merged;
}
