// Tooltip 气泡的配色不变量。
//
// 2026-10-10 改口径：气泡不再用自造的 --tooltip-bg/fg（"反色 + 每主题色相"那套），
// 改用官方 `--popover` / `--popover-foreground` —— 一份官方主题贴进来就自带气泡配色。
// 因此这里只锁两件事：
//   1) .tt-bubble 确实用这对官方变量（改回 --card 或写死色值要能红）
//   2) 14 个主题块下气泡字色对底色的对比度 ≥ 4.5（WCAG AA 正文）
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  RENDERER,
  contrast,
  css,
  themeBlocks,
  tokenOf,
} from "./theme-css-helpers";

const BG = "--popover";
const FG = "--popover-foreground";

function bubbleBlock(): string {
  const start = css.indexOf(".tt-bubble {");
  expect(start, "找不到 .tt-bubble 块").toBeGreaterThan(-1);
  const end = css.indexOf("}", start);
  return css.slice(start, end);
}

describe("tooltip 气泡配色", () => {
  it("14 个主题块都声明了官方气泡变量", () => {
    const blocks = themeBlocks();
    expect(blocks.length).toBe(14);
    for (const block of blocks) {
      const head = block.slice(0, 60).replace(/\s+/g, " ");
      expect(block, `${head} 缺 ${BG}`).toMatch(new RegExp(`${BG}\\s*:`));
      expect(block, `${head} 缺 ${FG}`).toMatch(new RegExp(`${FG}\\s*:`));
    }
  });

  it("14 个主题下气泡文字都 ≥ 4.5:1", () => {
    const low: string[] = [];
    for (const block of themeBlocks()) {
      const head = block.slice(0, 60).replace(/\s+/g, " ");
      const ratio = contrast(tokenOf(block, FG), tokenOf(block, BG));
      if (ratio < 4.5) low.push(`${ratio.toFixed(2)}  ${head}`);
    }
    expect(low, `以下主题块气泡文字不可读：\n${low.join("\n")}`).toEqual([]);
  });

  it(".tt-bubble 真的用上了这对官方变量，且不再有描边", () => {
    const block = bubbleBlock();
    expect(block, "气泡底色应取官方 --popover").toMatch(
      /background:\s*var\(--popover\)/,
    );
    expect(block, "气泡字色应取官方 --popover-foreground").toMatch(
      /color:\s*var\(--popover-foreground\)/,
    );
    expect(block, ".tt-bubble 不该再有描边").not.toMatch(/border\s*:/);
  });

  it("气泡组件走的是共享的 Tooltip 包装层（不是自造 DOM）", () => {
    const tooltipSource = fs.readFileSync(
      path.join(RENDERER, "components/Tooltip.tsx"),
      "utf8",
    );
    expect(tooltipSource).toMatch(/tt-bubble/);
  });
});
