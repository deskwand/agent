import type { StoredWebAccessResult } from "./types";

const CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_RESPONSES_PER_SESSION = 20;

export type WebAccessCacheLookup =
  | { status: "hit"; result: StoredWebAccessResult }
  | { status: "miss" }
  | { status: "expired" };

export class WebAccessCache {
  private readonly sessions = new Map<
    string,
    Map<string, StoredWebAccessResult>
  >();

  constructor(private readonly now: () => number = Date.now) {}

  set(sessionId: string, result: StoredWebAccessResult): void {
    const session = this.sessions.get(sessionId) ?? new Map();
    this.removeExpired(session);

    while (session.size >= MAX_RESPONSES_PER_SESSION) {
      const oldest = Array.from(session.values()).reduce((left, right) =>
        left.timestamp <= right.timestamp ? left : right,
      );
      session.delete(oldest.id);
    }

    session.set(result.id, result);
    this.sessions.set(sessionId, session);
  }

  lookup(sessionId: string, responseId: string): WebAccessCacheLookup {
    const session = this.sessions.get(sessionId);
    if (!session) return { status: "miss" };

    const result = session.get(responseId);
    if (result && result.timestamp < this.now() - CACHE_TTL_MS) {
      session.delete(responseId);
      this.removeExpired(session);
      if (session.size === 0) this.sessions.delete(sessionId);
      return { status: "expired" };
    }

    this.removeExpired(session);
    if (session.size === 0) this.sessions.delete(sessionId);
    return result ? { status: "hit", result } : { status: "miss" };
  }

  get(sessionId: string, responseId: string): StoredWebAccessResult | null {
    const lookup = this.lookup(sessionId, responseId);
    return lookup.status === "hit" ? lookup.result : null;
  }

  clearSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  private removeExpired(session: Map<string, StoredWebAccessResult>): void {
    const cutoff = this.now() - CACHE_TTL_MS;
    for (const [id, result] of session) {
      if (result.timestamp < cutoff) session.delete(id);
    }
  }
}

export const webAccessCache = new WebAccessCache();
