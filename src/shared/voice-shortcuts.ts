/**
 * @module shared/voice-shortcuts
 *
 * 「按住说话」的快捷键白名单。放共享层的原因：主进程的 normalizeVoiceEngineConfig
 * 要用它做校验，渲染层的设置界面要用它渲染选项，而渲染进程不能 import 主进程模块。
 *
 * 没有 Fn：Electron 的 globalShortcut 没有 Fn accelerator；Fn 在 macOS 只以
 * `NSEvent.ModifierFlags.function` 存在（需原生代码）；而且外接键盘可能根本
 * 不发 Fn 键码（Logitech 官方说明）。右 Option 是对齐微信电脑端「长按右 Alt」
 * 的可行替代。
 */
export const VOICE_SHORTCUTS = [
  "AltRight",
  "AltSpace",
  "MetaShiftSpace",
  "disabled",
] as const;

export type VoiceShortcut = (typeof VOICE_SHORTCUTS)[number];

export const DEFAULT_VOICE_SHORTCUT: VoiceShortcut = "AltRight";

/**
 * 语音模式的开关快捷键。**与按住说话分开**：两边选到同一个键就是冲突。
 *
 * 固定值，不进设置：设置区只暴露一个静音时长（设计 §3）。哪天要开放，
 * 照上面 VOICE_SHORTCUTS 的写法扩一个独立白名单，不要复用这一个。
 */
export const VOICE_MODE_SHORTCUT = "MetaShiftSpace";

export function isVoiceShortcut(value: unknown): value is VoiceShortcut {
  return (
    typeof value === "string" &&
    (VOICE_SHORTCUTS as readonly string[]).includes(value)
  );
}
