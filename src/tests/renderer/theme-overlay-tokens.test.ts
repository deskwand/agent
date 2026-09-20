// 设计文档 §4.1 的承重前提：三个叠层 token 只在 :root 声明一次，值里的 var()
// 由 color-mix() 在使用处解析。这要求主题类与预设属性挂在同一个元素（<html>）上，
// 且每个主题块都自己声明了 --color-text-primary / --color-accent。
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  RENDERER,
  css,
  cssFlat,
  composite,
  contrast,
  themeBlocks,
  tokenOf,
} from "./theme-css-helpers";

const appTsx = fs.readFileSync(path.join(RENDERER, "App.tsx"), "utf8");

const OVERLAY_TOKENS = [
  "--color-overlay-hover",
  "--color-overlay-press",
  "--color-overlay-on",
] as const;

describe("overlay token 的承重前提", () => {
  it("三个叠层 token 各只声明一次", () => {
    for (const token of OVERLAY_TOKENS) {
      const count = (css.match(new RegExp(`${token}\\s*:`, "g")) ?? []).length;
      expect(count, `${token} 声明了 ${count} 次，应为 1`).toBe(1);
    }
  });

  it("14 个主题块都自己声明了叠加层依赖的两个 token", () => {
    const blocks = themeBlocks();
    expect(blocks.length).toBe(14);
    for (const block of blocks) {
      const head = block.slice(0, 60).replace(/\s+/g, " ");
      expect(block, `${head} 缺 --color-text-primary`).toMatch(
        /--color-text-primary\s*:/,
      );
      expect(block, `${head} 缺 --color-accent`).toMatch(/--color-accent\s*:/);
    }
  });

  it("主题类与预设属性都挂在 documentElement 上", () => {
    // 源码字符串检查：这是 CSS 层无法自证的前提，一旦有人把主题挂到 <body>
    // 上，叠层会静默锁死在暗色取值而不报错。
    expect(appTsx).toMatch(/document\.documentElement\.classList/);
    expect(appTsx).toMatch(/document\.documentElement\.setAttribute/);
  });

  it("顶层 :root 声明的 token 不会被 @layer base 里的主题块重复声明", () => {
    // 产物里顶层 :root 位于 @layer base 之后，与 .light 特异性相同（0,1,0），
    // 因此源码顺序会让顶层 :root 胜出——在 @layer base 的 .light 里声明的同名 token
    // 会静默变成死代码，亮色模式实际拿到暗色的值。
    //
    // --color-surface-highlight 就踩过这个坑：它在 .light 里写了 transparent，
    // 但被后面的顶层 :root 的 rgba(255,255,255,.08) 盖掉（已在 Chrome 里实测确认）。
    // 所以它的亮色覆盖改成了 :root.light，并且由这条断言拦住回归。
    // 定位到含 --color-overlay-hover 的**那个**顶层 :root：
    // 不能写成 /^:root\s*\{[\s\S]*?--color-overlay-hover/——非贪婪仍然会从文件开头
    // 那个小 :root 起步，把中间的主题块一并圈进来，造成假红。
    const anchor = css.indexOf("--color-overlay-hover");
    expect(
      anchor,
      "globals.css 里找不到 --color-overlay-hover",
    ).toBeGreaterThan(-1);
    const start = css.lastIndexOf("\n:root {", anchor);
    const end = css.indexOf("\n}", anchor);
    expect(
      start,
      "找不到含 --color-overlay-hover 的顶层 :root",
    ).toBeGreaterThan(-1);
    const overlayRoot = css.slice(start, end);
    const declared = [...overlayRoot.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map(
      (m) => m[1],
    );
    expect(declared.length).toBeGreaterThan(0);

    const baseLayer = css.slice(
      css.indexOf("@layer base"),
      css.indexOf("@layer components"),
    );
    expect(baseLayer.length).toBeGreaterThan(0);

    for (const token of declared) {
      expect(
        baseLayer.includes(`${token}:`),
        `${token} 既在顶层 :root 声明，又在 @layer base 的主题块里声明——后者是死代码，改写成 :root.light 或 :root[data-theme-preset]`,
      ).toBe(false);
    }
  });
});

// ── 叠层强度：把设计文档 §3.4 的实测结论锁成不变量 ──
//
// 阈值的作用是区分"看得见但不刺眼"与两种错法：
//   alpha=0.08 → 暗色会到 1.25（回到改造前的高度，极差 0.10）
//   alpha=0.04 → 浅色会掉到 1.09（又变成看不见）
// 所以上下限 + 极差两个断言缺一不可。

describe("叠层强度不变量", () => {
  /** 从 globals.css 真实解析 color-mix 声明，不把 alpha 写死在测试里。 */
  function overlaySpec(name: string): { base: string; alpha: number } {
    const m = new RegExp(
      `${name}\\s*:\\s*color-mix\\(\\s*in srgb,\\s*var\\((--[a-z-]+)\\)\\s*([\\d.]+)%,`,
    ).exec(cssFlat);
    if (!m) throw new Error(`globals.css 里找不到 ${name} 的 color-mix 声明`);
    return { base: m[1], alpha: Number(m[2]) / 100 };
  }

  function samples() {
    const hover = overlaySpec("--color-overlay-hover");
    const press = overlaySpec("--color-overlay-press");
    const on = overlaySpec("--color-overlay-on");
    return themeBlocks().map((block) => {
      const bar = tokenOf(block, "--color-background-secondary");
      return {
        head: block.slice(0, 60).replace(/\s+/g, " "),
        hover: contrast(
          bar,
          composite(bar, tokenOf(block, hover.base), hover.alpha),
        ),
        press: contrast(
          bar,
          composite(bar, tokenOf(block, press.base), press.alpha),
        ),
        on: contrast(bar, composite(bar, tokenOf(block, on.base), on.alpha)),
      };
    });
  }

  it("hover 在 14 种主题组合下都落在 1.10 – 1.21", () => {
    for (const s of samples()) {
      expect(s.hover, s.head).toBeGreaterThanOrEqual(1.1);
      expect(s.hover, s.head).toBeLessThanOrEqual(1.21);
    }
  });

  it("hover 的跨主题极差不大于 0.10", () => {
    // 改造前的实色 token 跨主题极差是 0.27（浅色 1.02、暗色 1.29）。
    const values = samples().map((s) => s.hover);
    const spread = Math.max(...values) - Math.min(...values);
    expect(spread, `实测极差 ${spread.toFixed(3)}`).toBeLessThanOrEqual(0.1);
  });

  it("按下比 hover 更明显，且已开启态在浅色主题下可见", () => {
    for (const s of samples()) {
      expect(s.press, s.head).toBeGreaterThan(s.hover);
      // `--color-accent-muted` 在 7 套浅色主题下只有 1.02–1.06（等于隐形），
      // 这条断言就是防止叠层方案退回那种"看不见的已开启态"。
      expect(s.on, s.head).toBeGreaterThanOrEqual(1.15);
    }
  });
});
