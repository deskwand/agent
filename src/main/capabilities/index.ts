import { shell, systemPreferences, type IpcMain } from "electron";
import type {
  CapabilityPermissions,
  PermissionKind,
} from "../../shared/capabilities";
import {
  readCapabilityPermissions,
  type ScreenAccessStatus,
} from "./permissions";

/** 系统设置里对应面板的深链。只有 macOS 有。
 *  用 `Record<PermissionKind, string>`：将来加一种权限却忘了加面板，会**编译报错**。 */
const PERMISSION_PANES: Record<PermissionKind, string> = {
  accessibility:
    "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
  "screen-recording":
    "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
};

export interface RegisterCapabilitiesIpcArgs {
  ipcMain: IpcMain;
  /** 注入以便测试；默认 `shell.openExternal`。 */
  openUrl?: (url: string) => void;
  /** 注入以便测试；默认读 Electron 的 systemPreferences。 */
  permissions?: () => CapabilityPermissions;
  /** 默认 `process.platform === "darwin"`；注入以便测试非 macOS 分支。 */
  isMac?: boolean;
}

function systemPermissions(): CapabilityPermissions {
  return readCapabilityPermissions({
    platform: process.platform,
    // `false` = 只查询、不弹窗：弹窗该发生在用户真正用到该能力的时候。
    isAccessibilityTrusted: () =>
      systemPreferences.isTrustedAccessibilityClient(false),
    screenAccessStatus: () =>
      systemPreferences.getMediaAccessStatus("screen") as ScreenAccessStatus,
  });
}

export function registerCapabilitiesIpc({
  ipcMain,
  openUrl,
  permissions,
  isMac = process.platform === "darwin",
}: RegisterCapabilitiesIpcArgs): void {
  const read = permissions ?? systemPermissions;
  const open = openUrl ?? ((url: string) => void shell.openExternal(url));

  ipcMain.handle("capabilities.permissions", () => read());
  ipcMain.handle(
    "capabilities.openPermissionSettings",
    (_e, kind: PermissionKind) => {
      if (!isMac) return;
      // 渲染进程传来的值必须校验：`PERMISSION_PANES["constructor"]` 这类原型键
      // 会取到**真值但不是字符串**（`"__proto__"` 取到对象），直接喂给
      // shell.openExternal 会抛，而调用方用的是 `void ...`，用户只会看到按钮没反应。
      if (!Object.hasOwn(PERMISSION_PANES, kind)) return;
      open(PERMISSION_PANES[kind]);
    },
  );
}
