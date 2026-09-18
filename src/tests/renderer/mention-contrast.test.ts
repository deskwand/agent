// 设计文档 design-docs/2026-09-17-inline-reference-tokens-design.md §4.2 的不变量。
//
// 去掉底色之后，颜色是 token 唯一的识别信号 —— 所以必须锁死"在每一套主题下都看得见"。
// 色值不写死在断言里：从 globals.css 读，改色只要满足同一条阈值即可。
import { describe, expect, it } from "vitest";
import { contrast, themeBlocks, tokenOf } from "./theme-css-helpers";

describe("--color-mention 跨主题可辨识度", () => {
  it("14 个主题块都声明了 --color-mention", () => {
    const blocks = themeBlocks();
    expect(blocks.length).toBe(14);
    for (const block of blocks) {
      const head = block.slice(0, 60).replace(/\s+/g, " ");
      expect(block, `${head} 缺 --color-mention`).toMatch(
        /--color-mention\s*:/,
      );
    }
  });

  it("对 --color-background 的对比度 ≥ 4.5:1（WCAG AA 正文）", () => {
    for (const block of themeBlocks()) {
      const head = block.slice(0, 60).replace(/\s+/g, " ");
      const ratio = contrast(
        tokenOf(block, "--color-mention"),
        tokenOf(block, "--color-background"),
      );
      expect(ratio, `${head} 实测 ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  });
});
