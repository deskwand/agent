// 承重不变量：编辑行里输入框的左缩进，必须与上方文字列（标题/说明/链接）的左缩进相等。
// 两边都是「卡片内边距 + 图标宽度 + 该容器的行间距」，卡片内边距对两者相同，所以只比较后半段：
//   spacerWidth + editRowGap === iconWidth + leftBlockGap
//
// 这一条**有意锁住占位块这个机制**（与 theme-input-visibility.test.ts 的第一条同类）：
// 它同时要求「输入框前恰好一个占位块且紧邻输入框」「输入框自身不带水平偏移类」，
// 因为漏掉任一条就会出现「测试绿、输入框却错位」的假绿：
//   · 删掉占位块 → 缩进少 20px（原始缺陷）
//   · 复制出两个占位块 → 缩进多 20px
//   · 给输入框加 ml-* 或 translate-x-* → 缩进对不上
// 若将来换成 padding/margin 方案（例如行上直接 pl-8），请连同本用例一起改。
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { RENDERER, classNameAt } from "./theme-css-helpers";

const COMPONENT = fs.readFileSync(
  path.join(RENDERER, "components/settings/coding-subscription-cards.tsx"),
  "utf8",
);

const ICON_MARKER = "mt-px h-5 w-5";
const LEFT_BLOCK_MARKER = "min-w-0 items-start gap-3";
const EDIT_ROW_MARKER = "mt-3 flex flex-wrap items-center";

/** 取含 marker 的那段类名；marker 改了（尺寸/间距调整）时给出可操作的报错。 */
function classOf(marker: string, what: string): string {
  if (!COMPONENT.includes(marker)) {
    throw new Error(
      `找不到${what}的类名（marker: ${marker}）—— 若它的尺寸或间距已调整，本用例的断言需同步更新`,
    );
  }
  return classNameAt(COMPONENT, marker, '"');
}

/** Tailwind 间距档位：w-5 → 5，gap-3 → 3（支持 3.5 这类半档）。比较档位而非像素，避免写死 rem 基数。 */
function spacingStep(cls: string, prefix: "w" | "gap"): number {
  const match = new RegExp(`(?:^|\\s)${prefix}-([\\d.]+)(?:\\s|$)`).exec(cls);
  if (!match) throw new Error(`类名里没有 ${prefix}-<n>：${cls}`);
  return Number(match[1]);
}

describe("订阅卡片编辑行与文字列对齐", () => {
  it("左缩进一致：占位宽度 + 编辑行间距 = 图标宽度 + 文字列间距", () => {
    const iconWidth = spacingStep(classOf(ICON_MARKER, "图标"), "w");
    const leftBlockGap = spacingStep(
      classOf(LEFT_BLOCK_MARKER, "文字列"),
      "gap",
    );
    const editRowGap = spacingStep(classOf(EDIT_ROW_MARKER, "编辑行"), "gap");

    // 输入框之前必须恰好一个占位块，且紧邻输入框
    const rowStart = COMPONENT.indexOf(EDIT_ROW_MARKER);
    const inputStart = COMPONENT.indexOf('type="password"', rowStart);
    const inputTagStart = COMPONENT.lastIndexOf("<input", inputStart);
    const beforeInput = COMPONENT.slice(rowStart, inputTagStart);
    const spacers = [...beforeInput.matchAll(/<span[^>]*className="([^"]+)"/g)];

    expect(spacers, "编辑行在输入框之前应当恰好一个占位块").toHaveLength(1);
    expect(
      beforeInput.trimEnd().endsWith("/>"),
      "占位块应紧邻输入框，中间不应再插别的元素",
    ).toBe(true);

    // 输入框自身不得带水平偏移类，否则占位推算出来的缩进就不成立
    const inputClass =
      /className="([^"]+)"/.exec(COMPONENT.slice(inputTagStart))?.[1] ?? "";
    expect(inputClass).not.toMatch(
      /(?:^|\s)-?m[lr]-|(?:^|\s)translate-x-|(?:^|\s)order-/,
    );

    expect(
      spacingStep(spacers[0][1], "w") + editRowGap,
      "编辑行左缩进应与上方文字列一致",
    ).toBe(iconWidth + leftBlockGap);
  });
});
