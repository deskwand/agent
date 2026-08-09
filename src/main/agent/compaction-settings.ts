/**
 * Window-size-scaled compaction settings for manual compaction of
 * cold-restored sessions (no in-memory pi session exists).
 *
 * Tiers mirror the inline logic in AgentRunner.runAgent (auto-compaction):
 * < 16K disabled, 16K-64K (25% reserve), 64K-256K (20%), >= 256K (15%).
 * Keep both in sync when changing tiers.
 */
export interface CompactionSettings {
  enabled: boolean;
  reserveTokens?: number;
  keepRecentTokens?: number;
}

export function resolveCompactionSettingsForWindow(
  contextWindow: number,
): CompactionSettings {
  if (contextWindow < 16384) {
    // Tiny window: disable compaction (weak models produce unreliable
    // summaries and may not have enough capacity for the summarization call).
    return { enabled: false };
  }
  if (contextWindow < 65536) {
    // Small window: reserve 25% as headroom, keep 30% of recent history.
    return {
      enabled: true,
      reserveTokens: Math.floor(contextWindow * 0.25),
      keepRecentTokens: Math.floor(contextWindow * 0.3),
    };
  }
  if (contextWindow < 262144) {
    // Medium window (64K-256K): reserve 20%, keep 25% recent history.
    return {
      enabled: true,
      reserveTokens: Math.floor(contextWindow * 0.2),
      keepRecentTokens: Math.floor(contextWindow * 0.25),
    };
  }
  // Large window (256K+): reserve 15%, keep 20% recent history.
  return {
    enabled: true,
    reserveTokens: Math.floor(contextWindow * 0.15),
    keepRecentTokens: Math.floor(contextWindow * 0.2),
  };
}
