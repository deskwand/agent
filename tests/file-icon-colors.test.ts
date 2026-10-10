import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseHex,
  rgbHex,
} from "../src/tests/renderer/theme-css-helpers";

const stylesPath = path.resolve(
  process.cwd(),
  "src/renderer/styles/globals.css",
);
const tailwindPath = path.resolve(process.cwd(), "tailwind.config.js");
const source = fs.readFileSync(stylesPath, "utf8");
const tailwindSource = fs.readFileSync(tailwindPath, "utf8");

interface Block {
  selector: string;
  body: string;
}

/**
 * 先剥掉注释再切块：注释里出现的 `.light` / `:root` 字样会污染选择器匹配。
 * 不剥的话，Graphite 深色档那个 `:root` 的选择器会带上前面整段注释
 * （其中包含 "light (.light)"），于是它会被当成浅色档。
 *
 * 剥完注释后 globals.css 是扁平的（只有一层 @layer 包裹，块内不再嵌套大括号），
 * 按最内层大括号切块就够：外层 `@layer base {` 切出一个以 "@layer base" 为选择器、
 * 以 "\n  \n  :root " 为 body 的块，它不声明 --background，下面的筛选自然排除。
 */
const css = source.replace(/\/\*[\s\S]*?\*\//g, "");
const BLOCKS: Block[] = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(
  (match) => ({
    selector: match[1].trim().replace(/\s+/g, " "),
    body: match[2],
  }),
);

/**
 * 读一个 token 的 hex —— 2026-10 起取值是官方 oklch 原值，用共享解析器换算成 hex
 * 再做后面的 ΔE / 亮度 / 对比度计算（那些算法都是按 sRGB 写的）。
 * 带 alpha 的值这里只取 rgb 分量（本文件读的三个 token 都不带 alpha）。
 */
function readVar(body: string, name: string): string | undefined {
  const m = new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(body);
  if (!m) return undefined;
  try {
    return rgbHex(parseHex(m[1].trim()));
  } catch {
    return undefined;
  }
}

/** 有专属色值的 5 个文件类型 token（folder 已改走 --muted-foreground） */
const FILE_TOKENS = ["media", "doc", "code", "audio", "neutral"] as const;

/**
 * 两个基础档：声明了 --background、且不是预设块。
 * 文件开头还有一个只声明 --success-foreground 的 :root，靠这个条件区分；
 * 浅色档靠选择器里的 `.light` 区分。
 */
const baseBlocks = BLOCKS.filter(
  (block) =>
    !block.selector.includes("data-theme-preset=") &&
    readVar(block.body, "--background"),
);
const darkBase = baseBlocks.find((block) => !block.selector.includes(".light"));
const lightBase = baseBlocks.find((block) => block.selector.includes(".light"));
const presetBlocks = BLOCKS.filter((block) =>
  block.selector.includes("data-theme-preset="),
);

/** 14 档 = 2 个基础档 + 6 预设 × 浅深。浅色档的选择器一律带 `.light`。 */
const themeCombos = [darkBase, lightBase, ...presetBlocks]
  .filter((block): block is Block => Boolean(block))
  .map((block) => ({
    block,
    selector: block.selector,
    isLight: block.selector.includes(".light"),
    background: readVar(block.body, "--background") as string,
  }));

type ThemeCombo = (typeof themeCombos)[number];

/**
 * 2026-10-10：文件类型色搬进了**固定语义层**（顶层未被 @layer 包裹的 :root / :root.light），
 * 不再逐主题块声明 —— 它们是语义色，不该随调色板变。所以这两档要单独取。
 */
const fixedDark = BLOCKS.find(
  // 第一块的 selector 会带上文件开头的 `@tailwind base; …` 前缀（切块方式的副产物），
  // 所以用 endsWith 而不是相等。
  (b) => b.selector.endsWith(":root") && readVar(b.body, "--file-media"),
);
const fixedLight = BLOCKS.find(
  (b) => b.selector === ":root.light" && readVar(b.body, "--file-media"),
);

/** 一个档位下所有图标颜色：文件夹的 text token + 5 个文件 token。 */
function iconColoursFor(combo: ThemeCombo): Array<[string, string]> {
  const block = combo.isLight ? fixedLight! : fixedDark!;
  return [
    // 每个预设块都会重声明 --muted-foreground，所以文件夹色必须取**它自己那一档**的块
    ["folder", readVar(combo.block.body, "--muted-foreground") as string],
    ...FILE_TOKENS.map(
      (token) =>
        [token, readVar(block.body, `--file-${token}`) as string] as [
          string,
          string,
        ],
    ),
  ];
}

function toLab(hex: string): [number, number, number] {
  const srgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = srgb.map((c) =>
    c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

/** CIE76 色差：>~30 才算肉眼容易区分。 */
function deltaE(a: string, b: string): number {
  const [l1, a1, b1] = toLab(a);
  const [l2, a2, b2] = toLab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/** 相对亮度（WCAG）。 */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 对比度（1–21）。描边图标属于「非文字图形」，下限 3.0。 */
function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

describe("file icon colour tokens", () => {
  it("parses the blocks it needs", () => {
    // 锚点找不到时下面几条会静默变松，先把锚点锁住。
    expect(darkBase, "dark base block").toBeTruthy();
    expect(lightBase, "light base block").toBeTruthy();
    expect(presetBlocks.length).toBeGreaterThanOrEqual(12);
    expect(themeCombos.length).toBeGreaterThanOrEqual(14);
    for (const combo of themeCombos) {
      expect(combo.background, combo.selector).toBeTruthy();
    }
  });

  it("declares every file token in both fixed-layer blocks", () => {
    expect(fixedDark, "固定语义层的暗色块").toBeTruthy();
    expect(fixedLight, "固定语义层的亮色块").toBeTruthy();
    for (const token of FILE_TOKENS) {
      expect(readVar(fixedDark!.body, `--file-${token}`)).toBeTruthy();
      expect(readVar(fixedLight!.body, `--file-${token}`)).toBeTruthy();
    }
  });

  it("no longer has a folder colour token anywhere", () => {
    // 文件夹改走 --muted-foreground 之后 --file-folder 就是死 token。
    // 这条把「文件夹不再独占语义色」钉死，防止它被顺手加回来。
    // 断言的是剥掉注释的 css：将来若有注释提到这个旧 token（解释历史）不应误报。
    expect(css).not.toContain("--file-folder");
    expect(tailwindSource).not.toContain("--file-folder");
  });

  it("never declares the file tokens inside a theme preset block", () => {
    for (const block of presetBlocks) {
      expect(block.body, block.selector).not.toContain("--file-");
    }
  });

  it("keeps every colour pair far enough apart to tell apart at 16px", () => {
    // 只对 5 个文件色成立。文件夹的灰与 neutral（压缩包/通用文件）的灰
    // ΔE 只有 7.7–12.6，靠字形区分——这是方案 A 的既定代价，见设计文档 §3.2。
    // 文件色在固定语义层（不随主题块），所以取 fixed* 而不是 darkBase/lightBase。
    for (const [name, block] of [
      ["dark", fixedDark!],
      ["light", fixedLight!],
    ] as const) {
      const hexes = FILE_TOKENS.map(
        (token) => readVar(block.body, `--file-${token}`) as string,
      );
      for (let i = 0; i < hexes.length; i += 1) {
        for (let j = i + 1; j < hexes.length; j += 1) {
          expect(
            deltaE(hexes[i], hexes[j]),
            `${name}: ${FILE_TOKENS[i]} vs ${FILE_TOKENS[j]}`,
          ).toBeGreaterThan(30);
        }
      }
    }
  });

  it("reads the folder colour from each theme's own block", () => {
    // 每个预设块都会重声明 --muted-foreground，所以文件夹色必须逐档取；
    // 退回「按浅深取基础档」会漏掉 12 个预设自己的值。
    for (const combo of themeCombos) {
      const own = readVar(combo.block.body, "--muted-foreground") as string;
      expect(own, combo.selector).toBeTruthy();
      expect(iconColoursFor(combo), combo.selector).toContainEqual([
        "folder",
        own,
      ]);
    }
  });

  it("keeps every icon colour readable on all 14 theme backgrounds", () => {
    // 换成描边之后，「白字在色块上可读」已经没有对象了；新的不变量是
    // 每种图标颜色对**它自己那一档的背景**都要够亮/够暗。
    // 已知最低值 3.59（aurora 浅 · doc 绿），所以 3.0 这条线是有余量的。
    for (const combo of themeCombos) {
      for (const [label, colour] of iconColoursFor(combo)) {
        expect(
          contrast(colour, combo.background),
          `${combo.selector} · ${label}`,
        ).toBeGreaterThanOrEqual(3);
      }
    }
  });
});
