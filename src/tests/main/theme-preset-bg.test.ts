// 主进程那张 preset 背景色表的回归守卫。
//
// 主进程不能用 globals.css 的值（Electron 的 setBackgroundColor / titleBarOverlay 不吃 oklch），
// 所以它自己存了一份 hex —— 手抄就会漂移。这里用仓库自己的解析器从官方快照复算，逐项比对。
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  RENDERER,
  oklchToRgb,
  rgbHex,
  parseCssColor,
} from "../renderer/theme-css-helpers";

const mainSource = fs.readFileSync(
  path.resolve(process.cwd(), "src/main/index.ts"),
  "utf8",
);
const themes = JSON.parse(
  fs.readFileSync(path.join(RENDERER, "styles/official-themes.json"), "utf8"),
) as Record<
  string,
  { light: Record<string, string>; dark: Record<string, string> }
>;

/** 从源码里读 THEME_PRESET_BG 的每一项（不 import 主进程模块）。 */
function tableEntries(): Array<[string, string, string]> {
  const block =
    /const THEME_PRESET_BG[^{]*\{([\s\S]*?)\n\};/.exec(mainSource)?.[1] ?? "";
  expect(block, "src/main/index.ts 里找不到 THEME_PRESET_BG").not.toBe("");
  return [
    ...block.matchAll(
      /(\w+):\s*\{\s*dark:\s*"([^"]+)",\s*light:\s*"([^"]+)"\s*\}/g,
    ),
  ].map((m) => [m[1], m[2], m[3]]);
}

function officialHex(value: string): string {
  const parsed = parseCssColor(value);
  if (!parsed) throw new Error(`解析不了：${value}`);
  return rgbHex(parsed.rgb);
}

describe("主进程的 preset 背景色表", () => {
  it("键就是官方 7 套 id（旧的自造 id 一个不许留）", () => {
    const keys = tableEntries()
      .map(([k]) => k)
      .sort();
    expect(keys).toEqual(Object.keys(themes).sort());
    for (const legacy of [
      "graphite",
      "paper",
      "void",
      "ocean",
      "forest",
      "ember",
      "aurora",
    ]) {
      expect(
        mainSource.includes(`${legacy}: { dark:`),
        `表里还有旧 id ${legacy}`,
      ).toBe(false);
    }
  });

  it("每个 hex 与官方快照的 --background 复算结果一致", () => {
    const bad: string[] = [];
    for (const [id, dark, light] of tableEntries()) {
      const theme = themes[id];
      expect(theme, `官方快照里没有 ${id}`).toBeTruthy();
      const wantDark = officialHex(theme.dark["background"]);
      const wantLight = officialHex(theme.light["background"]);
      if (dark !== wantDark) bad.push(`${id} dark: ${dark} ≠ ${wantDark}`);
      if (light !== wantLight) bad.push(`${id} light: ${light} ≠ ${wantLight}`);
    }
    expect(bad, `表与官方值不一致：\n${bad.join("\n")}`).toEqual([]);
  });

  it("oklch 换算器本身没坏（zinc 暗色 = #09090b）", () => {
    expect(rgbHex(oklchToRgb(0.141, 0.005, 285.823))).toBe("#09090b");
  });
});
