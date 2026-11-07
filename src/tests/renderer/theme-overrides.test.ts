// 登记表自身是否合法：只允许覆盖已知预设的已知 token、值必须是 hex。
//
// 为什么单独一个文件：`official-vocabulary.test.ts` 管的是"CSS 与合成值相等"，
// 这张表自己的形状（拼错的 token、非 hex、把 light 也写了）不在那条的射程内。
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  PALETTE_OVERRIDES,
  ZINC_DARK_OVERRIDES,
} from "../../shared/theme-overrides";
import { RENDERER } from "./theme-css-helpers";

const official = JSON.parse(
  fs.readFileSync(path.join(RENDERER, "styles/official-themes.json"), "utf8"),
) as Record<
  string,
  { light: Record<string, string>; dark: Record<string, string> }
>;

describe("登记式改写表", () => {
  it("只覆盖已知预设的已知 token，且值为小写 6 位 hex", () => {
    const bad: string[] = [];
    for (const [preset, modes] of Object.entries(PALETTE_OVERRIDES)) {
      const base = official[preset];
      if (!base) {
        bad.push(`未知预设 ${preset}`);
        continue;
      }
      for (const [mode, tokens] of Object.entries(modes)) {
        const ref = base[mode as "light" | "dark"];
        if (!ref) {
          bad.push(`${preset}/${mode} 不是 light 或 dark`);
          continue;
        }
        for (const [token, value] of Object.entries(tokens ?? {})) {
          if (!(token in ref))
            bad.push(`${preset}/${mode}: 官方没有 --${token}`);
          if (!/^#[0-9a-f]{6}$/.test(value)) {
            bad.push(
              `${preset}/${mode}/--${token}: ${value} 不是小写 6 位 hex`,
            );
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("12 项取值就是 spec §3 定稿的那组", () => {
    // 其余守卫只锁"关系"（对比度门槛、明度差），在门槛内偷偷微调（比如把 #191919 挪到
    // #1c1c1c）不会红。这一条把设计值本身钉死：要改观感必须同时改 spec 与这里。
    expect(ZINC_DARK_OVERRIDES).toEqual({
      background: "#191919",
      foreground: "#f2f2f2",
      card: "#303030",
      "card-foreground": "#f2f2f2",
      popover: "#303030",
      "popover-foreground": "#f2f2f2",
      secondary: "#272624",
      "secondary-foreground": "#f2f2f2",
      muted: "#272624",
      "muted-foreground": "#9c9b99",
      accent: "#272624",
      "accent-foreground": "#f2f2f2",
    });
  });
});
