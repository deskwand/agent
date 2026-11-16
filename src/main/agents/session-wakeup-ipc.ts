/**
 * @module main/agents/session-wakeup-ipc
 *
 * 普通会话自我唤醒的 IPC 通道（`sessionWakeup.*`）。preload 只暴露这些方法。
 * 调度全在主进程；渲染层只需要知道「下一次唤醒」并能取消。
 */
import type { IpcMain } from "electron";
import type { SessionWakeupManager } from "./session-wakeup-manager";

export interface SessionWakeupIpcDeps {
  ipcMain: Pick<IpcMain, "handle">;
  getManager: () => SessionWakeupManager | null;
}

export function registerSessionWakeupIpc({
  ipcMain,
  getManager,
}: SessionWakeupIpcDeps): void {
  const requireManager = (): SessionWakeupManager => {
    const manager = getManager();
    if (!manager) throw new Error("Session wakeup manager not initialized");
    return manager;
  };

  ipcMain.handle("sessionWakeup.next", (_event, sessionId: string) =>
    requireManager().getNext(sessionId),
  );
  ipcMain.handle(
    "sessionWakeup.cancel",
    (_event, sessionId: string, wakeupId: string) =>
      requireManager().cancel(sessionId, wakeupId),
  );
}
