import { describe, expect, it } from "vitest";
import type { Message } from "../../renderer/types";
import {
  getAnchoredScrollTop,
  getVisibleMessageEndIndex,
  shouldAutoFillViewport,
  shouldInitializeVisibleWindow,
} from "../../renderer/components/ChatView";

function msg(id: string, role: "user" | "assistant" = "user"): Message {
  return { id, sessionId: "s", role, content: [], timestamp: 1 } as Message;
}

describe("chat history render-window helpers", () => {
  it("initializes the window to the tail", () => {
    expect(shouldInitializeVisibleWindow("s1", null, 100)).toBe(true);
    expect(shouldInitializeVisibleWindow("s1", "s1", 100)).toBe(false);
    expect(shouldInitializeVisibleWindow(null, null, 100)).toBe(false);
    expect(shouldInitializeVisibleWindow("s1", null, 0)).toBe(false);
  });

  it("auto-fills the viewport only when older history is still above", () => {
    expect(shouldAutoFillViewport(0, 0, 400)).toBe(true);
    expect(shouldAutoFillViewport(1000, 500, 400)).toBe(false);
    expect(shouldAutoFillViewport(0, 0, 0)).toBe(false);
  });

  it("anchors scroll position across height changes", () => {
    expect(getAnchoredScrollTop(500, 2000, 2600)).toBe(1100);
    expect(getAnchoredScrollTop(0, 1000, 800)).toBe(-200);
  });

  it("treats a window with no messages as not initializable", () => {
    expect(shouldInitializeVisibleWindow("s1", null, 0)).toBe(false);
  });
});

describe("completed-turn render coverage", () => {
  const messages: Message[] = [
    msg("history-0"),
    msg("history-1"),
    msg("user"),
    { ...msg("reply-0", "assistant"), turnId: "turn-1" },
    { ...msg("reply-1", "assistant"), turnId: "turn-1" },
    { ...msg("reply-2", "assistant"), turnId: "turn-1" },
  ];

  it("keeps the base window end without a retained turn", () => {
    expect(getVisibleMessageEndIndex(messages, 1, 3, null)).toBe(4);
    expect(getVisibleMessageEndIndex(messages, 4, 3, null)).toBe(6);
  });

  it("does not extend a window that already covers the retained turn", () => {
    expect(getVisibleMessageEndIndex(messages, 2, 4, "turn-1")).toBe(6);
  });

  it("extends the end through all replies of a split turn", () => {
    expect(getVisibleMessageEndIndex(messages, 1, 3, "turn-1")).toBe(6);
  });

  it("covers a late reply of the retained turn", () => {
    expect(
      getVisibleMessageEndIndex(messages.slice(0, 5), 1, 3, "turn-1"),
    ).toBe(5);
    expect(getVisibleMessageEndIndex(messages, 1, 3, "turn-1")).toBe(6);
  });

  it("keeps the base end when the retained turn is absent", () => {
    expect(getVisibleMessageEndIndex(messages, 1, 3, "missing")).toBe(4);
  });

  it("does not recover retained messages before the window start", () => {
    expect(getVisibleMessageEndIndex(messages, 6, 3, "turn-1")).toBe(6);
  });
});
