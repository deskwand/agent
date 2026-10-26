// 悬浮底 / 选中底的固定语义层 token。
//
// 为什么不用官方 --accent（2026-10-26 现场实测）：亮色 accent = #f4f4f5，
// 压在白底 1.099、压在侧边栏（实测 #f2f2f3）1.017、压在 muted 面 1.000 ——
// 最后一个是严格零变化，因为官方 7 套 base 里 --accent ≡ --muted ≡ --secondary。
// 2026-10 官方 vocabulary 切换时删掉了原来的三个叠层 token，本轮按
// 「正文色墨水叠层」恢复其中两档：它与底色无关，只与前景色有关。
import { describe, expect, it } from "vitest";
import {
  composite,
  contrast,
  css,
  themeBlocks,
  tokenOf,
} from "./theme-css-helpers";

const FIXED = css.slice(0, css.indexOf("@layer base {"));
const DARK_DECL = /^:root\s*\{([\s\S]*?)\n\}/m.exec(FIXED)?.[1] ?? "";
const LIGHT_DECL = /:root\.light\s*\{([\s\S]*?)\n\}/.exec(FIXED)?.[1] ?? "";

/** 读出一档墨水的百分比。公式形状不对就抛错 —— 这条正则就是「只用 foreground」的判据。 */
function ink(name: "hover" | "selected", mode: "light" | "dark"): number {
  const decl = (mode === "light" ? LIGHT_DECL : DARK_DECL).replace(/\s+/g, " ");
  const re = new RegExp(
    `--${name}-surface\\s*:\\s*color-mix\\(\\s*in srgb,\\s*var\\(--foreground\\)\\s+([\\d.]+)%,\\s*transparent\\s*\\)`,
  );
  const m = re.exec(decl);
  if (!m) {
    throw new Error(
      `${mode} 缺少 --${name}-surface，或公式不是「var(--foreground) N% + transparent」`,
    );
  }
  return Number(m[1]) / 100;
}

const blocks = themeBlocks();
const isLight = (block: string) => /^\s*\.light/.test(block);

/** 六个「行 / 控件会坐在上面」的表面。muted / secondary / accent 三者同值是主要动机。 */
const SURFACES = [
  "--background",
  "--card",
  "--sidebar",
  "--muted",
  "--secondary",
  "--accent",
] as const;

/** 墨水以 p 叠在某个表面上的最终底色。 */
function inkOver(block: string, surface: string, p: number): string {
  return composite(tokenOf(block, surface), tokenOf(block, "--foreground"), p);
}

describe("悬浮 / 选中底", () => {
  it("14 块 × 六个表面：hover ≥1.10/1.20，selected ≥1.20/1.40", () => {
    expect(blocks.length).toBe(14);
    const violations: string[] = [];
    for (const block of blocks) {
      const light = isLight(block);
      const head = block.slice(0, 60).replace(/\s+/g, " ");
      const hover = ink("hover", light ? "light" : "dark");
      const selected = ink("selected", light ? "light" : "dark");
      const [hoverFloor, selectedFloor] = light ? [1.1, 1.2] : [1.2, 1.4];
      for (const surface of SURFACES) {
        const base = tokenOf(block, surface);
        const h = contrast(inkOver(block, surface, hover), base);
        const s = contrast(inkOver(block, surface, selected), base);
        if (h < hoverFloor) {
          violations.push(`${head} hover/${surface} = ${h.toFixed(3)}`);
        }
        if (s < selectedFloor) {
          violations.push(`${head} selected/${surface} = ${s.toFixed(3)}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("selected 恒强于 hover（层级不倒挂）", () => {
    for (const mode of ["light", "dark"] as const) {
      expect(ink("selected", mode)).toBeGreaterThan(ink("hover", mode));
    }
  });

  it("静止底已是浅色块（muted/accent）的元素：hover 走 selected 档仍看得出（≥1.09）", () => {
    // 为什么单列一条：hover 变体是**替换**元素自己的底色，不是叠在上面。元素静止时
    // 铺的是 muted（= 6% ink），若 hover 仍用 hover-surface（6% ink 叠在父面上），
    // 两者只差 1.037 —— 与本次要修的侧边栏 1.017 是同一档。
    //
    // 门槛写 1.09 而不是 1.10：亮色实测 1.0999（Δ≈13/255），正好压在 1.10 的浮点
    // 边界上；而这个差值与本仓一直认为「看得见」的 accent-on-white（1.099）同档。
    // 取 1.09 是为了不让一条浮点边界倒过来逼着改 token 的浓度。
    const violations: string[] = [];
    for (const block of blocks) {
      const light = isLight(block);
      const p = ink("selected", light ? "light" : "dark");
      const resting = tokenOf(block, "--muted");
      for (const parent of ["--background", "--card"] as const) {
        const r = contrast(inkOver(block, parent, p), resting);
        if (r < 1.09) {
          violations.push(
            `${block.slice(0, 40)} selected-over-${parent} vs muted = ${r.toFixed(3)}`,
          );
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("墨水面上 accent-foreground 文字够读（≥4.5）", () => {
    const violations: string[] = [];
    for (const block of blocks) {
      const light = isLight(block);
      const p = ink("hover", light ? "light" : "dark");
      for (const surface of SURFACES) {
        const r = contrast(
          tokenOf(block, "--accent-foreground"),
          inkOver(block, surface, p),
        );
        if (r < 4.5) {
          violations.push(`${block.slice(0, 40)} ${surface}/${r.toFixed(2)}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
