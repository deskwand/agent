/**
 * 系统能力（不是外部服务）的权限状态。
 *
 * Computer Use 靠合成鼠标键盘事件与截图工作，在 macOS 上分别需要「辅助功能」
 * 与「屏幕录制」；本地语音输入需要「麦克风」。
 */
export interface CapabilityPermissions {
  /** 该平台是否需要这些权限（非 macOS 为 false，界面不渲染权限块）。 */
  required: boolean;
  /** macOS 辅助功能：合成鼠标键盘事件、读 UI 树。 */
  accessibility: boolean;
  /** macOS 屏幕录制：截图。 */
  screenRecording: boolean;
  /** 麦克风：本地语音输入采集。 */
  microphone: boolean;
}

/**
 * 需要单独授权的权限类别。**只定义这一处** —— 主进程的跳转表、preload 的签名、
 * 界面里逐项渲染的列表都引用它，三处各写一遍只是时间问题。
 */
export type PermissionKind =
  | "accessibility"
  | "screen-recording"
  | "microphone";

/**
 * 每一项权限在 `CapabilityPermissions` 里对应的字段。
 *
 * 用显式映射而不是三元链：首版写的是
 * `kind === "accessibility" ? !accessibility : !screenRecording`，
 * 加第三种权限时它会**静默**把麦克风未授予报成屏幕录制未授予。
 * `Record<PermissionKind, keyof CapabilityPermissions>` 让新增 kind 必须在这里出现。
 */
const PERMISSION_FIELDS: Record<PermissionKind, keyof CapabilityPermissions> = {
  accessibility: "accessibility",
  "screen-recording": "screenRecording",
  microphone: "microphone",
};

/** 未授予的权限列表。平台不要求时返回空数组。 */
export function missingPermissionKinds(
  permissions: CapabilityPermissions | null,
): PermissionKind[] {
  if (!permissions?.required) return [];
  return (Object.keys(PERMISSION_FIELDS) as PermissionKind[]).filter(
    (kind) => !permissions[PERMISSION_FIELDS[kind]],
  );
}
