/**
 * Usage statistics contract shared by the main process and the renderer.
 *
 * Types are defined here exactly once: the usage store imports them, and the
 * renderer imports them via `../../shared/usage`.
 */

export type UsageSource = "chat" | "subagent" | "aux";
export type UsagePurpose = "title" | "memory" | "vision" | "probe";
export type UsageRange = "1d" | "7d" | "30d" | "90d" | "all";

export interface UsageTokens {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface UsageRecordInput extends UsageTokens {
  /** Epoch ms of the call. Chat rows must use the SDK assistant message timestamp. */
  ts: number;
  sessionId: string | null;
  /** NULL = subagent bucket (usage is aggregated across models, so it cannot be split). */
  model: string | null;
  provider: string | null;
  source: UsageSource;
  purpose: UsagePurpose | null;
  /** Only sources with a backfill path (chat / subagent) carry a key; aux rows pass NULL. */
  dedupKey: string | null;
}

export interface UsageTotals extends UsageTokens {
  calls: number;
  hitRate: number | null;
  /** 区间内折算金额（USD），按 pi-ai 价目表算，是参考值不是账单。 */
  cost: number;
}

export interface UsageDayRow {
  date: string;
  input: number;
  output: number;
  cacheRead: number;
  calls: number;
  hitRate: number | null;
  /** 该日折算金额；恒为全部区间（热力图不随区间变）。 */
  cost: number;
}

export interface UsageHourRow {
  /** 0 = Sunday … 6 = Saturday, matching Date.getDay(). */
  weekday: number;
  hour: number;
  output: number;
}

export interface UsageModelRow {
  model: string | null;
  provider: string | null;
  input: number;
  output: number;
  cacheRead: number;
  calls: number;
  hitRate: number | null;
  /** null = 该模型没有价目（含子代理行 model IS NULL）。 */
  cost: number | null;
}

export interface UsageSnapshot {
  totals: UsageTotals;
  /** Always all-time — the calendar heatmap must not move with the range. */
  byDay: UsageDayRow[];
  byHour: UsageHourRow[];
  /** Scoped to the requested range. */
  byModel: UsageModelRow[];
}

/** 页面默认区间；也是 IPC 收到非法 range 时的回落值。 */
export const DEFAULT_USAGE_RANGE: UsageRange = "1d";
