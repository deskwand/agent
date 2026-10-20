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

export const TELEMETRY_FEATURES = [
  // Layer 1 — actions the user takes directly.
  "skill_install",
  "file_op",
  "schedule",
  "browser",
  "connector",
  "ideas",
  "feeds",
  "office_preview",
  // Layer 2 — tools the agent invokes on the user's behalf.
  "sandbox",
  "office_read",
  "memory",
  "browser_agent",
  "vision",
  "ocr",
  "tts",
  "voice_set",
  "todo",
  "skill_curate",
  "subagent",
] as const;
export type TelemetryFeature = (typeof TELEMETRY_FEATURES)[number];
const knownFeatures = new Set<string>(TELEMETRY_FEATURES);

/**
 * A feature reports once per gate it crosses, per day, per process. Gates turn
 * "was it used" into a coarse intensity signal without a row per use.
 */
const FEATURE_GATES = [1, 5, 20, 100];
const FEATURE_TIMEOUT_MS = 5_000;
const FEATURE_COOLDOWN_MS = 60_000;
const MAX_FEATURE_ATTEMPTS = 8;
const MAX_FEATURE_IN_FLIGHT = 4;

type FeatureGateState = {
  uses: number;
  reported: number;
  inFlight: boolean;
  attempts: number;
  retryAfter: number;
};
const featureStates = new Map<string, FeatureGateState>();
let featureRequestsInFlight = 0;
let featureDate = "";

/**
 * Anonymous feature event. Zero-state, fire-and-forget, and silent on failure —
 * it must never block or otherwise affect the main flow. Shares the
 * `telemetryEnabled` opt-out switch with the ping heartbeat.
 *
 * Feature reporting is bounded on purpose: at most one request in flight per
 * `date:feature`, at most four process-wide, a 5s timeout, eight attempts per
 * UTC day per feature and a 60s cooldown after a failure. Slot pressure drops
 * the send rather than queueing it — under-reporting is always preferable to
 * touching the user's turn.
 */
export async function trackEvent(
  event: TelemetryEvent,
  opts: { feature?: TelemetryFeature; code?: string } = {},
): Promise<void> {
  let state: FeatureGateState | undefined;
  let gate = 0;
  let gateCount: number | undefined;
  let acquired = false;
  let succeeded = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    if (!configStore.get("telemetryEnabled")) return;
    if (event === "feature_use") {
      if (!opts.feature || !knownFeatures.has(opts.feature)) return;
      const date = new Date().toISOString().slice(0, 10);
      if (featureDate !== date) {
        featureStates.clear(); // old requests still hold their own detached state
        featureDate = date;
      }
      const key = `${date}:${opts.feature}`;
      state = featureStates.get(key);
      if (!state) {
        state = {
          uses: 0,
          reported: 0,
          inFlight: false,
          attempts: 0,
          retryAfter: 0,
        };
        featureStates.set(key, state);
      }
      state.uses = Math.min(state.uses + 1, 10000);
      for (const value of FEATURE_GATES) {
        if (value <= state.uses && value > state.reported) gate = value;
      }
      if (
        !gate ||
        state.inFlight ||
        state.attempts >= MAX_FEATURE_ATTEMPTS ||
        Date.now() < state.retryAfter ||
        featureRequestsInFlight >= MAX_FEATURE_IN_FLIGHT
      )
        return;
      // Reserve before the first await: a burst cannot duplicate this request.
      state.inFlight = true;
      state.attempts += 1;
      featureRequestsInFlight += 1;
      acquired = true;
      gateCount = state.uses;
    }

    const deviceId = await getOrCreateDeviceId();
    // Recheck opt-out after asynchronous initialization; never send if disabled.
    if (!configStore.get("telemetryEnabled")) return;
    const controller =
      event === "feature_use" ? new AbortController() : undefined;
    if (controller) {
      timeout = setTimeout(() => controller.abort(), FEATURE_TIMEOUT_MS);
      // The timer only aborts a network request; it never schedules a retry.
      if (typeof timeout === "object") timeout.unref();
    }
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
        ...(gateCount !== undefined ? { count: gateCount } : {}),
      }),
      ...(controller ? { signal: controller.signal } : {}),
    }).catch(() => null);
    if (res?.ok) {
      succeeded = true;
      if (state) state.reported = Math.max(state.reported, gate);
    } else if (event !== "feature_use") {
      // Feature failures stay silent so a persistent outage cannot amplify
      // itself into the persistent log.
      logWarn(
        "[telemetry] event not recorded:",
        event,
        res ? res.status : "network",
      );
    }
  } catch {
    // Fail open, including config, serialization, device IO, fetch and logger errors.
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    if (acquired && state) {
      state.inFlight = false;
      featureRequestsInFlight -= 1;
      if (!succeeded) state.retryAfter = Date.now() + FEATURE_COOLDOWN_MS;
    }
  }
}

/** Tests only; call after all outstanding requests have settled. */
export function resetFeatureDedupeForTest(): void {
  featureStates.clear();
  featureDate = "";
  featureRequestsInFlight = 0;
}
