/**
 * @module renderer/slash-recency
 *
 * "Most recently used" ordering for the / slash menu. Recency data lives in
 * localStorage (key `slashRecency`, value Record<itemKey, timestamp>),
 * keyed by `cmd:<name>` for commands and `skill:<name>` for skills.
 */

const SLASH_RECENCY_KEY = "slashRecency";
const SLASH_RECENCY_MAX = 20;

/** Read recent slash usage from localStorage. Returns {} on any error. */
export function loadSlashRecency(): Record<string, number> {
  try {
    const raw = localStorage.getItem(SLASH_RECENCY_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      return {};
    return parsed as Record<string, number>;
  } catch {
    return {};
  }
}

/** Write/update a recency entry, trim to newest SLASH_RECENCY_MAX. Failures are silent. */
export function saveSlashRecency(key: string): void {
  try {
    const recency = loadSlashRecency();
    recency[key] = Date.now();
    const entries = Object.entries(recency)
      .sort((a, b) => b[1] - a[1])
      .slice(0, SLASH_RECENCY_MAX);
    localStorage.setItem(
      SLASH_RECENCY_KEY,
      JSON.stringify(Object.fromEntries(entries)),
    );
  } catch {
    /* localStorage full or disabled — silently ignore */
  }
}

/** Sort items: those present in recency first (by desc timestamp), rest unchanged. */
export function sortByRecency<T>(
  items: T[],
  getKey: (item: T) => string,
  recency: Record<string, number>,
): T[] {
  const withRecency: T[] = [];
  const withoutRecency: T[] = [];
  for (const item of items) {
    if (recency[getKey(item)] != null) {
      withRecency.push(item);
    } else {
      withoutRecency.push(item);
    }
  }
  withRecency.sort(
    (a, b) => (recency[getKey(b)] ?? 0) - (recency[getKey(a)] ?? 0),
  );
  return withRecency.concat(withoutRecency);
}
