import { app } from "electron";

import { DESKWAND_API_URL } from "../shared/oauth-config";
import { configStore } from "./config/config-store";
import { logWarn } from "./utils/logger";
import { getOrCreateDeviceId } from "./telemetry";

export type TelemetryEvent =
  | "config_done"
  | "session_start"
  | "reply_ok"
  | "error"
  | "feature_use"
  | "update_result";

export type TelemetryFeature =
  | "skill_install"
  | "file_op"
  | "schedule"
  | "browser"
  | "connector";

/**
 * Already-reported `YYYY-MM-DD:feature` keys. Best-effort only: the server
 * derives first-use from `MIN(received_at)`, so losing this costs one extra
 * request, never a lost data point.
 */
const sentFeatureToday = new Set<string>();

/**
 * Anonymous feature event. Zero-state, fire-and-forget, and silent on failure —
 * it must never block or otherwise affect the main flow. Shares the
 * `telemetryEnabled` opt-out switch with the ping heartbeat.
 */
export async function trackEvent(
  event: TelemetryEvent,
  opts: { feature?: TelemetryFeature; code?: string } = {},
): Promise<void> {
  try {
    if (!configStore.get("telemetryEnabled")) {
      return;
    }

    let dedupeKey: string | null = null;
    if (event === "feature_use") {
      if (!opts.feature) {
        return;
      }
      dedupeKey = `${new Date().toISOString().slice(0, 10)}:${opts.feature}`;
      if (sentFeatureToday.has(dedupeKey)) {
        return;
      }
    }

    const deviceId = await getOrCreateDeviceId();

    const res = await fetch(`${DESKWAND_API_URL}/v1/telemetry/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceId,
        version: app.getVersion(),
        platform: process.platform,
        event,
        ...(opts.feature ? { feature: opts.feature } : {}),
        ...(opts.code ? { code: opts.code } : {}),
      }),
    }).catch(() => null);

    if (res?.ok) {
      // Remember only on success: a transient failure must not suppress this
      // feature for the rest of the day.
      if (dedupeKey) sentFeatureToday.add(dedupeKey);
    } else {
      // A non-2xx means the server rejected the payload (e.g. a value that fell
      // out of its whitelist); without this the whole class would vanish silently.
      logWarn(
        "[telemetry] event not recorded:",
        event,
        res ? res.status : "network",
      );
    }
  } catch {
    // Telemetry must never affect the app.
  }
}

/** Clears the daily dedupe table (used by tests). */
export function resetFeatureDedupeForTest(): void {
  sentFeatureToday.clear();
}
