import { describe, expect, it } from "vitest";
import {
  contrast,
  css,
  parseHex,
  relativeLuminance,
  themeBlocks,
  tokenOf,
} from "./theme-css-helpers";

const BLOCKS = themeBlocks();
const BG = "--color-tooltip-bg";
const FG = "--color-tooltip-fg";

const headOf = (block: string) => block.trimStart().split("\n")[0].trim();
const declares = (block: string, name: string) =>
  new RegExp(`${name}\\s*:`).test(block);

/**
 * `--color-tooltip-bg` 必须**每个主题块各自声明**。
 *
 * 踩过的坑：`:root[data-theme-preset="paper"]`（特指度 0,2,0）会压过 `.light`（0,1,0），
 * 而浅色模式下 `<html>` 上同时挂着 `light` 类与 `data-theme-preset` 属性 —— 于是
 * 浅色预设块若"靠 .light 继承"，实际拿到的是**深色预设的灰**（真实引擎实测：
 * paper 浅色拿到 #48433c 而不是 #3d3225）。所以这里不许用"家族回退"，必须逐块声明。
 */
const EXPECTED_BG_DECLARATIONS = 14;

/** `--color-tooltip-fg` 只在两个基准块声明；两者特指度相同 → 按源码顺序，靠后的 `.light` 胜 */
const EXPECTED_FG_BLOCKS = [":root {", ".light {"];

/** 把 var(--color-x) 就地解析成该主题块自己的值（一层足够） */
function resolve(block: string, raw: string): string {
  const m = /^var\((--[\w-]+)\)$/.exec(raw.trim());
  return m ? tokenOf(block, m[1]) : raw.trim();
}

/** 某个主题声明"实际生效"的气泡配色：自己声明优先，否则取所属基准块的值 */
function effective(block: string) {
  const head = headOf(block);
  const isLight = head.startsWith(".light");
  const family = BLOCKS.find(
    (b) => headOf(b) === (isLight ? ".light {" : ":root {"),
  )!;
  // bg：只认本块自己的声明（见上面 EXPECTED_BG_DECLARATIONS 的注释）
  const bg = resolve(block, tokenOf(block, BG));
  // fg：只有 :root 与 .light 声明，两者特指度都是 (0,1,0) → 源码顺序靠后的 `.light` 胜，
  // 所以浅色族取 .light、深色族取 :root 是正确的家族回退
  const fg = resolve(block, tokenOf(family, FG));
  return {
    head,
    isLight,
    bg,
    fg,
    Lbg: relativeLuminance(parseHex(bg)),
    Ltext: relativeLuminance(parseHex(tokenOf(block, "--color-text-primary"))),
  };
}

describe("tooltip 反色配色", () => {
  it("每个主题块都自己声明 bg；fg 只在两个基准块声明", () => {
    const bgBlocks = BLOCKS.filter((b) => declares(b, BG));
    expect(
      bgBlocks.length,
      `只有 ${bgBlocks.length}/${BLOCKS.length} 个主题块声明了 ${BG}：` +
        BLOCKS.map(headOf)
          .filter((h) => !bgBlocks.map(headOf).includes(h))
          .join(", "),
    ).toBe(EXPECTED_BG_DECLARATIONS);

    const sort = (xs: string[]) => [...xs].sort();
    expect(sort(BLOCKS.filter((b) => declares(b, FG)).map(headOf))).toEqual(
      sort([...EXPECTED_FG_BLOCKS]),
    );
  });

  it("14 个主题的有效配色都能看清（对比度 ≥ 4.5）", () => {
    for (const block of BLOCKS) {
      const { head, bg, fg } = effective(block);
      expect(
        contrast(bg, fg),
        `${head} 的对比度只有 ${contrast(bg, fg).toFixed(1)}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("浅色族：气泡底足够深（L ≤ 0.1）", () => {
    for (const block of BLOCKS) {
      const { head, isLight, Lbg } = effective(block);
      if (!isLight) continue;
      expect(Lbg, `${head} 的气泡底 L=${Lbg.toFixed(3)}`).toBeLessThanOrEqual(
        0.1,
      );
    }
  });

  it("深色族：气泡是中间灰，且永远不是最亮的元素", () => {
    for (const block of BLOCKS) {
      const { head, isLight, Lbg, Ltext } = effective(block);
      if (isLight) continue;
      expect(
        Lbg,
        `${head} 的气泡底 L=${Lbg.toFixed(3)} 太暗`,
      ).toBeGreaterThanOrEqual(0.02);
      expect(
        Lbg,
        `${head} 的气泡底 L=${Lbg.toFixed(3)} 太亮`,
      ).toBeLessThanOrEqual(0.25);
      expect(
        Lbg,
        `${head} 的气泡底 ${Lbg.toFixed(3)} 不该压过正文 ${Ltext.toFixed(3)}`,
      ).toBeLessThanOrEqual(0.3 * Ltext);
    }
  });

  it("浅色族的气泡底就是该主题自己的正文色（保住每主题色相）", () => {
    // 光有"L ≤ 0.1"挡不住静默退化：把 .light 里的 var(--color-text-primary)
    // 换成某个硬编码近黑，7 个浅色变体就都变成同一种中性黑，界值仍然通过。
    for (const block of BLOCKS) {
      const { head, isLight, bg } = effective(block);
      if (!isLight) continue;
      expect(bg, `${head} 的气泡底不再跟随该主题的正文色`).toBe(
        tokenOf(block, "--color-text-primary"),
      );
    }
  });

  it("深色族的气泡字色跟随该主题自己的正文色", () => {
    // 少了这条，把 :root 的 fg 换成硬编码 #f4f4f5 也能全绿
    for (const block of BLOCKS) {
      const { head, isLight, fg } = effective(block);
      if (isLight) continue;
      expect(fg, `${head} 的气泡字色不再跟随该主题的正文色`).toBe(
        tokenOf(block, "--color-text-primary"),
      );
    }
  });

  it("深色族 7 个值互不相同（防止塌成一个共享中性灰）", () => {
    const values = BLOCKS.map(effective)
      .filter((e) => !e.isLight)
      .map((e) => e.bg);
    expect(values).toHaveLength(7);
    expect(
      new Set(values).size,
      `7 个深色主题的气泡底重复了：${values.join(", ")}`,
    ).toBe(7);
  });

  it(".tt-bubble 真的用上了这对 token，且不再有描边", () => {
    // 少了这条，把 .tt-bubble 改回 --color-surface 也能让上面 6 条全绿
    const start = css.indexOf(".tt-bubble {");
    expect(start, "找不到 .tt-bubble 块").toBeGreaterThan(-1);
    const block = css.slice(start, css.indexOf("}", start));
    expect(block).toContain("background: var(--color-tooltip-bg)");
    expect(block).toContain("color: var(--color-tooltip-fg)");
    expect(block, ".tt-bubble 不该再有描边").not.toMatch(/border\s*:/);
  });
});
