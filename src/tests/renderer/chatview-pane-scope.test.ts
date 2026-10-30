import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../../renderer");
const PANE_SCOPED_FILES = [
  "components/ChatView.tsx",
  "components/ChatInput.tsx",
  "components/message/ContentBlockView.tsx",
  "components/message/ArtifactCard.tsx",
  "components/message/ArtifactInlineFrame.tsx",
  "hooks/use-open-artifact.ts",
];

function read(file: string): string {
  return readFileSync(resolve(ROOT, file), "utf8");
}

describe("chat view pane scope (source guard)", () => {
  for (const file of PANE_SCOPED_FILES) {
    it(`${file} 不再读全局会话`, () => {
      const src = read(file);
      expect(src).not.toContain("useActiveSessionId(");
      expect(src).not.toContain("useCurrentSession(");
      expect(src).not.toMatch(/\bs\.activeSessionId\b/);
    });
  }

  it("ChatView 不再用 getState().activeSessionId 与全局 useActive* 选择器", () => {
    const src = read("components/ChatView.tsx");
    expect(src).not.toMatch(/getState\(\)\s*\.activeSessionId/);
    expect(src).not.toMatch(
      /\buseActive(SessionMessages|PartialContent|Turn|ExecutionClock)\(/,
    );
    expect(src).not.toContain("usePendingTurns(");
  });

  it("ChatView 的按会话订阅走 selectors.ts，不再内联", () => {
    const src = read("components/ChatView.tsx");
    expect(src).not.toContain("EMPTY_PANE_");
    expect(src).toContain("useSessionMessages(activeSessionId)");
  });
});
