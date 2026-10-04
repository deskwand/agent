/**
 * @module renderer/voice-shortcut-labels
 *
 * 「按住说话」的显示文案：值 × 平台 → i18n 键。
 *
 * 为什么单独一个模块：设置页与麦克风气泡都要按平台选键名，平台归一化只该有一处。
 * 不放进 `src/shared/voice-shortcuts.ts`：那个模块服务主进程的配置校验，与应用
 * 文案无关（设计 §2.1）。
 *
 * 这里只吐**键**，不翻译：模块保持无 React、无 i18next，测试不需要桩。
 */
import type { VoiceShortcut } from "../shared/voice-shortcuts";

export type ShortcutPlatform = "mac" | "win";

/** 仓库只出 Windows 与 macOS 两个包；认不出的平台按 mac 走（设计 §2.1）。 */
export function shortcutPlatform(raw: string | undefined): ShortcutPlatform {
  return raw === "win32" ? "win" : "mac";
}

/** 设置页下拉的选项文案。`disabled` 这句两平台相同。 */
const SETTINGS_LABEL_KEYS: Record<
  VoiceShortcut,
  Record<ShortcutPlatform, string>
> = {
  AltRight: {
    mac: "settings.capabilities.voice.shortcutAltRightMac",
    win: "settings.capabilities.voice.shortcutAltRightWin",
  },
  AltSpace: {
    mac: "settings.capabilities.voice.shortcutAltSpaceMac",
    win: "settings.capabilities.voice.shortcutAltSpaceWin",
  },
  MetaShiftSpace: {
    mac: "settings.capabilities.voice.shortcutMetaShiftSpaceMac",
    win: "settings.capabilities.voice.shortcutMetaShiftSpaceWin",
  },
  disabled: {
    mac: "settings.capabilities.voice.shortcutDisabled",
    win: "settings.capabilities.voice.shortcutDisabled",
  },
};

export function settingsShortcutLabelKey(
  shortcut: VoiceShortcut,
  platform: ShortcutPlatform,
): string {
  return SETTINGS_LABEL_KEYS[shortcut][platform];
}

/** 设置页那行提示的键。两个平台各一句（Windows 那句不提微信，见设计 §5）。 */
const SHORTCUT_HINT_KEYS: Record<ShortcutPlatform, string> = {
  mac: "settings.capabilities.voice.shortcutFnHintMac",
  win: "settings.capabilities.voice.shortcutFnHintWin",
};

export function shortcutHintKey(platform: ShortcutPlatform): string {
  return SHORTCUT_HINT_KEYS[platform];
}

/** 气泡里的键名：紧凑写法（不带 `+`），因为它嵌在句子里。`disabled` = 不提。 */
const HOLD_KEY_NAME_KEYS: Record<
  Exclude<VoiceShortcut, "disabled">,
  Record<ShortcutPlatform, string>
> = {
  AltRight: {
    mac: "chat.voiceHoldKeyAltRightMac",
    win: "chat.voiceHoldKeyAltRightWin",
  },
  AltSpace: {
    mac: "chat.voiceHoldKeyAltSpaceMac",
    win: "chat.voiceHoldKeyAltSpaceWin",
  },
  MetaShiftSpace: {
    mac: "chat.voiceHoldKeyMetaShiftSpaceMac",
    win: "chat.voiceHoldKeyMetaShiftSpaceWin",
  },
};

export function holdKeyNameKey(
  shortcut: VoiceShortcut,
  platform: ShortcutPlatform,
): string | undefined {
  if (shortcut === "disabled") return undefined;
  return HOLD_KEY_NAME_KEYS[shortcut][platform];
}
