import type { Message } from "../types";

export interface DisplayedContextUsage {
  tokens: number | null;
  isEstimated: boolean;
}

export function resolveDisplayedContextUsage(
  exactTokens: number,
  estimatedTokens: number | null | undefined,
): DisplayedContextUsage {
  if (estimatedTokens !== undefined) {
    return { tokens: estimatedTokens, isEstimated: true };
  }
  return { tokens: exactTokens, isEstimated: false };
}

export function formatContextPercentage(value: number | string | null): string {
  return value === null ? "--" : `${value}%`;
}

export interface ContextUsage {
  tokens: number | null;
  isEstimated: boolean;
  /** 0–100；窗口未知时为 0。 */
  percentage: number;
}

export function computeContextUsage(
  exactTokens: number,
  estimatedTokens: number | null | undefined,
  contextWindow: number | undefined,
): ContextUsage {
  const displayed = resolveDisplayedContextUsage(exactTokens, estimatedTokens);
  const percentage =
    displayed.tokens !== null && contextWindow && contextWindow > 0
      ? Math.min((displayed.tokens / contextWindow) * 100, 100)
      : 0;
  return { ...displayed, percentage };
}

export type ContextUsageLevel = "default" | "warning" | "destructive";

/** 与对话区同一个阈值：>95 危险，>80 警告。 */
export function contextUsageLevel(percentage: number): ContextUsageLevel {
  if (percentage > 95) return "destructive";
  if (percentage > 80) return "warning";
  return "default";
}

export function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** 最后一条带 prompt token 的消息的 totalPromptInput；没有则 0。 */
export function findLastPromptInputTokens(messages: Message[]): number {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const value = messages[i].tokenUsage?.totalPromptInput;
    if (value && value > 0) return value;
  }
  return 0;
}
