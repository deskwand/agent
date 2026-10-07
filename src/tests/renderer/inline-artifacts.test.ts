import { describe, expect, it } from "vitest";
import {
  filterInlineArtifactFiles,
  normalizeArtifactKey,
  splitArtifactBlocks,
} from "../../renderer/utils/inline-artifacts";
import type { ContentBlock } from "../../renderer/types";

const FENCE =
  '```artifact\n{"path":"out/a.html","name":"a.html","render":"inline"}\n```';

function text(value: string): ContentBlock {
  return { type: "text", text: value };
}

describe("normalizeArtifactKey", () => {
  it("unifies separators and strips a leading ./", () => {
    expect(normalizeArtifactKey(".\\out\\report.html")).toBe("out/report.html");
    expect(normalizeArtifactKey("./out/report.html")).toBe("out/report.html");
  });
});

describe("filterInlineArtifactFiles", () => {
  const files = [
    { path: "out/report.html" },
    { path: "out/data.csv" },
    { path: "notes.md" },
  ];

  it("drops the paths rendered inline", () => {
    const result = filterInlineArtifactFiles(files, [
      { path: "out/report.html" },
    ]);
    expect(result.map((file) => file.path)).toEqual([
      "out/data.csv",
      "notes.md",
    ]);
  });

  it("matches across separator and ./ differences", () => {
    const result = filterInlineArtifactFiles(files, [
      { path: ".\\out\\report.html" },
    ]);
    expect(result.map((file) => file.path)).toEqual([
      "out/data.csv",
      "notes.md",
    ]);
  });

  it("returns the same array when nothing is inline", () => {
    expect(filterInlineArtifactFiles(files, [])).toBe(files);
  });
});

describe("splitArtifactBlocks", () => {
  it("把围栏换成产物块，位置和顺序不变", () => {
    const out = splitArtifactBlocks([text(`前\n${FENCE}\n后`)]);
    expect(out.map((b) => b.type)).toEqual(["text", "artifact", "text"]);
    expect(out[0]).toMatchObject({ text: "前\n" });
    expect(out[1]).toMatchObject({
      path: "out/a.html",
      name: "a.html",
      render: "inline",
    });
    expect(out[2]).toMatchObject({ text: "\n后" });
  });

  it("一段里有两个围栏", () => {
    const second = '```artifact\n{"path":"out/b.html","render":"inline"}\n```';
    const out = splitArtifactBlocks([text(`${FENCE}中间${second}`)]);
    expect(out.map((b) => b.type)).toEqual(["artifact", "text", "artifact"]);
    expect(
      out
        .filter((b) => b.type === "artifact")
        .map((b) => (b as { path: string }).path),
    ).toEqual(["out/a.html", "out/b.html"]);
  });

  it("没有 render 标记的围栏从正文里去掉，但不产生产物块", () => {
    const fence = '```artifact\n{"path":"out/a.html"}\n```';
    const out = splitArtifactBlocks([text(`前${fence}后`)]);
    expect(out.map((b) => b.type)).toEqual(["text"]);
    expect(out[0]).toMatchObject({ text: "前后" });
  });

  it("JSON 坏掉时原样留在正文", () => {
    const broken = "```artifact\n{not json}\n```";
    const out = splitArtifactBlocks([text(broken)]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ text: broken });
  });

  it("坏 JSON 后面跟一个合法围栏：坏的那段仍是文本", () => {
    const broken = "```artifact\n{not json}\n```";
    const out = splitArtifactBlocks([text(broken + FENCE)]);
    expect(out.map((b) => b.type)).toEqual(["text", "artifact"]);
    expect((out[0] as { text: string }).text).toBe(broken);
  });

  it("流式时丢掉未闭合的围栏尾巴，非流式时留着", () => {
    const open = '前\n```artifact\n{"path":"out/a.html","render":"inl';
    const streamed = splitArtifactBlocks([text(open)], { streaming: true });
    expect(streamed.map((b) => b.type)).toEqual(["text"]);
    expect((streamed[0] as { text: string }).text).toBe("前\n");
    const settled = splitArtifactBlocks([text(open)], { streaming: false });
    expect(settled).toHaveLength(1);
    expect((settled[0] as { text: string }).text).toBe(open);
  });

  it("非文本块原样穿过", () => {
    const tool: ContentBlock = { type: "thinking", thinking: "x" };
    const out = splitArtifactBlocks([tool, text(FENCE)]);
    expect(out[0]).toBe(tool);
    expect(out[1]).toMatchObject({ type: "artifact" });
  });
});
