/**
 * Maps one model call onto one usage record.
 *
 * Pure functions (no database, `now` passed in explicitly) so the three write
 * paths can be covered by real assertions instead of source-string checks.
 */

import type { TokenUsage } from "../../renderer/types";
import type { UsagePurpose, UsageRecordInput } from "../../shared/usage";

/**
 * Chat: the key is derived from the message itself, not from the session.
 *
 * Forking copies entries verbatim into a new session directory (same
 * message.timestamp, same usage),so a session-scoped key would book every
 * forked prefix a second time. Timestamp + the exact usage tuple identifies the
 * call across both sessions; two *different* calls sharing a millisecond and an
 * identical token tuple do not happen in practice.
 */
export function buildChatUsageRecord(
  sessionId: string,
  message: { timestamp?: unknown; provider?: unknown; model?: unknown },
  fallback: { provider?: string | null; model?: string | null },
  usage: TokenUsage,
  now: number,
): UsageRecordInput {
  const ts = typeof message.timestamp === "number" ? message.timestamp : now;
  const cacheRead = usage.cacheRead ?? 0;
  const cacheWrite = usage.cacheWrite ?? 0;
  return {
    ts,
    sessionId,
    model:
      typeof message.model === "string"
        ? message.model
        : (fallback.model ?? null),
    provider:
      typeof message.provider === "string"
        ? message.provider
        : (fallback.provider ?? null),
    source: "chat",
    purpose: null,
    dedupKey: `chat:${ts}:${usage.input}:${usage.output}:${cacheRead}:${cacheWrite}`,
    input: usage.input,
    output: usage.output,
    cacheRead,
    cacheWrite,
  };
}

/**
 * Subagent: key = sub:<sessionId>:<toolCallId>.
 *
 * model stays NULL — pi-subagents' LifetimeUsage carries no model, so a
 * multi-model subagent run collapses into one number; the query layer shows it
 * as a separate "subagents (all models combined)" row instead of polluting the
 * per-model breakdown.
 */
export function buildSubagentUsageRecord(
  sessionId: string,
  toolCallId: string,
  rawUsage: unknown,
  ts: number,
): UsageRecordInput | null {
  if (!rawUsage || typeof rawUsage !== "object") return null;
  const raw = rawUsage as {
    input?: unknown;
    output?: unknown;
    cacheRead?: unknown;
    cacheWrite?: unknown;
  };
  const num = (value: unknown): number =>
    typeof value === "number" && value >= 0 ? Math.floor(value) : 0;
  return {
    ts,
    sessionId,
    model: null,
    provider: null,
    source: "subagent",
    purpose: null,
    dedupKey: `sub:${sessionId}:${toolCallId}`,
    input: num(raw.input),
    output: num(raw.output),
    cacheRead: num(raw.cacheRead),
    cacheWrite: num(raw.cacheWrite),
  };
}

/** Aux calls have no backfill path, so dedupKey stays NULL. */
export function buildAuxUsageRecord(
  usage: TokenUsage,
  purpose: UsagePurpose,
  model: string,
  provider: string,
  sessionId: string | null,
  ts: number,
): UsageRecordInput {
  return {
    ts,
    sessionId,
    model,
    provider,
    source: "aux",
    purpose,
    dedupKey: null,
    input: usage.input,
    output: usage.output,
    cacheRead: usage.cacheRead ?? 0,
    cacheWrite: usage.cacheWrite ?? 0,
  };
}
