// 气泡与浮层的配色不变量。
//
// 2026-10-10 的口径：气泡皮肤落在**应用侧**（`app-tooltip.tsx` 的 `APP_TOOLTIP_SKIN`）。
// 前三次口径（自造 --tooltip-bg/fg 反色 → 官方 --popover → 官方 --primary）都随实现删除或
// 被否：`--primary` 在深色下是近白（离页面底色 15.7:1），用户反馈「太打扰」。
//
// ⚠️ **本文件不写死 token 名**（审查员 2026-10-10 指出）：早先的版本把 `--secondary` 写在
// 常量里，于是把 `APP_TOOLTIP_SKIN` 改成 `bg-accent` 之后，本文件会继续替 `--secondary`
// 算 14 套对比度并全绿 —— 一份名为「气泡配色」的守卫静默地不再守气泡 ✗。
// ⇒ 现在从 `app-tooltip.tsx` **反推**类名 → token，两侧任一改动都会对撞 ✓。
// 「覆写真的生效」由 app-tooltip-skin.test.tsx 的 DOM 断言守着，本文件只管**颜色**。
// --popover 那一对**保留** —— 它守的是下拉/浮层（ui/popover、ui/dropdown-menu、ui/sheet
// 仍在用 bg-popover），不是死代码。
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RENDERER, contrast, themeBlocks, tokenOf } from "./theme-css-helpers";

/** 浮层那一对（下拉 / 浮层仍在用）。 */
const PANEL_BG = "--popover";
const PANEL_FG = "--popover-foreground";

/** 从 `app-tooltip.tsx` 读出 `APP_TOOLTIP_SKIN` 的字面量。 */
function readSkin(): string {
  const source = fs.readFileSync(
    path.join(RENDERER, "components/app-tooltip.tsx"),
    "utf8",
  );
  const m = /const APP_TOOLTIP_SKIN =\s*\n?\s*"([^"]*)"/.exec(source);
  expect(m, "app-tooltip.tsx 里找不到 APP_TOOLTIP_SKIN").not.toBeNull();
  return m![1];
}

/**
 * 把皮肤里的 `bg-x` / `text-x` 映射回 CSS 变量名（`--x`）。
 *
 * 只看以 `bg-` / `text-` **开头**的 token ⇒ `shadow-elevated`、`hover:bg-x` 之类
 * 天然被跳过，不会误当成颜色。
 */
function skinTokens(skin: string): { bg: string; fg: string } {
  const tokens = skin.split(/\s+/).filter(Boolean);
  const bg = tokens.find((t) => t.startsWith("bg-"))?.slice(3);
  const fg = tokens.find((t) => t.startsWith("text-"))?.slice(5);
  expect(bg, `皮肤里找不到 bg-*：${skin}`).toBeTruthy();
  expect(fg, `皮肤里找不到 text-*：${skin}`).toBeTruthy();
  return { bg: `--${bg}`, fg: `--${fg}` };
}

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
  it("气泡皮肤反推出来的 token 在 14 个主题块里都有声明", () => {
    expect(themeBlocks().length).toBe(14);
    const { bg, fg } = skinTokens(readSkin());
    expect(missingDecls(bg, fg)).toEqual([]);
  });

  it("14 个主题下气泡文字都 ≥ 4.5:1", () => {
    const { bg, fg } = skinTokens(readSkin());
    const low = belowAA(fg, bg);
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
