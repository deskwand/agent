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
