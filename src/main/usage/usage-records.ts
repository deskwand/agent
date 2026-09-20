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

/**
 * 子代理：一条 assistant 消息一行，身份取自**子会话文件**。
 *
 * 与旧的池化记录（`tool_result.usage`，只有 token 合计、按设计无 model）不同，
 * 子会话 JSONL 里每条 assistant 消息都带 provider/model，所以这里能填上模型。
 * `sessionId` 存**父会话**（与主对话行同一维度，便于按会话追溯），子会话 id 只进
 * dedup key；键前缀 `submsg:` 与旧池化键 `sub:` 分开，避免迁移清理误删新行。
 */
export function buildSubagentMessageRecord(
  parentSessionId: string,
  childSessionId: string,
  entryId: string,
  message: { timestamp?: unknown; provider?: unknown; model?: unknown },
  usage: TokenUsage,
  now: number,
): UsageRecordInput {
  const ts = typeof message.timestamp === "number" ? message.timestamp : now;
  return {
    ts,
    sessionId: parentSessionId,
    model: typeof message.model === "string" ? message.model : null,
    provider: typeof message.provider === "string" ? message.provider : null,
    source: "subagent",
    purpose: null,
    dedupKey: `submsg:${childSessionId}:${entryId}`,
    input: usage.input,
    output: usage.output,
    cacheRead: usage.cacheRead ?? 0,
    cacheWrite: usage.cacheWrite ?? 0,
  };
}
