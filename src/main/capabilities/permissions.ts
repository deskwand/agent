import type { CapabilityPermissions } from "../../shared/capabilities";

export type MediaAccessStatus =
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
  screenAccessStatus: () => MediaAccessStatus;
  /** 只查询、不弹窗。Electron 的 getMediaAccessStatus("microphone")。 */
  microphoneAccessStatus: () => MediaAccessStatus;
}

/**
 * 读当前平台的能力权限。**只有 macOS 需要这几项** —— `required:false` 的平台上
 * 界面不渲染权限块，所以这里返回 false 而不是「假装已授予」。
 *
 * `not-determined` 不算已授予：`getMediaAccessStatus` 在应用真正尝试前就返回它，
 * 当成已授权会让用户以为能用却一直失败。
 */
export function readCapabilityPermissions(
  probes: PermissionProbes,
): CapabilityPermissions {
  if (probes.platform !== "darwin") {
    return {
      required: false,
      accessibility: false,
      screenRecording: false,
      microphone: false,
    };
  }
  return {
    required: true,
    accessibility: probes.isAccessibilityTrusted(),
    screenRecording: probes.screenAccessStatus() === "granted",
    microphone: probes.microphoneAccessStatus() === "granted",
  };
}
