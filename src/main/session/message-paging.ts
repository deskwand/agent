// Message paging helpers for session history windows.
// Kept free of the heavy session-manager import chain so unit tests
// can load this module directly.
import type { Message } from "../../renderer/types";

/**
 * Slice the in-memory message cache (ascending order) for paging.
 * Returns null when `beforeId` is not found in the cache — callers
 * must fall back to the database in that case.
 *
 * The slice start is extended backward until it begins at a user
 * message and contains at least two user messages, mirroring the
 * DB-side turn alignment in queryMessagesPage: without it, a page
 * that starts mid-turn can land the render window on turn index 0
 * and stall the loading spinner (agent sessions can run hundreds of
 * tool messages between user prompts).
 */
export function sliceCachedPage(
  cached: Message[],
  beforeId: string | null,
  limit: number,
): { messages: Message[]; hasMore: boolean } | null {
  if (cached.length === 0) return { messages: [], hasMore: false };
  if (beforeId === null) {
    let start = Math.max(0, cached.length - limit);
    start = alignSliceStart(cached, start, cached.length);
    return {
      messages: cached.slice(start),
      hasMore: start > 0,
    };
  }
  const cursorIdx = cached.findIndex((m) => m.id === beforeId);
  if (cursorIdx === -1) return null;
  let start = Math.max(0, cursorIdx - limit);
  start = alignSliceStart(cached, start, cursorIdx);
  const messages = cached.slice(start, cursorIdx);
  return { messages, hasMore: start > 0 };
}

/** Walk the slice start backward until it lands on a user message with ≥2 users in range. */
function alignSliceStart(
  cached: Message[],
  start: number,
  end: number,
): number {
  while (start > 0) {
    const slice = cached.slice(start, end);
    if (
      slice.length > 0 &&
      slice[0].role === "user" &&
      slice.filter((m) => m.role === "user").length >= 2
    ) {
      break;
    }
    start -= 1;
  }
  return start;
}
