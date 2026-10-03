// 开关的圆点必须在每个主题下都看得见 —— 两种状态都要。
//
// 历史：最早是白圆点 + 关态轨道 --color-surface-active —— 7 个亮色主题块里只有
// 1.19–1.29，圆点等于不存在。改成轨道 --color-border 后关态好了，但白圆点压在
// 浅色 accent 上（void/ocean/forest/paper/ember/aurora 六个暗色预设）只有 1.86–2.72，
// 开态又不行。最终圆点改用 --color-background：关态最小 1.47、开态最小 4.53。
//
// 阈值：关态按 theme-input-visibility 那套「相邻两层至少拉开 1.4」；开态是图形元素
// 的边界，按 WCAG 1.4.11 的 3:1。
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  RENDERER,
  composite,
  contrast,
  themeBlocks,
  tokenOf,
} from "./theme-css-helpers";

const SHARED = fs.readFileSync(
  path.join(RENDERER, "components/settings/shared.tsx"),
  "utf8",
);

/** 解析 color-mix(in srgb, var(--x) N%, var(--color-surface)) —— --color-border 的写法。 */
function resolvedToken(block: string, name: string): string {
  const flat = block.replace(/\s+/g, " ");
  const value = tokenOf(flat, name);
  const mix = /color-mix\(\s*in srgb,\s*var\((--[a-z-]+)\)\s*([\d.]+)%/.exec(
    value,
  );
  if (!mix) return value;
  return composite(
    tokenOf(flat, "--color-surface"),
    tokenOf(flat, mix[1]),
    parseFloat(mix[2]) / 100,
  );
}

describe("设置开关的圆点在各主题下都看得见", () => {
  // 这两条是有意的「改动探测」：换 token 时它会红，下面那条不变量才是行为判据。
  it("关态轨道用 border、开态用 accent，圆点用 background", () => {
    expect(SHARED).toContain('checked ? "bg-accent" : "bg-border"');
    expect(SHARED).toContain("rounded-full bg-background");
    // 不许再回到硬编码颜色。
    expect(SHARED).not.toContain("bg-white");
  });

  it("14 个主题块里两种状态的圆点对比都达标", () => {
    const blocks = themeBlocks();
    expect(blocks.length).toBe(14);
    for (const block of blocks) {
      const head = block.slice(0, 60).replace(/\s+/g, " ");
      const knob = resolvedToken(block, "--color-background");
      const off = contrast(knob, resolvedToken(block, "--color-border"));
      const on = contrast(knob, resolvedToken(block, "--color-accent"));
      expect(
        off,
        `${head} 关态圆点与轨道只有 ${off.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(1.4);
      expect(
        on,
        `${head} 开态圆点与轨道只有 ${on.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(3);
    }
  });
});
