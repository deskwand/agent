import { describe, expect, it } from "vitest";
import type { Message } from "../../renderer/types";
import {
  getAnchoredScrollTop,
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
    void msg;
  });
});
