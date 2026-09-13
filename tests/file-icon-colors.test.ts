import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const stylesPath = path.resolve(
  process.cwd(),
  "src/renderer/styles/globals.css",
);
const source = fs.readFileSync(stylesPath, "utf8");

// 基础深色档是第一个 :root 块，浅色档是紧随其后的 .light 块，
// 之后才是各主题预设块（预设块刻意不声明文件图标 token，让 14 种组合统一继承）。
const lightStart = source.indexOf("\n  .light {");
const presetMatch = /\n\s*:?root\[data-theme-preset=/.exec(source);
const presetStart = presetMatch ? presetMatch.index : -1;

const darkBlock = lightStart > 0 ? source.slice(0, lightStart) : "";
const lightBlock =
  lightStart > 0 && presetStart > lightStart
    ? source.slice(lightStart, presetStart)
    : "";
const presetBlocks = presetStart > 0 ? source.slice(presetStart) : "";

const TOKENS = ["folder", "media", "doc", "code", "audio", "neutral"] as const;

function readToken(block: string, token: string): string | undefined {
  return new RegExp(`--color-file-${token}:\\s*(#[0-9a-fA-F]{3,8})`).exec(
    block,
  )?.[1];
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

/** 相对亮度对比（WCAG），用来确认白字字形在色块上还看得清。 */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrastWithWhite(hex: string): number {
  return 1.05 / (luminance(hex) + 0.05);
}

describe("file icon colour tokens", () => {
  it("resolves the block boundaries it parses", () => {
    // 如果锚点找不到，lightBlock 会吞掉全部预设块（前两条断言照样通过），
    // 而 presetBlocks 退化成空串让「不得重声明」空洞通过。先锁住锚点。
    expect(lightStart).toBeGreaterThan(0);
    expect(presetMatch).not.toBeNull();
    expect(presetStart).toBeGreaterThan(lightStart);
    expect(darkBlock.length).toBeGreaterThan(500);
    expect(lightBlock.length).toBeGreaterThan(500);
    expect(presetBlocks.length).toBeGreaterThan(5000);
  });

  it("declares every token in the dark base block and the light block", () => {
    for (const token of TOKENS) {
      expect(readToken(darkBlock, token)).toBeTruthy();
      expect(readToken(lightBlock, token)).toBeTruthy();
    }
  });

  it("never declares the file tokens inside a theme preset block", () => {
    for (const token of TOKENS) {
      expect(presetBlocks).not.toContain(`--color-file-${token}:`);
    }
  });

  it("uses the Finder blue for folders", () => {
    expect(readToken(darkBlock, "folder")).toBe("#2b86e0");
    expect(readToken(lightBlock, "folder")).toBe("#0b6bcb");
  });

  it("keeps media off the blue band so it cannot collide with folders", () => {
    expect(readToken(darkBlock, "media")).toBe("#f0a63c");
    expect(readToken(lightBlock, "media")).toBe("#b26a00");
  });

  it("keeps every colour pair far enough apart to tell apart at 16px", () => {
    // 这是本次改动的核心依据，所以把它变成断言。反例：media 曾用过 #818cf8，
    // 与 folder #3e9bff 只有 ΔE 18.3、亮度比 1.04（近乎等亮度，红绿色盲下糊成一片）。
    for (const [name, block] of [
      ["dark", darkBlock],
      ["light", lightBlock],
    ] as const) {
      const hexes = TOKENS.map((t) => readToken(block, t) as string);
      for (let i = 0; i < hexes.length; i += 1) {
        for (let j = i + 1; j < hexes.length; j += 1) {
          expect(
            deltaE(hexes[i], hexes[j]),
            `${name}: ${TOKENS[i]} vs ${TOKENS[j]}`,
          ).toBeGreaterThan(30);
        }
      }
    }
  });

  it("keeps white glyphs readable on every tile", () => {
    for (const block of [darkBlock, lightBlock]) {
      for (const token of TOKENS) {
        expect(
          contrastWithWhite(readToken(block, token) as string),
        ).toBeGreaterThan(1.8);
      }
    }
  });
});
