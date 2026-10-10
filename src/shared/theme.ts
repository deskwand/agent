/**
 * Theme preset identifiers shared between main and renderer processes.
 *
 * 2026-10-10 起这 7 个 id 就是官方 shadcn 的 7 套 base colour —— 每个 id 对应
 * `globals.css` 里一块逐字粘贴的官方主题（见 design-docs/…-palette-system-design.md）。
 * 加一套新配色 = 加一段官方 CSS + 在这里加一个 id。
 */
export type ThemePreset =
  | "zinc"
  | "neutral"
  | "stone"
  | "mauve"
  | "olive"
  | "mist"
  | "taupe";

/** Runtime validation array — keep in sync with ThemePreset union. */
export const VALID_THEME_PRESETS: ThemePreset[] = [
  "zinc",
  "neutral",
  "stone",
  "mauve",
  "olive",
  "mist",
  "taupe",
];

export const DEFAULT_THEME_PRESET: ThemePreset = "zinc";

/**
 * 旧的（自造）配色 id → 官方 base。
 *
 * 迁移期读旧配置用：老用户的 themePreset 可能是 graphite / paper / …，
 * 按"观感最接近"映射，不要回退成默认值（那会让所有人的主题被悄悄重置）。
 */
const LEGACY_THEME_PRESETS: Record<string, ThemePreset> = {
  graphite: "zinc",
  paper: "taupe",
  void: "neutral",
  ocean: "mist",
  forest: "olive",
  ember: "stone",
  aurora: "mauve",
};

/** 任意输入 → 合法 id（未知值落默认，旧 id 走映射）。 */
export function normalizeThemePreset(raw: unknown): ThemePreset {
  if (typeof raw === "string") {
    if ((VALID_THEME_PRESETS as string[]).includes(raw)) {
      return raw as ThemePreset;
    }
    const mapped = LEGACY_THEME_PRESETS[raw];
    if (mapped) return mapped;
  }
  return DEFAULT_THEME_PRESET;
}

/**
 * 强调色维度 —— 官方 17 套 accent theme。
 *
 * 与 `ThemePreset`（底色）正交：底色给全套 31 个变量，强调色只覆盖
 * `--primary` / `--primary-foreground`（官方另外还给 chart-1..5 与 sidebar-primary(-foreground)，
 * 本仓暂无消费者，留在真值快照里不生成 —— 见 accent 计划 D26）。
 * `"default"` = 不叠强调色，primary 由底色决定。
 */
export type ThemeAccent =
  | "default"
  | "amber"
  | "blue"
  | "cyan"
  | "emerald"
  | "fuchsia"
  | "green"
  | "indigo"
  | "lime"
  | "orange"
  | "pink"
  | "purple"
  | "red"
  | "rose"
  | "sky"
  | "teal"
  | "violet"
  | "yellow";

/** Runtime validation array — keep in sync with ThemeAccent union. */
export const VALID_THEME_ACCENTS: ThemeAccent[] = [
  "default",
  "amber",
  "blue",
  "cyan",
  "emerald",
  "fuchsia",
  "green",
  "indigo",
  "lime",
  "orange",
  "pink",
  "purple",
  "red",
  "rose",
  "sky",
  "teal",
  "violet",
  "yellow",
];

export const DEFAULT_THEME_ACCENT: ThemeAccent = "default";

/** 任意输入 → 合法 id。老配置里没有 themeAccent 字段，缺省落 "default"（不叠）。 */
export function normalizeThemeAccent(raw: unknown): ThemeAccent {
  return typeof raw === "string" &&
    (VALID_THEME_ACCENTS as string[]).includes(raw)
    ? (raw as ThemeAccent)
    : DEFAULT_THEME_ACCENT;
}
