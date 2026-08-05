import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readChatView(): string {
  return readFileSync(
    path.resolve(process.cwd(), "src/renderer/components/ChatView.tsx"),
    "utf8",
  );
}

describe("ChatView incremental history wiring", () => {
  it("renders from a fixed-size message window instead of the full history", () => {
    const source = readChatView();
    expect(source).toContain("const MAX_RENDER_MESSAGES = 400;");
    expect(source).toContain(
      "const [visibleMessageStartIndex, setVisibleMessageStartIndex] = useState(0);",
    );
    expect(source).toContain(
      "displayedMessages.slice(\n        visibleMessageStartIndex,\n        visibleMessageStartIndex + MAX_RENDER_MESSAGES,",
    );
    expect(source).toContain("visibleTurnEntries.map(");
  });

  it("anchors dock ticks to the in-memory window, not the render window", () => {
    const source = readChatView();
    expect(source).toContain(
      "// Dock ticks are anchored to the IN-MEMORY window (all loaded history),",
    );
    expect(source).toContain("const MAX_DOCK_TICKS = 50;");
    expect(source).toContain("onTickSelect={handleDockTickSelect}");
  });

  it("shows a top loading affordance while fetching older history", () => {
    const source = readChatView();
    expect(source).toContain("isLoadingOlder && displayedMessages.length > 0");
    expect(source).toContain("<Loader2");
  });
});
