import type { UsageDayRow } from "../../shared/usage";

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
  mode: "usage" | "hit",
  allValues: number[],
): number {
  if (!row) return 0;
  if (mode === "usage") {
    return bucketVolume(row.input + row.output + row.cacheRead, allValues);
  }
  if (row.hitRate === null || row.hitRate === undefined) return 0;
  return bucketHitRate(row.hitRate);
}
