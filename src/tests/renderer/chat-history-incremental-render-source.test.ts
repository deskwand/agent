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
  it("renders from a sliced message window instead of mapping the full history directly", () => {
    const source = readChatView();
    expect(source).toContain("const INITIAL_VISIBLE_TURNS = 8;");
    expect(source).toContain("const PREPEND_TURNS = 6;");
    expect(source).toContain(
      "const [visibleTurnStartIndex, setVisibleTurnStartIndex] = useState(0);",
    );
    expect(source).toContain(
      "const turnRanges = useMemo(() => buildTurnRanges(displayedMessages)",
    );
    expect(source).toContain("const visibleMessages = useMemo(() =>");
    expect(source).toContain(
      "displayedMessages.slice(visibleMessageStartIndex)",
    );
    expect(source).toContain(
      "visibleTurnEntries.map(({ message, isStreaming, isLatestRound, artifactFiles }) => (",
    );
  });

  it("shows a top loading affordance while prepending older turns", () => {
    const source = readChatView();
    expect(source).toContain("isLoadingOlder && displayedMessages.length > 0");
    expect(source).toContain("<Loader2");
  });

  it("documents the current one-sided windowing tradeoff", () => {
    const source = readChatView();
    expect(source).toContain("TODO: add bottom-side reclamation");
  });
});
