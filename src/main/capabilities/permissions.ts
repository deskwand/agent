import type { CapabilityPermissions } from "../../shared/capabilities";

export type ScreenAccessStatus =
  | "granted"
  | "denied"
  | "restricted"
  | "not-determined"
  | "unknown";

/** 平台相关的查询被抽成探针，好让本模块可以在非 macOS 上被测试。 */
export interface PermissionProbes {
  platform: NodeJS.Platform;
  /** 只查询、不弹窗（调用方传 Electron 的 isTrustedAccessibilityClient(false)）。 */
  isAccessibilityTrusted: () => boolean;
  screenAccessStatus: () => ScreenAccessStatus;
}

/**
 * 读当前平台的能力权限。**只有 macOS 需要这两项** —— `required:false` 的平台上
 * 界面不渲染权限块，所以这里返回 false 而不是「假装已授予」。
 *
 * `not-determined` 不算已授予：`getMediaAccessStatus("screen")` 在应用真正尝试
 * 捕获前就返回它，当成已授权会让用户以为能截图却一直失败。
 */
export function readCapabilityPermissions(
  probes: PermissionProbes,
): CapabilityPermissions {
  if (probes.platform !== "darwin") {
    return { required: false, accessibility: false, screenRecording: false };
  }
  return {
    required: true,
    accessibility: probes.isAccessibilityTrusted(),
    screenRecording: probes.screenAccessStatus() === "granted",
  };
}
