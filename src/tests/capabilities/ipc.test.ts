import { describe, expect, it, vi } from "vitest";
import { systemPreferences, type IpcMain } from "electron";
import { registerCapabilitiesIpc } from "../../main/capabilities";

/** 抓 handler 的假 ipcMain：真 IpcMain 在单测里拿不到。 */
function fakeIpcMain() {
  const handlers = new Map<
    string,
    (event: unknown, ...args: unknown[]) => unknown
  >();
  const ipcMain = {
    handle: (
      channel: string,
      fn: (event: unknown, ...args: unknown[]) => unknown,
    ) => {
      handlers.set(channel, fn);
    },
  } as unknown as IpcMain;
  return { ipcMain, handlers };
}

const GRANTED = { required: true, accessibility: true, screenRecording: true };

describe("registerCapabilitiesIpc", () => {
  it("returns the injected permission state", async () => {
    const { ipcMain, handlers } = fakeIpcMain();
    registerCapabilitiesIpc({ ipcMain, permissions: () => GRANTED });
    expect(await handlers.get("capabilities.permissions")!(null)).toEqual(
      GRANTED,
    );
  });

  it("opens the matching system-settings pane on macOS", () => {
    const { ipcMain, handlers } = fakeIpcMain();
    const openUrl = vi.fn();
    registerCapabilitiesIpc({ ipcMain, openUrl, isMac: true });

    handlers.get("capabilities.openPermissionSettings")!(null, "accessibility");
    expect(openUrl).toHaveBeenCalledWith(
      "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
    );

    handlers.get("capabilities.openPermissionSettings")!(
      null,
      "screen-recording",
    );
    expect(openUrl).toHaveBeenCalledWith(
      "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
    );
  });

  it("ignores an unknown kind instead of calling shell with a prototype key", () => {
    const { ipcMain, handlers } = fakeIpcMain();
    const openUrl = vi.fn();
    registerCapabilitiesIpc({ ipcMain, openUrl, isMac: true });
    // 渲染进程传什么都得挡住：`PERMISSION_PANES["constructor"]` 这类原型键
    // 取到的是**真值但不是字符串**，喂给 openExternal 会抛。
    for (const kind of ["constructor", "toString", "__proto__", "nope"]) {
      handlers.get("capabilities.openPermissionSettings")!(null, kind);
    }
    expect(openUrl).not.toHaveBeenCalled();
  });

  it("reads the right Electron APIs when nothing is injected", async () => {
    const media = vi.spyOn(systemPreferences, "getMediaAccessStatus");
    const trusted = vi.spyOn(systemPreferences, "isTrustedAccessibilityClient");
    const { ipcMain, handlers } = fakeIpcMain();
    registerCapabilitiesIpc({ ipcMain });
    await handlers.get("capabilities.permissions")!(null);
    expect(media).toHaveBeenCalledWith("screen");
    // false = 只查询、不弹窗（弹窗该发生在真正用到该能力的时候）
    expect(trusted).toHaveBeenCalledWith(false);
  });

  it("does nothing off macOS", () => {
    const { ipcMain, handlers } = fakeIpcMain();
    const openUrl = vi.fn();
    registerCapabilitiesIpc({ ipcMain, openUrl, isMac: false });
    handlers.get("capabilities.openPermissionSettings")!(null, "accessibility");
    expect(openUrl).not.toHaveBeenCalled();
  });
});
