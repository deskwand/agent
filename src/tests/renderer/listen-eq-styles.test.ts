/**
 * @module tests/renderer/listen-eq-styles
 *
 * 「正在收听」音条的样式回归。锁两条**真不变量**：
 *
 *  1. 三根条各有**不同的静态高度**且不为 0 —— reduced-motion 会把动画打成 0.01ms、
 *     次数 1，那一帧停在 scaleY(0.7)，读到的就是这三个高度的 0.7 倍；三根等高会像
 *     加载失败。
 *  2. 动画走 transform（合成器），不走 height（每帧布局）—— 这是 globals.css
 *     自己写的「compositor-only, 60fps」要求。
 *
 * 刻意**不**断言的两条（2026-10-09 评审）：keyframes 在 reduced-motion 块之前（那块是
 * `*` + `!important`，顺序无关，钉住它只会拦住将来看似无害的挪动）；以及「不许出现
 * --motion-*」（那是风格选择，不是行为）。
 *
 * 另外：Tailwind 会按 content 扫描裁剪 `@layer components` 里的规则，源码文本断言看不出
 * 裁剪结果 —— 「音条真的在动」只能靠 dev 里实测。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  join(process.cwd(), "src/renderer/styles/globals.css"),
  "utf8",
);

/** 第 n 根条的静态高度（px）。读不到就返回 NaN —— 断言会带着它一起失败。 */
function barHeight(n: number): number {
  const block = css.match(
    new RegExp(`\\.listen-eq-bar:nth-child\\(${n}\\)\\s*\\{([^}]*)\\}`),
  )?.[1];
  return Number(block?.match(/height:\s*(\d+)px/)?.[1]);
}

describe("收听音条样式", () => {
  it("三根条静态高度互不相同、都不为 0", () => {
    const heights = [1, 2, 3].map(barHeight);
    expect(heights.every((h) => Number.isFinite(h) && h > 0)).toBe(true);
    expect(new Set(heights).size).toBe(3);
  });

  it("动画在 transform 上，不在 height 上", () => {
    const keyframes =
      css.match(/@keyframes listen-eq-bounce\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(keyframes).toContain("transform: scaleY(");
    expect(keyframes).not.toContain("height:");
  });
});
