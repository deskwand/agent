// 共享工具：从渲染层样式与 tailwind 配置里解析 token、算对比度与尺寸。
//
// 由多个不变量测试共用。文件名不含 .test. 所以不会被 vitest 当成测试文件收走。
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

/** 所有定义了主题的 CSS 块（2026-10 起：每块声明官方 31 个变量之一 --background-secondary 已不复存在，
 *  改用 --background 作为"这个块是主题块"的判据）。 */
export function themeBlocks(source: string = css): string[] {
  return (
    source.match(/^ {2}(?::root|\.light)[^{]*\{[\s\S]*?^ {2}\}/gm) ?? []
  ).filter((b) => /--background\s*:/.test(b));
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

/** 按选择器取一个主题块（`:root` / `.light` / `:root[data-theme-preset="paper"]` …）。 */
export function blockBySelector(
  selector: string,
  source: string = css,
): string | undefined {
  return themeBlocks(source).find(
    (b) => b.slice(0, b.indexOf("{")).trim() === selector,
  );
}

/** 块内全部自定义属性（值里的换行与多余空白归一）。 */
export function tokensOf(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of block.matchAll(/^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/gm)) {
    out[d[1]] = d[2].trim().replace(/\s+/g, " ");
  }
  return out;
}

/** 官方 7 套 base 的真值快照（`src/renderer/styles/official-themes.json`）。 */
export function officialThemes(): Record<
  string,
  { light: Record<string, string>; dark: Record<string, string> }
> {
  return JSON.parse(
    fs.readFileSync(path.join(RENDERER, "styles/official-themes.json"), "utf8"),
  );
}

// ── 颜色解析 ──
// 2026-10 起主题值写成官方原样的 oklch()，所以解析器必须认它；
// 认不出时返回 null（不要静默当成黑色 —— NaN 参与的比较全为假，红成一副"阈值不对"的样子）。

/** CSS Color 4 的 oklch → sRGB（含 gamut clamp），取整到 0–255。 */
export function oklchToRgb(
  L: number,
  C: number,
  hDeg: number,
): [number, number, number] {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  const enc = (v: number) => {
    const c = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, Math.round(c * 255)));
  };
  return [
    enc(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    enc(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    enc(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

/** 统一颜色解析入口：hex / rgb() / rgba() / oklch(L C H[ / a|a%])。认不出返回 null。 */
export function parseCssColor(
  value: string,
): { rgb: [number, number, number]; alpha: number } | null {
  const v = value.trim();
  const ok =
    /oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+)%?)?\s*\)/.exec(
      v,
    );
  if (ok) {
    const raw =
      ok[4] === undefined
        ? 1
        : v.includes("%")
          ? parseFloat(ok[4]) / 100
          : parseFloat(ok[4]);
    return {
      rgb: oklchToRgb(+ok[1], +ok[2], +ok[3]),
      alpha: Math.max(0, Math.min(1, raw)),
    };
  }
  const rgb =
    /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\s*\)/.exec(
      v,
    );
  if (rgb) {
    return {
      rgb: [+rgb[1], +rgb[2], +rgb[3]],
      alpha: rgb[4] === undefined ? 1 : +rgb[4],
    };
  }
  if (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(v)) {
    const h = v.replace("#", "");
    const full =
      h.length === 3
        ? h
            .split("")
            .map((c) => c + c)
            .join("")
        : h;
    return {
      rgb: [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [
        number,
        number,
        number,
      ],
      alpha: 1,
    };
  }
  return null;
}

export function parseHex(value: string): [number, number, number] {
  const parsed = parseCssColor(value);
  if (!parsed) throw new Error(`无法解析颜色：${value}`);
  return parsed.rgb;
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

/** 同时支持 rgba(r,g,b,a) / oklch(… / a) / #rrggbb —— 主题 token 三种形式都有。 */
export function parseAlphaColor(value: string): {
  rgb: [number, number, number];
  alpha: number;
} {
  const parsed = parseCssColor(value);
  if (!parsed) throw new Error(`无法解析颜色：${value}`);
  return parsed;
}

/** fg 以 alpha 叠在 base 上的合成结果。 */
export function composite(base: string, fg: string, alpha: number): string {
  const f = parseHex(fg);
  return rgbHex(
    parseHex(base).map((v, i) =>
      Math.round(v * (1 - alpha) + f[i] * alpha),
    ) as [number, number, number],
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

/** `calc(var(--radius) * k)` 或裸 px → px 数值。`radiusRem` 传 `--radius` 的 rem 值。 */
export function radiusFromCalc(value: string, radiusRem: number): number {
  const px = /^([\d.]+)px$/.exec(value.trim());
  if (px) return parseFloat(px[1]);
  const calc = /calc\(\s*var\(--radius\)\s*\*\s*([\d.]+)\s*\)/.exec(value);
  if (!calc) throw new Error(`无法解析圆角值：${value}`);
  return radiusRem * 16 * parseFloat(calc[1]);
}

/** `--radius` 的 rem 值（固定语义层声明一次）。 */
function radiusRem(): number {
  const raw = globalToken("--radius");
  const m = /^([\d.]+)rem$/.exec(raw);
  if (!m) throw new Error(`--radius 不是 rem 形式：${raw}`);
  return parseFloat(m[1]);
}

/** `rounded-xl` → 14（px）。支持 calc(var(--radius) * k) 与裸 px 两种写法。 */
export function radiusPx(cls: string): number {
  const m = /(?:^|\s)rounded-([\w]+)(?:\s|$)/.exec(cls);
  if (!m) throw new Error(`未找到 rounded-* 类：${cls}`);
  const v = tailwind.theme.extend.borderRadius[m[1]];
  if (v === undefined)
    throw new Error(`tailwind.config.js 的 borderRadius 里没有 "${m[1]}"`);
  return radiusFromCalc(v, radiusRem());
}

/** `text-sm` → 0.875（rem）。 */
export function textSizeRem(cls: string): number {
  const m = /(?:^|\s)text-(xs|sm|base|lg|xl|2xl)(?:\s|$)/.exec(cls);
  if (!m) throw new Error(`未找到 text-<size> 类：${cls}`);
  return parseFloat(tailwind.theme.extend.fontSize[m[1]][0]);
}

/** 非颜色的 text-* 后缀（尺寸/对齐/换行/截断），取文字色 token 时要跳过它们。 */
const NON_COLOR_TEXT = new Set([
  "xs",
  "sm",
  "base",
  "lg",
  "xl",
  "2xl",
  "3xl",
  "left",
  "right",
  "center",
  "justify",
  "start",
  "end",
  "wrap",
  "nowrap",
  "balance",
  "pretty",
  "ellipsis",
  "clip",
]);

/**
 * 取类串里的文字色 token 名：`text-muted-foreground` → "muted-foreground"；
 * 旧写法 `text-muted-foreground` → "text-muted"（过渡期仍认，便于迁移中途定位残留）。
 * 多个 text-* 类时取第一个能当颜色用的（跳过尺寸/对齐/换行）。
 */
export function textColorToken(cls: string): string {
  for (const m of cls.matchAll(/(?:^|\s)text-([\w-]+)(?=\s|$)/g)) {
    const name = m[1];
    if (NON_COLOR_TEXT.has(name)) continue;
    return name;
  }
  throw new Error(`未找到 text-<color> 类：${cls}`);
}

/** `py-3` → 0.75（rem）。tailwind 默认 spacing 基数 0.25rem，本项目未覆写。 */
export function paddingYRem(cls: string): number {
  const m = /(?:^|\s)py-([\d.]+)(?:\s|$)/.exec(cls);
  if (!m) throw new Error(`未找到 py-* 类：${cls}`);
  return Number(m[1]) * 0.25;
}

/**
 * globals.css 的 html 根字号基数（`calc(16px * var(--ui-font-scale, 1))`）。
 * 从源码解析而不是写死 16 —— 与本模块「数值不写死在测试里」的原则保持一致。
 * 惰性求值：解析失败只影响调它的那个用例，不会让整个模块一 import 就炸。
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
 * 用来判断 accent 与正文是否"靠色相就能分开"——亮度比在这里是错的工具。
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
