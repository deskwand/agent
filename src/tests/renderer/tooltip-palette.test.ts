// 气泡与浮层的配色不变量。
//
// 2026-10-10 第四次改口径：气泡皮肤落在**应用侧**（`app-tooltip.tsx` 的
// `APP_TOOLTIP_SKIN`），取 `--secondary` / `--secondary-foreground`。
//   1) 第一次口径（自造 --tooltip-bg/fg 反色）→ 第二次（官方 --popover）都随实现删除；
//   2) 第三次选的官方 `--primary` 被否掉了 —— 它在深色主题下是近白（离页面底色 15.7:1），
//      用户反馈「太打扰」；
//   3) 现在这一对的实测（全 14 主题）：文字对比 **13.79–16.42**（AA 下限 4.5 ✓），
//      气泡离页面底色 **1.09（浅）/ 1.31–1.37（深）** —— 靠色调差分离，不抢眼。
// 「覆写真的生效」由 app-tooltip-skin.test.tsx 的 DOM 断言守着，本文件只管**颜色**。
// --popover 那一对**保留** —— 它们现在守的是下拉/浮层（ui/popover、ui/dropdown-menu、
// ui/sheet 仍在用 bg-popover），不是死代码。
import { describe, expect, it } from "vitest";
import { contrast, themeBlocks, tokenOf } from "./theme-css-helpers";

/** 气泡那一对（app-tooltip 的 APP_TOOLTIP_SKIN 用的是这两个变量）。 */
const BUBBLE_BG = "--secondary";
const BUBBLE_FG = "--secondary-foreground";
/** 浮层那一对（下拉 / 浮层仍在用）。 */
const PANEL_BG = "--popover";
const PANEL_FG = "--popover-foreground";

/**
 * 某个 token 是否**真的被声明**在这个主题块里。
 *
 * 必须锚在声明开头：`--primary\s*:` 这种松散写法会被 `--sidebar-primary:` 命中而假绿
 *（官方 token 层里 `--sidebar-primary` 与 `--primary` 共用前缀）。
 */
function declares(block: string, name: string): boolean {
  return new RegExp(`(?:^|[\\s;{])${name}\\s*:`).test(block);
}

/** 逐主题算对比度，返回不达 AA 的那些（带主题名，方便看红清单）。 */
function belowAA(fg: string, bg: string): string[] {
  const low: string[] = [];
  for (const block of themeBlocks()) {
    const head = block.slice(0, 60).replace(/\s+/g, " ");
    const ratio = contrast(tokenOf(block, fg), tokenOf(block, bg));
    if (ratio < 4.5) low.push(`${ratio.toFixed(2)}  ${head}`);
  }
  return low;
}

/** 逐主题检查两条声明都在。 */
function missingDecls(bg: string, fg: string): string[] {
  const missing: string[] = [];
  for (const block of themeBlocks()) {
    const head = block.slice(0, 60).replace(/\s+/g, " ");
    if (!declares(block, bg)) missing.push(`${head} 缺 ${bg}`);
    if (!declares(block, fg)) missing.push(`${head} 缺 ${fg}`);
  }
  return missing;
}

describe("气泡与浮层配色", () => {
  it("14 个主题块都声明了气泡那一对官方变量", () => {
    expect(themeBlocks().length).toBe(14);
    expect(missingDecls(BUBBLE_BG, BUBBLE_FG)).toEqual([]);
  });

  it("14 个主题下气泡文字都 ≥ 4.5:1", () => {
    const low = belowAA(BUBBLE_FG, BUBBLE_BG);
    expect(low, `以下主题气泡文字不可读：\n${low.join("\n")}`).toEqual([]);
  });

  it("14 个主题块都声明了浮层那一对（下拉/浮层仍在用）", () => {
    expect(missingDecls(PANEL_BG, PANEL_FG)).toEqual([]);
  });

  it("14 个主题下浮层文字都 ≥ 4.5:1", () => {
    const low = belowAA(PANEL_FG, PANEL_BG);
    expect(low, `以下主题浮层文字不可读：\n${low.join("\n")}`).toEqual([]);
  });
});
