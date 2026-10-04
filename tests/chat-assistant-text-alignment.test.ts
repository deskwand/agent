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

  // 元数据行（时间戳 / 复制 / 朗读 / 分叉）原本顶到列的 0 位，比正文左 4px。
  // 独立成行的 tool_use / thinking 与卡片边框仍停在 0 位，属另一件事。
  it("keeps the assistant action bar on the same 4px step", () => {
    const source = readRendererSource("components/MessageCard.tsx");

    expect(source).toContain('{renderActionBar("pl-1")}');
    // 用户气泡里的操作栏靠右对齐，不参与这条左边缘台阶。
    expect(source).toContain('{renderActionBar("mt-0.5")}');
    // 两个调用点都在时还要看顺序：把它们对调（用户气泡拿 pl-1）也必须是红的。
    expect(source.indexOf('{renderActionBar("pl-1")}')).toBeGreaterThan(
      source.indexOf('{renderActionBar("mt-0.5")}'),
    );
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
