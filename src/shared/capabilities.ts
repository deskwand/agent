/**
 * 系统能力（不是外部服务）的权限状态。
 *
 * 目前只有 Computer Use 一条：它靠合成鼠标键盘事件与截图工作，
 * 在 macOS 上分别需要「辅助功能」与「屏幕录制」两项权限。
 */
export interface CapabilityPermissions {
  /** 该平台是否需要这些权限（Windows / Linux 为 false，界面不渲染权限块）。 */
  required: boolean;
  /** macOS 辅助功能：合成鼠标键盘事件、读 UI 树。 */
  accessibility: boolean;
  /** macOS 屏幕录制：截图。 */
  screenRecording: boolean;
}

/**
 * 需要单独授权的权限类别。**只定义这一处** —— 主进程的跳转表、preload 的签名、
 * 界面里逐项渲染的列表都引用它，三处各写一遍只是时间问题。
 */
export type PermissionKind = "accessibility" | "screen-recording";
