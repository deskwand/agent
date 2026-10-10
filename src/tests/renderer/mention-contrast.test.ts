// 行内引用 token（@技能 / /命令 / 文件路径）的识别度不变量。
//
// 2026-10 改口径：官方 vocabulary 里没有 mention 色，识别信号从"颜色"改成"底色"——
// 文字用 --primary、底用 --accent。于是要锁两件事：
//   1) 两处类串常量确实带上了这两个类（改回去就没信号了）
//   2) 两者在各主题块下都可读（≥4.5）—— 底是主题色，文字必须跟着主题走
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { RENDERER, contrast, themeBlocks, tokenOf } from "./theme-css-helpers";

const referenceToken = fs.readFileSync(
  path.join(RENDERER, "components/ReferenceToken.tsx"),
  "utf8",
);
const editorContent = fs.readFileSync(
  path.join(RENDERER, "utils/editor-content.ts"),
  "utf8",
);

describe("行内引用 token 的识别度", () => {
  it("两处类串常量都带 text-primary + bg-accent（识别信号从颜色改到底色）", () => {
    for (const [name, source] of [
      ["ReferenceToken.BASE_CLASS", referenceToken],
      ["editor-content.TOKEN_CLASS", editorContent],
    ] as const) {
      expect(source, `${name} 缺 text-primary`).toMatch(/text-primary/);
      expect(source, `${name} 缺 bg-accent`).toMatch(/bg-accent/);
    }
  });

  it("14 个主题块下文字（--primary）对底色（--accent）都 ≥ 4.5", () => {
    const blocks = themeBlocks();
    expect(blocks.length).toBe(14);
    const low: string[] = [];
    for (const block of blocks) {
      const head = block.slice(0, 60).replace(/\s+/g, " ");
      const ratio = contrast(
        tokenOf(block, "--primary"),
        tokenOf(block, "--accent"),
      );
      if (ratio < 4.5) low.push(`${ratio.toFixed(2)}  ${head}`);
    }
    expect(low, `以下主题块下 token 文字不可读：\n${low.join("\n")}`).toEqual(
      [],
    );
  });
});
