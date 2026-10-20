import { app } from "electron";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { DESKWAND_API_URL } from "../shared/oauth-config";
import { configStore } from "./config/config-store";

/** Heartbeat period for the anonymous telemetry ping. */
export const TELEMETRY_PING_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Cached device-id initialization. Callers await the same promise, so a burst
 * of concurrent events performs one disk read and one write, never more — and
 * nothing on this path blocks synchronously.
 */
let deviceIdPromise: Promise<string> | null = null;

/**
 * Reads the anonymous device id, generating and persisting one on first use.
 * Shared by the ping heartbeat and the event reporter so both report under the
 * same id.
 */
export function getOrCreateDeviceId(): Promise<string> {
  if (deviceIdPromise) return deviceIdPromise;
  deviceIdPromise = (async () => {
    const deviceIdPath = join(app.getPath("userData"), "device-id.json");
    try {
      const stored: unknown = JSON.parse(await readFile(deviceIdPath, "utf-8"));
      // A well-formed file with a missing/non-string id must regenerate rather
      // than send `undefined`, which the API would reject with a silent 400.
      if (
        stored &&
        typeof stored === "object" &&
        "id" in stored &&
        typeof stored.id === "string"
      ) {
        return stored.id;
      }
    } catch {
      // Missing or corrupt file: fall through and allocate a fresh id.
    }
    const id = randomUUID();
    await writeFile(deviceIdPath, JSON.stringify({ id }));
    return id;
  })().catch((error: unknown) => {
    deviceIdPromise = null;
    throw error;
  });
  return deviceIdPromise;
}

/** Tests only; call after all pending initialization has settled. */
export function resetDeviceIdForTest(): void {
  deviceIdPromise = null;
}

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

    const deviceId = await getOrCreateDeviceId();

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
