/**
 * Auto-updater module for OMAGT.
 *
 * Configured for generic provider at https://file.omagt.com.
 * Per karpathy-guidelines: self-contained, single responsibility,
 * event listeners only (no IPC/UI — those are later steps).
 */

import { autoUpdater } from "electron-updater";
import { app } from "electron";
import { log } from "./utils/logger";
import type { ServerEvent } from "../renderer/types";

export function initUpdater(
  sendToRenderer: (event: ServerEvent) => void,
): void {
  // Ensure the feed URL is always set, even if build-time publish config is missing
  autoUpdater.setFeedURL({
    provider: "generic",
    url: "https://file.omagt.com",
  });

  autoUpdater.forceDevUpdateConfig = true;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;

  // ── Event listeners ──

  autoUpdater.on("checking-for-update", () => {
    log("[AutoUpdater] Checking for update...");
  });

  autoUpdater.on("update-available", (info) => {
    log("[AutoUpdater] Update available:", info.version);
    sendToRenderer({
      type: "update.available",
      payload: { version: info.version },
    });
  });

  autoUpdater.on("update-not-available", () => {
    log("[AutoUpdater] Already up to date");
    sendToRenderer({ type: "update.not-available", payload: {} });
  });

  autoUpdater.on("download-progress", (progress) => {
    sendToRenderer({
      type: "update.progress",
      payload: {
        percent: progress.percent,
        bytesPerSecond: progress.bytesPerSecond,
        transferred: progress.transferred,
        total: progress.total,
      },
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    log("[AutoUpdater] Update downloaded:", info.version);
    sendToRenderer({
      type: "update.downloaded",
      payload: { version: info.version },
    });

    // Restart is triggered by the user via UI (SettingsAbout) → "update.install" IPC
  });

  autoUpdater.on("error", (err) => {
    log("[AutoUpdater] Error:", err.message);
    sendToRenderer({
      type: "update.error",
      payload: { message: err.message },
    });
  });

  // ── Dev mode: electron-updater auto-reads dev-app-update.yml when !app.isPackaged ──
  if (!app.isPackaged) {
    log("[AutoUpdater] Dev mode — will use dev-app-update.yml if present");
  }

  autoUpdater.checkForUpdatesAndNotify().catch((err: unknown) => {
    log("[AutoUpdater] Update check failed:", err);
  });
}
