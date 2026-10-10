// 气泡与浮层的配色不变量。
//
// 2026-10-10 第三次改口径：气泡统一到 shadcn 上游默认 —— vendored `TooltipContent` 的
// `bg-primary` / `text-primary-foreground`（选定的皮肤见
// design-docs/2026-10-10-tooltip-skin-preview.html 的 C）。三件事随之变：
//   1) 断言对象从已删除的 `.tt-bubble` 换成 vendored Content 实际在用的类名；
//   2) 气泡取色从 --popover 换成 --primary（那对色就写在 ui/tooltip.tsx 里）；
//   3) --popover 那一对的 14 主题断言**保留** —— 它们现在守的是下拉/浮层
//      （ui/popover、ui/dropdown-menu、ui/sheet 仍在用 bg-popover），不是死代码。
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RENDERER, contrast, themeBlocks, tokenOf } from "./theme-css-helpers";

/** 气泡那一对（vendored Content 用的就是这两个类）。 */
const BUBBLE_BG = "--primary";
const BUBBLE_FG = "--primary-foreground";
/** 浮层那一对（下拉 / 浮层仍在用）。 */
const PANEL_BG = "--popover";
const PANEL_FG = "--popover-foreground";

/**
 * 取某个文件里所有双引号字符串字面量的空白分词结果。
 *
 * 不用 `\b` 匹配类名：`\b` 把 `-` 当边界，`bg-primary` 会连 `bg-primary-foreground`
 * 一起命中 —— 本仓在 `app-button.tsx` 的 `shouldLeftAlign` 上踩过同一个坑。
 */
function classTokens(file: string): Set<string> {
  const source = fs.readFileSync(path.join(RENDERER, file), "utf8");
  return new Set(
    (source.match(/"[^"]*"/g) ?? [])
      .flatMap((q) => q.slice(1, -1).split(/\s+/))
      .filter(Boolean),
  );
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
  it("vendored TooltipContent 用的就是这两条官方类名", () => {
    const tokens = classTokens("components/ui/tooltip.tsx");
    expect(tokens.has("bg-primary"), "气泡底色应取 bg-primary").toBe(true);
    expect(
      tokens.has("text-primary-foreground"),
      "气泡字色应取 text-primary-foreground",
    ).toBe(true);
  });

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
