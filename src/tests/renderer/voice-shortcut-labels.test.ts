import { describe, expect, it } from "vitest";
import en from "../../renderer/i18n/locales/en.json";
import zh from "../../renderer/i18n/locales/zh.json";
import {
  holdKeyNameKey,
  settingsShortcutLabelKey,
  shortcutHintKey,
  shortcutPlatform,
  type ShortcutPlatform,
} from "../../renderer/voice-shortcut-labels";
import { VOICE_SHORTCUTS } from "../../shared/voice-shortcuts";

/** JSON 的叶子键集合，与 `src/tests/i18n/locale-parity.test.ts` 同一套遍历。 */
function leafKeys(value: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return child !== null && typeof child === "object"
      ? leafKeys(child as Record<string, unknown>, path)
      : [path];
  });
}

const ZH_KEYS = new Set(leafKeys(zh as Record<string, unknown>));
const EN_KEYS = new Set(leafKeys(en as Record<string, unknown>));

const PLATFORMS: readonly ShortcutPlatform[] = ["mac", "win"];

describe("shortcutPlatform", () => {
  it("win32 → win，其余（含 darwin 与 undefined）→ mac", () => {
    expect(shortcutPlatform("win32")).toBe("win");
    expect(shortcutPlatform("darwin")).toBe("mac");
    expect(shortcutPlatform(undefined)).toBe("mac");
  });
});

describe("settingsShortcutLabelKey", () => {
  it("每个值 × 每个平台都有键，且两平台不同（disabled 除外）", () => {
    for (const shortcut of VOICE_SHORTCUTS) {
      const [mac, win] = PLATFORMS.map((platform) =>
        settingsShortcutLabelKey(shortcut, platform),
      );
      expect(mac).toBeTruthy();
      if (shortcut === "disabled") expect(win).toBe(mac);
      else expect(win).not.toBe(mac);
    }
  });
});

describe("holdKeyNameKey", () => {
  it("disabled → undefined", () => {
    expect(holdKeyNameKey("disabled", "mac")).toBeUndefined();
    expect(holdKeyNameKey("disabled", "win")).toBeUndefined();
  });

  it("其余值两平台都有键，且两平台不同", () => {
    for (const shortcut of VOICE_SHORTCUTS) {
      if (shortcut === "disabled") continue;
      const [mac, win] = PLATFORMS.map((platform) =>
        holdKeyNameKey(shortcut, platform),
      );
      expect(mac).toBeTruthy();
      expect(win).not.toBe(mac);
    }
  });
});

// 数据表里的键 `renderer-i18n-keys.test.ts` 扫不到（它只看源码里的字面量
// t("…")）。拼错一个键名，今天会原样作为 chat.someKey 出现在气泡里。
describe("气泡文案的 i18n 覆盖", () => {
  it("holdKeyNameKey 返回的键在 zh 与 en 里都存在", () => {
    const keys = VOICE_SHORTCUTS.flatMap((shortcut) =>
      PLATFORMS.map((platform) => holdKeyNameKey(shortcut, platform)),
    ).filter((key): key is string => Boolean(key));

    expect(
      keys.filter((key) => !ZH_KEYS.has(key) || !EN_KEYS.has(key)),
    ).toEqual([]);
  });

  it("句子模板在两侧都有", () => {
    for (const keys of [ZH_KEYS, EN_KEYS]) {
      expect(keys.has("chat.voiceStartWithShortcut")).toBe(true);
    }
  });
});

describe("设置页文案的 i18n 覆盖", () => {
  it("settingsShortcutLabelKey 返回的键在 zh 与 en 里都存在", () => {
    const keys = VOICE_SHORTCUTS.flatMap((shortcut) =>
      PLATFORMS.map((platform) => settingsShortcutLabelKey(shortcut, platform)),
    );

    expect(
      keys.filter((key) => !ZH_KEYS.has(key) || !EN_KEYS.has(key)),
    ).toEqual([]);
  });

  it("行内提示两个平台的键都在", () => {
    const keys = PLATFORMS.map((platform) => shortcutHintKey(platform));

    expect(
      keys.filter((key) => !ZH_KEYS.has(key) || !EN_KEYS.has(key)),
    ).toEqual([]);
  });
});
