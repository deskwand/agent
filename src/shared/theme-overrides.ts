import type { ThemePreset } from "./theme";

/**
 * 本仓对官方配色的**登记式改写**。
 *
 * 为什么不直接把值写进 `src/renderer/styles/official-themes.json`：那份快照是官方
 * registry 的逐字副本，`official-vocabulary.test.ts` 用它做"把官方 CSS 贴回来仍全绿"
 * 的判据。把本仓取值写进去，以后官方更新时分不清"官方改的"和"我们改的"。
 *
 * 所以差异留在这里逐项登记；守卫按"快照 + 本表"合成后比对 CSS，并额外断言本表的
 * key 集合精确等于 spec §3 那 12 项 —— 多一项少一项都要红。
 *
 * 值为 **hex**，两个原因：
 * 1. 主进程的 `THEME_PRESET_BG` 需要 hex（Electron 的 setBackgroundColor 不吃 oklch）；
 * 2. 守卫是**字符串相等**比对，所以 `globals.css` 的 zinc/dark 块里必须逐字写成同样的 hex。
 *
 * 正文取 #f2f2f2（不是参考图量到的 #eeeeee）：`::highlight(tts)` 用
 * `--primary-text 40% + background` 混高亮底，画布抬到 #191919 后 #ededed 只剩 4.42（守卫要 ≥4.5）。
 *
 * 只改底色与文字这一层：`--primary` / `--border` / `--input` / `--ring` / `--chart-*` /
 * `--destructive` / `--sidebar-*` 保持官方值（理由见 spec §7）。
 */
export const ZINC_DARK_OVERRIDES = {
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
} as const satisfies Record<string, string>;

export type PaletteOverride = {
  light?: Record<string, string>;
  dark?: Record<string, string>;
};

/**
 * 预设 id 受 `ThemePreset` 约束：写错一个 id（`zince`）是编译错误，而不是运行时静默不生效。
 * 用 `Partial` 是因为合法的状态就是"大部分预设没有改写"。
 */
const OVERRIDES: Partial<Record<ThemePreset, PaletteOverride>> = {
  zinc: { dark: ZINC_DARK_OVERRIDES },
};

export const PALETTE_OVERRIDES = OVERRIDES;

/** 官方快照 + 本表 = 这个主题块**应该**长成什么样（守卫与主进程共用）。 */
export function withPaletteOverrides(
  preset: string,
  mode: "light" | "dark",
  official: Record<string, string>,
): Record<string, string> {
  // 调用方（测试与主进程）传的是字符串；未知 id 就是"没有改写"，不需要报错。
  const override = OVERRIDES[preset as ThemePreset]?.[mode];
  return override ? { ...official, ...override } : { ...official };
}
