// 设计文档 §4.1 的承重前提：三个叠层 token 只在 :root 声明一次，值里的 var()
// 由 color-mix() 在使用处解析。这要求主题类与预设属性挂在同一个元素（<html>）上，
// 且每个主题块都自己声明了 --color-text-primary / --color-accent。
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const RENDERER = path.resolve(import.meta.dirname, "../../renderer");

const css = fs.readFileSync(path.join(RENDERER, "styles/globals.css"), "utf8");
// Prettier 会把 color-mix(...) 拆成多行，所以匹配声明时用压平空白后的副本，
// 否则测试会因为格式化而失败。
const cssFlat = css.replace(/\s+/g, " ");
const appTsx = fs.readFileSync(path.join(RENDERER, "App.tsx"), "utf8");

const OVERLAY_TOKENS = [
  "--color-overlay-hover",
  "--color-overlay-press",
  "--color-overlay-on",
] as const;

/** 所有定义了主题的 CSS 块（都声明了 --color-background-secondary）。 */
function themeBlocks(): string[] {
  return (css.match(/^ {2}(?::root|\.light)[^{]*\{[\s\S]*?^ {2}\}/gm) ?? []).filter(
    (b) => /--color-background-secondary\s*:/.test(b),
  );
}

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
});

// ── 叠层强度：把设计文档 §3.4 的实测结论锁成不变量 ──
//
// 阈值的作用是区分"看得见但不刺眼"与两种错法：
//   alpha=0.08 → 暗色会到 1.25（回到改造前的高度，极差 0.10）
//   alpha=0.04 → 浅色会掉到 1.09（又变成看不见）
// 所以上下限 + 极差两个断言缺一不可。

describe("叠层强度不变量", () => {
  function parseHex(value: string): [number, number, number] {
    const h = value.replace("#", "");
    const full =
      h.length === 3
        ? h
            .split("")
            .map((c) => c + c)
            .join("")
        : h;
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [
      number,
      number,
      number,
    ];
  }

  function relativeLuminance(rgb: [number, number, number]): number {
    const [r, g, b] = rgb.map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function contrast(a: string, b: string): number {
    const [x, y] = [
      relativeLuminance(parseHex(a)),
      relativeLuminance(parseHex(b)),
    ];
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }

  /** color-mix(in srgb, fg alpha, transparent) 叠在 base 上的合成结果。 */
  function composite(base: string, fg: string, alpha: number): string {
    const b = parseHex(base);
    const f = parseHex(fg);
    return (
      "#" +
      b
        .map((v, i) =>
          Math.round(v * (1 - alpha) + f[i] * alpha)
            .toString(16)
            .padStart(2, "0"),
        )
        .join("")
    );
  }

  function tokenOf(block: string, name: string): string {
    const m = new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(block);
    if (!m) throw new Error(`主题块缺少 ${name}`);
    return m[1].trim();
  }

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
