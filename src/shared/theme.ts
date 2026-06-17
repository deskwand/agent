/** Theme preset identifiers shared between main and renderer processes. */
export type ThemePreset =
  | "graphite"
  | "paper"
  | "void"
  | "ocean"
  | "forest"
  | "ember"
  | "aurora";

/** Runtime validation array — keep in sync with ThemePreset union. */
export const VALID_THEME_PRESETS: ThemePreset[] = [
  "graphite",
  "paper",
  "void",
  "ocean",
  "forest",
  "ember",
  "aurora",
];
