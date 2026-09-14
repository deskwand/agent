// 设计文档 design-docs/2026-09-13-chat-visual-hierarchy-design.md 的不变量。
//
// 三处改动都不改运行时逻辑，所以这里锁的是可计算的量：
//   1. 行内代码底块边界 —— 在全部 14 套主题下的真实对比度
//   2. 用户气泡形状 —— 圆角 / 最小高度的比例（不是"类名等于某个值"）
//   3. 侧栏层级 —— 分组的字号必须真的小于导航项、颜色必须不与辅助元素撞档
// 圆角与字号的数值一律从 tailwind.config.js 读，颜色从 globals.css 读，不写死在断言里。
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  RENDERER,
  classNameAt,
  composite,
  contrast,
  css,
  globalToken,
  paddingYRem,
  parseAlphaColor,
  radiusPx,
  rgbHex,
  rootPx,
  themeBlocks,
  tokenOf,
} from "./theme-css-helpers";

const messageCard = fs.readFileSync(
  path.join(RENDERER, "components/MessageCard.tsx"),
  "utf8",
);
/** 行内代码那条规则全文。找不到就抛错 —— 这本身就是回归信号。 */
function inlineCodeRule(): string {
  const m = /\.prose-chat :not\(pre\) > code\s*\{[\s\S]*?\}/.exec(css);
  if (!m) throw new Error("globals.css 里找不到 .prose-chat :not(pre) > code");
  return m[0];
}

/**
 * 从 CSS 规则本身取出边框用的 token 名。
 *
 * 关键：必须读规则，不能只从 token 算对比度 —— 否则把 border 声明删掉，
 * 测试依然会绿（甚至静默地拿 --color-surface-muted 当边框色去算），锁不住任何东西。
 * 规则里没有边框就在这里抛错，让 RED 状态报得清楚。
 */
function inlineCodeBorderToken(): string {
  const m = /border\s*:\s*1px\s+solid\s+var\((--[\w-]+)\)/.exec(
    inlineCodeRule(),
  );
  if (!m) throw new Error("行内代码规则内未声明边框，底块边界仍不可见");
  return m[1];
}

/** 某个主题下，底块边框合成后相对背景的对比度。 */
function chipEdgeContrast(block: string, token: string): number {
  const bg = tokenOf(block, "--color-background");
  const chip = tokenOf(block, "--color-surface-muted");
  const border = parseAlphaColor(tokenOf(block, token));
  // 边框画在元素自身背景之上（background-clip 默认 border-box）。
  return contrast(composite(chip, rgbHex(border.rgb), border.alpha), bg);
}

