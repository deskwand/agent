// 助手自身的自测：它们要能读懂 oklch（官方取值写法）与 calc 圆角，否则断言会把新值
// 解析成 NaN 而**静默通过**。
//
// 注意：块的解析用例喂**合成 CSS**，不读真实的 globals.css —— Task 1 阶段 globals.css
// 还是旧的 `--color-*` 层，拿它当输入测的是"迁移进度"而不是"助手正确性"。
import { describe, expect, it } from "vitest";
import {
  blockBySelector,
  oklchToRgb,
  parseCssColor,
  parseHex,
  radiusFromCalc,
  tokensOf,
} from "./theme-css-helpers";

describe("oklch 解析", () => {
  it("边界值：oklch(1 0 0) = 白，oklch(0 0 0) = 黑", () => {
    expect(oklchToRgb(1, 0, 0)).toEqual([255, 255, 255]);
    expect(oklchToRgb(0, 0, 0)).toEqual([0, 0, 0]);
  });

  it("官方 zinc 档位换算到已知 hex", () => {
    expect(oklchToRgb(0.21, 0.006, 285.885)).toEqual([24, 24, 27]); // zinc-900 #18181b
    expect(oklchToRgb(0.141, 0.005, 285.823)).toEqual([9, 9, 11]); // zinc-950 #09090b
  });

  it("带 alpha 的两种写法都认", () => {
    expect(parseCssColor("oklch(1 0 0 / 0.1)")?.alpha).toBeCloseTo(0.1);
    expect(parseCssColor("oklch(1 0 0 / 15%)")?.alpha).toBeCloseTo(0.15);
  });

  it("parseHex 也吃得下 oklch（既有调用点无需改）", () => {
    expect(parseHex("oklch(1 0 0)")).toEqual([255, 255, 255]);
    expect(parseHex("#18181b")).toEqual([24, 24, 27]);
  });

  it("认不出的写法返回 null（不静默当成黑色）", () => {
    expect(parseCssColor("var(--background)")).toBeNull();
    expect(parseCssColor("color-mix(in srgb, red, blue)")).toBeNull();
  });
});

describe("块解析", () => {
  const synthetic = `
  :root {
    --background: oklch(1 0 0);
    --foreground: oklch(0.141 0.005 285.823);
  }
  .light[data-theme-preset="mist"] {
    --background: oklch(0.9 0 0);
  }
`;

  it("按选择器取块，且只认 :root / .light 开头", () => {
    expect(tokensOf(blockBySelector(":root", synthetic)!)).toEqual({
      "--background": "oklch(1 0 0)",
      "--foreground": "oklch(0.141 0.005 285.823)",
    });
    expect(
      Object.keys(
        tokensOf(
          blockBySelector('.light[data-theme-preset="mist"]', synthetic)!,
        ),
      ),
    ).toEqual(["--background"]);
    expect(blockBySelector(":root", synthetic)).toBeTruthy();
    // 裸的预设选择器取不到 —— 这正是 themeBlocks 的形状约束
    expect(
      blockBySelector('[data-theme-preset="mist"]', synthetic),
    ).toBeUndefined();
  });

  it("取不到时返回 undefined 而不是抛错（调用方决定怎么报）", () => {
    expect(blockBySelector(".dark", synthetic)).toBeUndefined();
  });
});

describe("calc 圆角换算", () => {
  it("按官方公式换算（--radius = 0.625rem = 10px）", () => {
    expect(radiusFromCalc("calc(var(--radius) * 0.6)", 0.625)).toBe(6);
    expect(radiusFromCalc("calc(var(--radius) * 1)", 0.625)).toBe(10);
    expect(radiusFromCalc("calc(var(--radius) * 1.4)", 0.625)).toBe(14);
  });

  it("裸 px 值原样返回", () => {
    expect(radiusFromCalc("12px", 0.625)).toBe(12);
  });

  it("认不出的写法抛错（不返回 NaN）", () => {
    expect(() => radiusFromCalc("0.5rem", 0.625)).toThrow();
  });
});
