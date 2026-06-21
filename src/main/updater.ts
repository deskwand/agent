/**
 * Auto-updater module for DeskWand.
 *
 * Configured for generic provider at https://file.deskwand.com.
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
    url: "https://file.deskwand.com",
  });

  autoUpdater.forceDevUpdateConfig = true;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  // Disable differential download on macOS to ensure consistent progress reporting.
  // Squirrel.Mac's differential download (via blockmap) can produce progress events
  // that overlap with the fallback full download, confusing the progress UI.
  // Windows/Linux have working blockmaps and benefit from differential downloads.
  if (process.platform === "darwin") {
    autoUpdater.disableDifferentialDownload = true;
  }

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
    const pct = Number.isFinite(progress.percent) ? progress.percent.toFixed(1) : "?";
    const txMB = Number.isFinite(progress.transferred)
      ? (progress.transferred / 1024 / 1024).toFixed(1)
      : "?";
    const totMB = Number.isFinite(progress.total)
      ? (progress.total / 1024 / 1024).toFixed(1)
      : "?";
    log(`[AutoUpdater] Download progress: ${pct}% (${txMB}MB / ${totMB}MB)`);
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
