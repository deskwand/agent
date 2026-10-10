// 设置页色卡（下拉项与触发器上那一小方块 / 圆点）的取色守卫。
//
// 色卡的颜色不写死在代码里，读的是官方 registry 快照（`styles/official-*.json`）。
// "快照 ↔ globals.css 逐值相等" 这条早已有守卫（official-vocabulary / accent-layer），
// 本文件补的是**色卡查的键**与"CSS 里真正生效的那个键"一致：
// 谁把色卡换成别的变量（比如 palette 那块从"中性中间调"换成该模式的 --ring）、
// 把 default 分支写成别的底色变量，或者把强调色的明暗写死，都会在这里红 ——
// 否则色卡只会默默换个颜色，没人发现。
import { describe, expect, it } from "vitest";
import { VALID_THEME_ACCENTS, VALID_THEME_PRESETS } from "../../shared/theme";
import {
  accentSwatchColor,
  paletteSwatchColor,
} from "../../renderer/utils/theme-swatch";
import { blockBySelector, css, tokenOf } from "./theme-css-helpers";

const MODES = ["dark", "light"] as const;

/** 底色块的选择器约定（zinc 占默认槽位）。 */
function presetSelector(preset: string, mode: (typeof MODES)[number]): string {
  if (preset === "zinc") return mode === "light" ? ".light" : ":root";
  return mode === "light"
    ? `.light[data-theme-preset="${preset}"]`
    : `:root[data-theme-preset="${preset}"]`;
}

/** 某套底色在某模式下某个变量的 CSS 值（缺块直接抛，不静默当成空）。 */
function presetToken(
  preset: string,
  mode: (typeof MODES)[number],
  name: string,
): string {
  const block = blockBySelector(presetSelector(preset, mode));
  if (!block)
    throw new Error(`globals.css 里缺块 ${presetSelector(preset, mode)}`);
  return tokenOf(block, name);
}

/**
 * 强调色块不以 `:root` / `.light` 的"主题块"形状存在（它们没有 --background），
 * 所以按选择器文本自己扫 —— 与 accent-layer.test.ts 同一做法。
 */
function accentBlock(accent: string, mode: (typeof MODES)[number]): string {
  const sel =
    mode === "light"
      ? `.light[data-theme-accent="${accent}"]`
      : `:root[data-theme-accent="${accent}"]`;
  const re = new RegExp(
    `^ {2}${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{[\\s\\S]*?^ {2}\\}`,
    "m",
  );
  const block = re.exec(css)?.[0];
  if (!block) throw new Error(`globals.css 里缺块 ${sel}`);
  return block;
}

describe("色卡取色", () => {
  it("调色板色卡 = 该套配色的中性中间调（暗色 --ring，且它必须等于亮色 --muted-foreground）", () => {
    const mismatched: string[] = [];
    for (const preset of VALID_THEME_PRESETS) {
      const darkRing = presetToken(preset, "dark", "--ring");
      const lightNeutral = presetToken(preset, "light", "--muted-foreground");
      // 色卡不分模式取这一档的前提：官方把同一个中性色放在这两个槽位上。
      // 哪天官方把两档拆开，这条会红 —— 那时才需要按明暗真的选一次。
      if (darkRing !== lightNeutral) {
        mismatched.push(
          `${preset}: 暗色 --ring ${darkRing} ≠ 亮色 --muted-foreground ${lightNeutral}`,
        );
      }
      const got = paletteSwatchColor(preset);
      if (got !== darkRing) {
        mismatched.push(`${preset}: 色卡 ${got} ≠ 中性中间调 ${darkRing}`);
      }
    }
    expect(
      mismatched,
      `调色板色卡与 globals.css 的中性中间调不一致：\n${mismatched.join("\n")}`,
    ).toEqual([]);
  });

  it("强调色色卡 = 该强调色在 CSS 里的 --primary（明暗各取各的）", () => {
    const mismatched: string[] = [];
    for (const accent of VALID_THEME_ACCENTS) {
      if (accent === "default") continue;
      for (const mode of MODES) {
        const expected = tokenOf(accentBlock(accent, mode), "--primary");
        const got = accentSwatchColor(accent, mode, "zinc");
        if (got !== expected) {
          mismatched.push(`${accent}/${mode}: ${got} ≠ ${expected}`);
        }
      }
    }
    expect(
      mismatched,
      `色卡与 accent 块的 --primary 不一致：\n${mismatched.join("\n")}`,
    ).toEqual([]);
  });

  it("default 不叠强调色层 ⇒ 色卡取「当前底色自己的」--primary（不是固定某个底色）", () => {
    const mismatched: string[] = [];
    for (const preset of VALID_THEME_PRESETS) {
      for (const mode of MODES) {
        const expected = presetToken(preset, mode, "--primary");
        const got = accentSwatchColor("default", mode, preset);
        if (got !== expected) {
          mismatched.push(`${preset}/${mode}: ${got} ≠ ${expected}`);
        }
      }
    }
    expect(
      mismatched,
      `default 的色卡没跟着底色走：\n${mismatched.join("\n")}`,
    ).toEqual([]);
  });
});
