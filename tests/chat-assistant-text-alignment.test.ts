import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

function readRendererSource(relativePath: string) {
  return fs.readFileSync(
    path.resolve(__dirname, `../src/renderer/${relativePath}`),
    "utf8",
  );
}

// The assistant reply must share its left edge with the tool-call group's
// leading icon. Both anchor on the same 4px step: the group header carries
// px-1 (its icon starts 4px inside the column) and the assistant prose
// carries pl-1.
describe("assistant text alignment with tool-call groups", () => {
  it("anchors every assistant text branch on the group icon step", () => {
    const source = readRendererSource(
      "components/message/ContentBlockView.tsx",
    );

    expect(source.match(/pl-1(?![.\d])/g)).toHaveLength(4);
    expect(source).toContain('<div className="pl-1">');
    expect(source).toContain('${isUser ? "" : "pl-1"}');
    expect(source).toContain("message-user-text text-text-primary");
  });

  it("keeps the tool-call group headers on the same 4px step", () => {
    const sources = [
      "components/message/ProcessSummaryBlock.tsx",
      "components/message/ResultSummaryBlock.tsx",
    ].map(readRendererSource);

    for (const source of sources) {
      expect(source).toContain("rounded-lg px-1 ");
      expect(source).toContain("inline-flex items-center gap-1 ");
    }
  });
});
