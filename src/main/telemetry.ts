import { app } from "electron";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { join } from "node:path";

import { DESKWAND_API_URL } from "../shared/oauth-config";
import { configStore } from "./config/config-store";

/** Heartbeat period for the anonymous telemetry ping. */
export const TELEMETRY_PING_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Anonymous install counting. Sent once at startup and then on every heartbeat
 * so that long-running (tray) sessions keep reporting without a restart.
 *
 * Never throws: telemetry must not affect anything the user can see.
 */
export async function sendTelemetryPing(): Promise<void> {
  try {
    // Read the opt-out switch on every call — caching it would keep the
    // heartbeat alive until the process restarts after the user disabled it.
    if (!configStore.get("telemetryEnabled")) {
      return;
    }

    const deviceIdPath = join(app.getPath("userData"), "device-id.json");
    let deviceId: string;
    try {
      const stored = JSON.parse(fs.readFileSync(deviceIdPath, "utf-8")) as {
        id?: unknown;
      };
      // A well-formed file with a missing/non-string id must regenerate rather
      // than send `undefined`, which the API would reject with a silent 400.
      if (typeof stored?.id !== "string") {
        throw new Error("invalid device id file");
      }
      deviceId = stored.id;
    } catch {
      deviceId = randomUUID();
      fs.writeFileSync(deviceIdPath, JSON.stringify({ id: deviceId }));
    }

    await fetch(`${DESKWAND_API_URL}/v1/telemetry/ping`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceId,
        version: app.getVersion(),
        platform: process.platform,
      }),
    }).catch(() => {});
  } catch {
    // Never let telemetry affect the app
  }
}

/**
 * Starts the heartbeat: one ping now, then one per {@link TELEMETRY_PING_INTERVAL_MS}.
 * The app is a tray app that survives window close, so a startup-only ping
 * stops counting long-running sessions until the next restart.
 */
export function startTelemetryHeartbeat(): void {
  void sendTelemetryPing();
  setInterval(() => void sendTelemetryPing(), TELEMETRY_PING_INTERVAL_MS);
}