describe("行内代码底块边界不变量", () => {
  it("14 个主题块都声明了底块边界依赖的 token", () => {
    const blocks = themeBlocks();
    expect(blocks.length).toBe(14);
    // 边框 token 从 CSS 规则里读，不写死 —— 否则有人把规则换成别的 token 时，
    // 这条会继续断言一个已经没人用的 token。
    const borderToken = inlineCodeBorderToken();
    for (const block of blocks) {
      const head = block.slice(0, 60).replace(/\s+/g, " ");
      for (const token of [
        "--color-background",
        "--color-surface-muted",
        borderToken,
      ]) {
        expect(block, `${head} 缺 ${token}`).toMatch(
          new RegExp(`${token}\\s*:`),
        );
      }
    }
  });

  it("加边框后边界在 14 套主题下都可见（对比度 ≥ 1.10）", () => {
    // 为什么必须靠边框：底块填色 --color-surface-muted 在 14 套主题下与背景的对比度
    // 只有 1.017–1.062（均 < 1.10），写了等于没写 —— 详见设计文档改动 2。
    // 这里不去断言"填色必须看不见"：那是当前事实，不是需求，
    // 将来若有人把填色做真了（正确做法），不应该被本测试拦住。
    const token = inlineCodeBorderToken();
    for (const block of themeBlocks()) {
      const head = block.slice(0, 60).replace(/\s+/g, " ");
      expect(chipEdgeContrast(block, token), head).toBeGreaterThanOrEqual(1.1);
    }
  });

  it("边框必须比填色本身更可见（无阈值，不依赖 1.10 这个数）", () => {
    // 这是「加边框」真正的理由，而且不需要任何阈值：只要「有边框」比「没边框」更可辨，
    // 改动就成立。1.10 只是把"能不能看见"量化，各主题实测最小余量 ≥ 0.110。
    const token = inlineCodeBorderToken();
    for (const block of themeBlocks()) {
      const head = block.slice(0, 60).replace(/\s+/g, " ");
      const bg = tokenOf(block, "--color-background");
      const fill = contrast(tokenOf(block, "--color-surface-muted"), bg);
      expect(chipEdgeContrast(block, token), head).toBeGreaterThan(fill);
    }
  });

  it("边界的跨主题极差不大于 0.10", () => {
    // --color-border-subtle 是按极性定义的 alpha，天然把 14 套主题归一化。
    // 这条断言把"边界保持轻"这个设计决策锁死：换成 --color-border 会到 0.123 而失败，
    // 换之前必须连同本断言一起改（这是预期行为，见设计文档改动 2）。
    const token = inlineCodeBorderToken();
    const values = themeBlocks().map((b) => chipEdgeContrast(b, token));
    const spread = Math.max(...values) - Math.min(...values);
    expect(spread, `实测极差 ${spread.toFixed(3)}`).toBeLessThanOrEqual(0.1);
  });
});

describe("用户气泡：形状不随消息长度漂移", () => {
  const bubble = classNameAt(messageCard, "message-user", "`");

  /**
   * 单行气泡的最小高度 = 行盒 + 上下 padding。
   * 高度随消息行数线性增长，而圆角是固定 px —— 两者之比才会随内容变化，
   * 所以这里算的是比值，不是某个具体圆角档位。
   */
  function minHeightPx(cls: string): number {
    const fontRem = parseFloat(globalToken("--font-size-chat"));
    const lineHeight = parseFloat(globalToken("--line-height-chat"));
    return fontRem * lineHeight * rootPx() + paddingYRem(cls) * rootPx() * 2;
  }

  it("气泡只声明一个圆角类（生效值不依赖层级优先级）", () => {
    // 这个 bug 的根因就是 .message-user 声明了 rounded-2xl，却在 @layer components
    // 被 utility 层的 rounded-5xl 覆盖。只要气泡自身恰好有一个圆角类，
    // 下面那条比例断言算的就是真正生效的值，而不是某个被覆盖的声明。
    // 断言"数量"而不是"存在"：0 个（回落到 .message-user）或 ≥2 个
    // （谁生效看层级顺序）都会让生效值变得不确定。
    const radii = bubble.match(/(?:^|\s)rounded-[\w]+(?=\s|$)/g) ?? [];
    expect(
      radii.length,
      `气泡声明了 ${radii.length} 个圆角类：${JSON.stringify(radii)}`,
    ).toBe(1);
  });

  it("单行气泡的圆角 / 最小高度 ≤ 0.40（不落入胶囊区间）", () => {
    const ratio = radiusPx(bubble) / minHeightPx(bubble);
    // 几何上 0.5 就是胶囊（圆角等于半高）。取 0.40 留出余量：
    //   5xl(24px)/45px = 0.533 → 失败（这就是修复前的状态）
    //   4xl(20px)/45px = 0.444 → 失败
    //   3xl(16px)/45px = 0.356 / 2xl(14px)=0.311 / xl(10px)=0.222 → 通过
    expect(
      ratio,
      `圆角 ${radiusPx(bubble)}px / 最小高度 ${minHeightPx(bubble)}px = ${ratio.toFixed(3)}`,
    ).toBeLessThanOrEqual(0.4);
  });
});
