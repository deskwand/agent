import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { resolveWheelFollowChange } from "../src/renderer/components/ChatView";

const chatViewPath = path.resolve(
  process.cwd(),
  "src/renderer/components/ChatView.tsx",
);
const source = fs.readFileSync(chatViewPath, "utf8");

describe("resolveWheelFollowChange", () => {
  it("returns false (kill follow) for upward wheel gestures", () => {
    expect(resolveWheelFollowChange(-10, 200, 500)).toBe(false);
  });

  it("returns true (revive follow) for downward wheels at the physical bottom", () => {
    expect(resolveWheelFollowChange(10, 500, 500)).toBe(true);
  });

  it("revives within 1px of the bottom (scroll jitter tolerance)", () => {
    expect(resolveWheelFollowChange(10, 499.5, 500)).toBe(true);
  });

  it("revives downward wheels when content does not overflow (scrollTop=maxScrollTop=0)", () => {
    // Regression: with a short tail, scroll events can never fire, so a
    // wheel-down after an accidental wheel-up must revive follow on its own.
    expect(resolveWheelFollowChange(10, 0, 0)).toBe(true);
  });

  it("returns null (no change) for downward wheels far from the bottom", () => {
    expect(resolveWheelFollowChange(10, 100, 500)).toBeNull();
  });

  it("returns null for zero deltas", () => {
    expect(resolveWheelFollowChange(0, 500, 500)).toBeNull();
  });
});

describe("ChatView wheel handler wiring", () => {
  it("uses resolveWheelFollowChange for the follow decision", () => {
    expect(source).toMatch(/resolveWheelFollowChange\(/);
  });

  it("applies revive branch: follow=true and hides the scroll-to-bottom button", () => {
    expect(source).toContain("setShowScrollToBottom(false)");
  });

  it("applies kill branch: follow=false and shows the scroll-to-bottom button", () => {
    expect(source).toContain("setShowScrollToBottom(true)");
  });
});
