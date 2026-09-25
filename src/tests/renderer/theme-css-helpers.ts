// 共享工具：从渲染层样式与 tailwind 配置里解析 token、算对比度与尺寸。
//
// 由 theme-overlay-tokens.test.ts 与 chat-visual-hierarchy.test.ts 共用。
// 文件名不含 .test. 所以不会被 vitest 当成测试文件收走。
//
// 设计原则：**阈值与色值都不写死在测试里** —— 圆角/字号从 tailwind.config.js 读，
// 颜色从 globals.css 读。这样配置改了测试会跟着动，不会与实现漂移。
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export const RENDERER = path.resolve(import.meta.dirname, "../../renderer");

export const css = fs.readFileSync(
  path.join(RENDERER, "styles/globals.css"),
  "utf8",
);

/** Prettier 会把 color-mix(...) 拆成多行，匹配声明时用压平空白后的副本。 */
export const cssFlat = css.replace(/\s+/g, " ");

export const tailwind = require("../../../tailwind.config.js") as {
  theme: {
    extend: {
      borderRadius: Record<string, string>;
      // tailwind 的 fontSize 值是 [size, { lineHeight, fontWeight }]
      fontSize: Record<string, [string, Record<string, string>]>;
    };
  };
};

/** 所有定义了主题的 CSS 块（都声明了 --color-background-secondary）。 */
export function themeBlocks(source: string = css): string[] {
  return (
    source.match(/^ {2}(?::root|\.light)[^{]*\{[\s\S]*?^ {2}\}/gm) ?? []
  ).filter((b) => /--color-background-secondary\s*:/.test(b));
}

export function tokenOf(block: string, name: string): string {
  const m = new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(block);
  if (!m) throw new Error(`主题块缺少 ${name}`);
  return m[1].trim();
}

/** 取一个只声明一次的全局变量的值（如 --font-size-chat）。 */
export function globalToken(name: string): string {
  const m = new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(css);
  if (!m) throw new Error(`globals.css 里找不到 ${name}`);
  return m[1].trim();
}

export function parseHex(value: string): [number, number, number] {
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

export function rgbHex(rgb: [number, number, number]): string {
  return "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join("");
}

export function relativeLuminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [x, y] = [
    relativeLuminance(parseHex(a)),
    relativeLuminance(parseHex(b)),
  ];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** 同时支持 rgba(r,g,b,a) 与 #rrggbb —— 主题 token 两种形式都有。 */
export function parseAlphaColor(value: string): {
  rgb: [number, number, number];
  alpha: number;
} {
  const m =
    /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\s*\)/.exec(
      value,
    );
  if (m) {
    return {
      rgb: [+m[1], +m[2], +m[3]],
      alpha: m[4] === undefined ? 1 : +m[4],
    };
  }
  const rgb = parseHex(value);
  if (rgb.some(Number.isNaN)) throw new Error(`无法解析颜色：${value}`);
  return { rgb, alpha: 1 };
}

/** fg（hex）以 alpha 叠在 base 上的合成结果。 */
export function composite(base: string, fg: string, alpha: number): string {
  const f = parseHex(fg);
  return rgbHex(
    parseHex(base).map((v, i) =>
      Math.round(v * (1 - alpha) + f[i] * alpha),
    ) as [number, number, number],
  );
}

/**
 * 解出某个主题块里 `--color-background-secondary` 的最终 hex。
 *
 * 它从 2026-09-25 起是 `color-mix(in srgb, var(--color-text-primary) 5%, var(--color-background))`，
 * **不再是字面 hex**（2026-09-25-panel-boundary-design.md §4.1）。
 *
 * 所以不要再把 `tokenOf(block, "--color-background-secondary")` 直接喂给 `contrast()` /
 * `parseHex()` —— 那会静默得到 `NaN`，而 NaN 参与的比较**全部为假**：断言确实会红，
 * 但红成一副"阈值不对"的样子，很容易被误诊（本轮就踩过一次）。
 */
export function backgroundSecondary(block: string): string {
  const value = tokenOf(block, "--color-background-secondary").replace(
    /\s+/g,
    " ",
  );
  const mix =
    /color-mix\(\s*in srgb,\s*var\(--color-text-primary\)\s+([\d.]+)%,\s*var\(--color-background\)\s*\)/.exec(
      value,
    );
  if (!mix) {
    throw new Error(
      `--color-background-secondary 不再是 text-primary/background 的 color-mix，` +
        `用它的地方需要跟着改：${value}`,
    );
  }
  return composite(
    tokenOf(block, "--color-background"),
    tokenOf(block, "--color-text-primary"),
    Number(mix[1]) / 100,
  );
}

/**
 * 从源码里的一个 className 取完整类串。
 *
 * `quote` 传该 className 的收尾定界符：属性值用 `"`，模板字符串用 `` ` ``。
 * **不要用固定窗口长度** —— 窗口拉长会吞进后面元素的类名造成假绿（本仓库踩过）。
 */
export function classNameAt(
  source: string,
  marker: string,
  quote: string,
): string {
  const idx = source.indexOf(marker);
  if (idx < 0) throw new Error(`源码里找不到 ${marker}`);
  // marker 必须唯一。indexOf 取的是第一个匹配，一旦出现第二个（复制出来的 toggle 行、
  // 第二种气泡变体…），断言会静默地跑到别的元素上 —— 那种假绿比报错难查得多。
  if (source.indexOf(marker, idx + marker.length) >= 0) {
    throw new Error(`marker 在源码里出现多次，无法确定取哪一个：${marker}`);
  }
  const end = source.indexOf(quote, idx);
  if (end < 0) throw new Error(`找不到 ${marker} 的收尾 ${quote}`);
  return source.slice(idx, end);
}

// ── tailwind 类名 → 数值 ──
// 全部查 tailwind.config.js，不把 px 写死在测试里。

/** `rounded-xl` → 10（px）。找不到该档位就抛错。 */
export function radiusPx(cls: string): number {
  const m = /(?:^|\s)rounded-([\w]+)(?:\s|$)/.exec(cls);
  if (!m) throw new Error(`未找到 rounded-* 类：${cls}`);
  const v = tailwind.theme.extend.borderRadius[m[1]];
  if (v === undefined)
    throw new Error(`tailwind.config.js 的 borderRadius 里没有 "${m[1]}"`);
  return parseFloat(v);
}

/** `text-sm` → 0.8125（rem）。 */
export function textSizeRem(cls: string): number {
  const m = /(?:^|\s)text-(xs|sm|base|lg|xl|2xl)(?:\s|$)/.exec(cls);
  if (!m) throw new Error(`未找到 text-<size> 类：${cls}`);
  return parseFloat(tailwind.theme.extend.fontSize[m[1]][0]);
}

/** `text-text-muted` → "muted"。 */
export function textColorToken(cls: string): string {
  const m = /(?:^|\s)text-text-(\w+)(?:\s|$)/.exec(cls);
  if (!m) throw new Error(`未找到 text-text-<color> 类：${cls}`);
  return m[1];
}

/** `py-3` → 0.75（rem）。tailwind 默认 spacing 基数 0.25rem，本项目未覆写。 */
export function paddingYRem(cls: string): number {
  const m = /(?:^|\s)py-([\d.]+)(?:\s|$)/.exec(cls);
  if (!m) throw new Error(`未找到 py-* 类：${cls}`);
  return Number(m[1]) * 0.25;
}

/**
 * globals.css 的 html 根字号基数（`calc(16px * var(--ui-font-scale, 1))`，globals.css:435）。
 * 从源码解析而不是写死 16 —— 与本模块「数值不写死在测试里」的原则保持一致。
 * 惰性求值：解析失败只影响调它的那个用例，不会让整个模块一 import 就炸
 * （本模块还被 theme-overlay-tokens.test.ts 共用）。
 */
export function rootPx(): number {
  const m =
    /font-size:\s*calc\((\d+(?:\.\d+)?)px\s*\*\s*var\(--ui-font-scale/.exec(
      css,
    );
  if (!m) {
    throw new Error(
      "globals.css 的 html 上看不到 calc(<n>px * var(--ui-font-scale)) 根字号规则",
    );
  }
  return parseFloat(m[1]);
}

/**
 * CIE Lab 彩度 C = √(a²+b²)。
 *
 * 用来判断 accent 与正文是否"靠色相就能分开"——亮度比在这里是错的工具：
 * #6ea8fe 对 #f4f4f5 的亮度比只有 2.20，但一眼就能分开，分的是色相不是亮度。
 *
 * sRGB → 线性 → XYZ(D65) → Lab，与 relativeLuminance 用同一个 0.03928 阈值。
 */
export function chroma(hex: string): number {
  const [r, g, b] = parseHex(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  let x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  let y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  let z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  [x, y, z] = [f(x), f(y), f(z)];
  const a = 500 * (x - y);
  const bStar = 200 * (y - z);
  return Math.sqrt(a * a + bStar * bStar);
}
