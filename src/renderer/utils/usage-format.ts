import type { UsageDayRow, UsageModelRow } from "../../shared/usage";

/** Pure formatting / bucketing helpers for the usage view (no React, no state). */

export function compactNumber(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/** null = the provider reports no cache at all, so show a dash rather than 0%. */
export function formatHitRate(rate: number | null): string {
  return rate === null ? "—" : `${rate.toFixed(1)}%`;
}

/** Volume heat scale: 0 = no record, 1..4 by quantile. */
export function bucketVolume(value: number, allValues: number[]): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 1;
  const sorted = [...allValues].filter((v) => v > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return 1;
  const index = sorted.findIndex((v) => v >= value);
  const percentile = (index < 0 ? sorted.length - 1 : index) / sorted.length;
  if (percentile < 0.25) return 1;
  if (percentile < 0.5) return 2;
  if (percentile < 0.75) return 3;
  return 4;
}

/** Semantic bands for the hit-rate heat scale (mirrored by the UI legend). */
export const HIT_RATE_BANDS = [
  { max: 90, label: "<90%" },
  { max: 95, label: "90–95%" },
  { max: 97, label: "95–97%" },
  { max: 99, label: "97–99%" },
  { max: Number.POSITIVE_INFINITY, label: "≥99%" },
] as const;

/**
 * Hit-rate swatch level, 1..5 (band index + 1).
 *
 * Deliberately 1-based: level 0 is reserved for "no record", so the worst band
 * (<90%) renders as a warning colour instead of disappearing into the empty
 * swatch.
 */
export function bucketHitRate(rate: number): number {
  for (let i = 0; i < HIT_RATE_BANDS.length; i += 1) {
    if (rate < HIT_RATE_BANDS[i].max) return i + 1;
  }
  return HIT_RATE_BANDS.length;
}

/**
 * Swatch level for one heatmap cell.
 *
 * 0 means "no record" and is the only value the components render as empty; a
 * day whose provider reports no cache (hitRate null) also maps to 0 rather than
 * claiming a 0% hit rate.
 */
export function resolveCellLevel(
  row: UsageDayRow | undefined,
  mode: "usage" | "hit" | "cost",
  allValues: number[],
): number {
  if (!row) return 0;
  if (mode === "usage") {
    return bucketVolume(row.input + row.output + row.cacheRead, allValues);
  }
  if (mode === "cost") {
    // 与用量模式同一套分位数切档，只是输入换成当日金额
    return bucketVolume(row.cost, allValues);
  }
  if (row.hitRate === null || row.hitRate === undefined) return 0;
  return bucketHitRate(row.hitRate);
}

/**
 * 参考金额。六档，专门防止"小于 1 分的真实成本被显示成 $0.00"这种静默归零。
 * null = 无价目（`—`）；负数 = 上游脏数据，同样按不可用处理。
 *
 * 分组阈值按**四舍五入后**的值判：否则 999.996 会走 toFixed(2) 分支输出 `$1000.00`，
 * 而 1000 输出 `$1,000` —— 同一个表里两个数看着像 bug。
 */
export function formatCost(cost: number | null): string {
  if (cost === null || !Number.isFinite(cost) || cost < 0) return "—";
  if (cost === 0) return "$0";
  if (cost < 0.001) return "<$0.001";
  if (cost < 1) return `$${cost.toFixed(4)}`;
  const cents = Math.round(cost * 100) / 100;
  if (cents < 1000) return `$${cents.toFixed(2)}`;
  // 金额一律美元，分组符号固定用 en-US；跟随 UI 语言会让 zh 下变成 `US$1,235`，
  // 与同一函数里的 `$` 前缀自相矛盾
  return `$${Math.round(cents).toLocaleString("en-US")}`;
}

/**
 * 区间内无价目的调用数。不单独走一个契约字段：`byModel` 与 `totals` 同一个区间，
 * 把 cost 为 null 的行的 calls 加起来就是它。
 */
export function sumUnpricedCalls(rows: UsageModelRow[]): number {
  return rows.reduce(
    (sum, row) => sum + (row.cost === null ? row.calls : 0),
    0,
  );
}
