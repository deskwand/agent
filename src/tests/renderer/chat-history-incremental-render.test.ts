import { describe, expect, it } from "vitest";
import type { Message } from "../../renderer/types";
import {
  buildTurnRanges,
  canLoadOlderTurns,
  didSessionHistoryScopeChange,
  getAnchoredScrollTop,
  getEffectiveVisibleTurnStart,
  getInitialVisibleTurnStart,
  getPrependedVisibleTurnStart,
  getPreviousVisibleTurnStart,
  getVisibleMessageStartIndex,
  shouldAutoFillViewport,
  shouldShowHydratingHistoryState,
  shouldInitializeVisibleTurns,
} from "../../renderer/components/ChatView";

function msg(id: string, role: Message["role"]): Message {
  return {
    id,
    sessionId: "session-1",
    role,
    content: [{ type: "text", text: id }],
    timestamp: 0,
  };
}

describe("chat history incremental render helpers", () => {
  it("groups a normal user/assistant conversation into turns", () => {
    const messages = [
      msg("u1", "user"),
      msg("a1", "assistant"),
      msg("u2", "user"),
      msg("a2", "assistant"),
      msg("a3", "assistant"),
    ];

    expect(buildTurnRanges(messages)).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 5 },
    ]);
  });

  it("folds assistant preamble into the first user turn", () => {
    const messages = [
      msg("s0", "assistant"),
      msg("s1", "assistant"),
      msg("u1", "user"),
      msg("a1", "assistant"),
      msg("u2", "user"),
    ];

    expect(buildTurnRanges(messages)).toEqual([
      { start: 0, end: 4 },
      { start: 4, end: 5 },
    ]);
  });

  it("treats a conversation with no user messages as one turn", () => {
    const messages = [msg("a1", "assistant"), msg("a2", "assistant")];
    expect(buildTurnRanges(messages)).toEqual([{ start: 0, end: 2 }]);
  });

  it("returns no turns for an empty history", () => {
    expect(buildTurnRanges([])).toEqual([]);
  });

  it("computes the initial visible turn start", () => {
    expect(getInitialVisibleTurnStart(3, 8)).toBe(0);
    expect(getInitialVisibleTurnStart(8, 8)).toBe(0);
    expect(getInitialVisibleTurnStart(12, 8)).toBe(4);
  });

  it("prepends older turns in fixed chunks without going below zero", () => {
    expect(getPreviousVisibleTurnStart(10, 6)).toBe(4);
    expect(getPreviousVisibleTurnStart(4, 6)).toBe(0);
    expect(getPreviousVisibleTurnStart(0, 6)).toBe(0);
  });

  it("clamps prepend math against the currently known turn count", () => {
    expect(getPrependedVisibleTurnStart(10, 12, 6)).toBe(4);
    expect(getPrependedVisibleTurnStart(10, 3, 6)).toBe(0);
    expect(getPrependedVisibleTurnStart(0, 0, 6)).toBe(0);
  });

  it("maps a visible turn start to the message slice index", () => {
    const turnRanges = [
      { start: 0, end: 2 },
      { start: 2, end: 5 },
      { start: 5, end: 7 },
    ];

    expect(getVisibleMessageStartIndex(turnRanges, 0)).toBe(0);
    expect(getVisibleMessageStartIndex(turnRanges, 1)).toBe(2);
    expect(getVisibleMessageStartIndex(turnRanges, 2)).toBe(5);
    expect(getVisibleMessageStartIndex([], 0)).toBe(0);
  });

  it("waits to initialize a session window until turns are available", () => {
    expect(shouldInitializeVisibleTurns(null, null, 3)).toBe(false);
    expect(shouldInitializeVisibleTurns("session-1", "session-1", 3)).toBe(false);
    expect(shouldInitializeVisibleTurns("session-1", null, 0)).toBe(false);
    expect(shouldInitializeVisibleTurns("session-1", null, 3)).toBe(true);
  });

  it("uses the initial turn window on first render of a new hydrated session", () => {
    expect(getEffectiveVisibleTurnStart("session-2", "session-1", 12, 0, 8)).toBe(4);
    expect(getEffectiveVisibleTurnStart("session-2", null, 12, 3, 8)).toBe(4);
  });

  it("keeps the current visible turn start after the session window is initialized", () => {
    expect(getEffectiveVisibleTurnStart("session-1", "session-1", 12, 5, 8)).toBe(5);
  });

  it("clamps stale visible turn state instead of falling back to full history", () => {
    expect(getEffectiveVisibleTurnStart("session-1", "session-1", 3, 99, 8)).toBe(2);
    expect(getEffectiveVisibleTurnStart("session-1", "session-1", 0, 99, 8)).toBe(0);
  });

  it("treats any session id change as a reset boundary for prepend state", () => {
    expect(didSessionHistoryScopeChange("session-1", "session-1")).toBe(false);
    expect(didSessionHistoryScopeChange("session-1", "session-2")).toBe(true);
    expect(didSessionHistoryScopeChange("session-1", null)).toBe(true);
    expect(didSessionHistoryScopeChange(null, "session-2")).toBe(true);
  });

  it("blocks duplicate older-turn loads while one prepend is already in flight", () => {
    expect(canLoadOlderTurns(false, 2)).toBe(true);
    expect(canLoadOlderTurns(true, 2)).toBe(false);
    expect(canLoadOlderTurns(false, 0)).toBe(false);
  });

  it("detects when the initial window still cannot scroll", () => {
    expect(shouldAutoFillViewport(600, 800, 2)).toBe(true);
    expect(shouldAutoFillViewport(801, 800, 2)).toBe(false);
    expect(shouldAutoFillViewport(600, 800, 0)).toBe(false);
  });

  it("preserves the reader anchor when older turns are prepended", () => {
    expect(getAnchoredScrollTop(120, 1200, 1800)).toBe(720);
  });

  it("keeps the same anchor when scroll height does not change", () => {
    expect(getAnchoredScrollTop(200, 900, 900)).toBe(200);
  });

  it("treats a session with no hydrated store state as loading instead of empty", () => {
    expect(
      shouldShowHydratingHistoryState("session-2", true, false, 0),
    ).toBe(true);
    expect(
      shouldShowHydratingHistoryState("session-2", true, true, 0),
    ).toBe(false);
    expect(
      shouldShowHydratingHistoryState("session-2", true, false, 1),
    ).toBe(false);
    expect(
      shouldShowHydratingHistoryState("session-2", true, true, 0),
    ).toBe(false);
  });
});
