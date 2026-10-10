import { describe, expect, it } from "vitest";

import {
  DEFAULT_THEME_PRESET,
  normalizeThemePreset,
  VALID_THEME_PRESETS,
} from "../../shared/theme";

describe("palette id 迁移", () => {
  // 旧 id 必须落到"最接近的官方 base"，不能回退成默认值 —— 否则升级后
  // 用户的主题会被静默重置（观感突变且没有任何提示）。
  const legacy: Array<[string, string]> = [
    ["zinc", "zinc"],
    ["paper", "taupe"],
    ["void", "neutral"],
    ["ocean", "mist"],
    ["forest", "olive"],
    ["ember", "stone"],
    ["aurora", "mauve"],
  ];
  for (const [old, next] of legacy) {
    it(`${old} → ${next}`, () => {
      expect(normalizeThemePreset(old)).toBe(next);
    });
  }

  it("新 id 原样通过", () => {
    for (const id of VALID_THEME_PRESETS) {
      expect(normalizeThemePreset(id)).toBe(id);
    }
  });

  it("垃圾值 / 空值落默认", () => {
    expect(normalizeThemePreset("nope")).toBe(DEFAULT_THEME_PRESET);
    expect(normalizeThemePreset(undefined)).toBe(DEFAULT_THEME_PRESET);
    expect(normalizeThemePreset(42)).toBe(DEFAULT_THEME_PRESET);
  });
});
