import { describe, expect, it } from "vitest";
import { stripSyntheticBlocks } from "../../renderer/utils/synthetic-blocks";
import type { ContentBlock } from "../../renderer/types";

function text(value: string, synthetic?: boolean): ContentBlock {
  return synthetic
    ? { type: "text", text: value, synthetic: true }
    : { type: "text", text: value };
}

describe("stripSyntheticBlocks", () => {
  it("去掉合成块、保留用户文本与顺序", () => {
    const out = stripSyntheticBlocks([
      text("<selected-element/>", true),
      text("圆角太大"),
      text("<selected-element/>", true),
    ]);
    expect(out).toEqual([{ type: "text", text: "圆角太大" }]);
  });

  it("没有合成块时原样返回内容", () => {
    const out = stripSyntheticBlocks([text("hi")]);
    expect(out).toEqual([{ type: "text", text: "hi" }]);
  });

  it("synthetic 为 false / 缺省都不算合成块", () => {
    expect(
      stripSyntheticBlocks([
        { type: "text", text: "a", synthetic: false } as ContentBlock,
        text("b"),
      ]),
    ).toHaveLength(2);
  });

  it("保留非文本块（工具块不能被误杀）", () => {
    const out = stripSyntheticBlocks([
      { type: "thinking", thinking: "…" } as ContentBlock,
      text("x", true),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("thinking");
  });
});
