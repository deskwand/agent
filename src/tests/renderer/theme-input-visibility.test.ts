// 承重不变量：订阅卡片的 Key 输入框必须在每个主题块下都能被看出来。
// 旧写法是 bg-surface（与卡片同色）+ border-border-muted：填充恒等，边框在
// 深色系 7 个主题只有 1.01–1.05、亮色系 7 个主题 1.15–1.29，字段在卡片里等于不存在。
// 判据取「边框或底色至少一层与卡片底色 --color-surface 拉开对比」，阈值 1.4
// 卡在旧组合的最大值 1.29 与新组合的最小值 1.51 之间（两边各留约 0.1）。
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  RENDERER,
  composite,
  contrast,
  themeBlocks,
  tokenOf,
} from "./theme-css-helpers";

const COMPONENT = fs.readFileSync(
  path.join(RENDERER, "components/settings/coding-subscription-cards.tsx"),
  "utf8",
);

/** 取密码输入框那段 JSX 的 className；定位用 type="password"。 */
function keyInputClassName(source: string): string {
  const start = source.indexOf('type="password"');
  const end = source.indexOf("/>", start);
  // 出现第二个密码框时必须报错而不是默默取第一个（那正是最难的假绿）。
  if (source.indexOf('type="password"', start + 1) >= 0) {
    throw new Error("组件里有多个密码输入框，无法确定取哪一个");
  }
  const match =
    start >= 0 && end > start
      ? /className="([^"]+)"/.exec(source.slice(start, end))
      : null;
  if (!match) throw new Error("组件里找不到密码输入框的 className");
  return match[1];
}

/** tailwind 颜色类 → CSS token：bg-background→--color-background，border-border-muted→--color-border-muted。 */
function colorTokenOf(cls: string, prefix: "bg" | "border"): string {
  const match = new RegExp(`(?:^|\\s)${prefix}-([\\w-]+)(?:\\s|$)`).exec(cls);
  if (!match) throw new Error(`类名里没有 ${prefix}-* 颜色类：${cls}`);
  return `--color-${match[1]}`;
}

/** --color-border 是每个主题块自己的 color-mix()，按 globals.css 的声明解析，不写死 alpha。 */
function resolvedToken(block: string, name: string): string {
  const flat = block.replace(/\s+/g, " ");
  const value = tokenOf(flat, name);
  const mix = /color-mix\(\s*in srgb,\s*var\((--[a-z-]+)\)\s*([\d.]+)%/.exec(
    value,
  );
  if (!mix) return value;
  return composite(
    tokenOf(flat, "--color-surface"),
    tokenOf(flat, mix[1]),
    parseFloat(mix[2]) / 100,
  );
}

describe("订阅 Key 输入框在各主题下的可辨识度", () => {
  const cls = keyInputClassName(COMPONENT);
  const borderToken = colorTokenOf(cls, "border");
  const fillToken = colorTokenOf(cls, "bg");

  // 这一条是有意的「改动探测」：换成别的可见组合时它会红，改 token 时请连同它
  // 一起改 —— 下面那条不变量才是真正的行为判据。
  it("边框与底色都不是卡片自身的颜色", () => {
    expect(borderToken).toBe("--color-border");
    expect(fillToken).toBe("--color-background");
  });

  it("边框宽度在，且 14 个主题块里都至少有一层与卡片底色拉开对比", () => {
    // 只留 border-border（颜色）而没有 border/border-2（宽度），线是画不出来的。
    expect(cls).toMatch(/(?:^|\s)border(?:-\d+)?(?:\s|$)/);
    const blocks = themeBlocks();
    expect(blocks.length).toBe(14);
    for (const block of blocks) {
      const surface = resolvedToken(block, "--color-surface");
      const best = Math.max(
        contrast(resolvedToken(block, borderToken), surface),
        contrast(resolvedToken(block, fillToken), surface),
      );
      const head = block.slice(0, 60).replace(/\s+/g, " ");
      expect(
        best,
        `${head} 下输入框与卡片对比只有 ${best.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(1.4);
    }
  });
});
