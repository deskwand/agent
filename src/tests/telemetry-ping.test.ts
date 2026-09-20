import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";

import { DESKWAND_API_URL } from "../shared/oauth-config";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const { mockApp, mockGet, state } = vi.hoisted(() => {
  const state = { userDataDir: "" };
  return {
    state,
    mockGet: vi.fn(),
    mockApp: {
      getPath: vi.fn(() => state.userDataDir),
      getVersion: vi.fn(() => "9.9.9"),
    },
  };
});

vi.mock("electron", () => ({ app: mockApp }));
vi.mock("../main/config/config-store", () => ({
  configStore: { get: mockGet },
}));

const { sendTelemetryPing, startTelemetryHeartbeat, TELEMETRY_PING_INTERVAL_MS } =
  await import("../main/telemetry");

const mockFetch = vi.fn();
let userDataDir = "";
let deviceIdPath = "";

function readDeviceId(): string {
  return JSON.parse(fs.readFileSync(deviceIdPath, "utf-8")).id;
}

beforeEach(() => {
  userDataDir = fs.mkdtempSync(join(os.tmpdir(), "deskwand-telemetry-"));
  state.userDataDir = userDataDir;
  deviceIdPath = join(userDataDir, "device-id.json");

  // `mockReset: true` in vitest.config.mts wipes implementations before each
  // test, so every one has to be re-installed here.
  mockApp.getPath.mockImplementation(() => state.userDataDir);
  mockApp.getVersion.mockReturnValue("9.9.9");
  mockGet.mockReturnValue(true);

  mockFetch.mockReset();
  mockFetch.mockResolvedValue({ status: 204 });
  global.fetch = mockFetch as unknown as typeof fetch;
});

afterEach(() => {
  fs.rmSync(userDataDir, { recursive: true, force: true });
});

describe("sendTelemetryPing", () => {
  it("does not ping and creates no device id when telemetry is disabled", async () => {
    mockGet.mockReturnValue(false);

    await sendTelemetryPing();

    expect(mockFetch).not.toHaveBeenCalled();
    expect(fs.existsSync(deviceIdPath)).toBe(false);
  });

  it("creates a server-valid device id on first run and pings with it", async () => {
    await sendTelemetryPing();

    expect(fs.existsSync(deviceIdPath)).toBe(true);
    const deviceId = readDeviceId();
    expect(deviceId).toMatch(UUID_RE);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${DESKWAND_API_URL}/v1/telemetry/ping`);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({
      deviceId,
      version: "9.9.9",
      platform: process.platform,
    });
  });

  it("reuses an existing device id instead of generating a new one", async () => {
    const existing = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
    fs.writeFileSync(deviceIdPath, JSON.stringify({ id: existing }));

    await sendTelemetryPing();

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).deviceId).toBe(existing);
  });

  it("regenerates the device id when the file is corrupt, without throwing", async () => {
    fs.writeFileSync(deviceIdPath, "not json");

    await expect(sendTelemetryPing()).resolves.toBeUndefined();

    expect(readDeviceId()).toMatch(UUID_RE);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("regenerates the device id when the file has no valid id, without throwing", async () => {
    fs.writeFileSync(deviceIdPath, JSON.stringify({}));

    await expect(sendTelemetryPing()).resolves.toBeUndefined();

    const deviceId = readDeviceId();
    expect(deviceId).toMatch(UUID_RE);
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).deviceId).toBe(deviceId);
  });

  it("re-reads the opt-out switch on every call", async () => {
    await sendTelemetryPing();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    mockGet.mockReturnValue(false);
    await sendTelemetryPing();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("does not resolve until the request has settled", async () => {
    let settle: (() => void) | undefined;
    mockFetch.mockImplementation(
      () =>
        new Promise<{ status: number }>((resolve) => {
          settle = () => resolve({ status: 204 });
        }),
    );

    let resolved = false;
    const done = sendTelemetryPing().then(() => {
      resolved = true;
    });

    await Promise.resolve();
    expect(resolved).toBe(false);

    settle?.();
    await done;
    expect(resolved).toBe(true);
  });

  it("swallows a network failure", async () => {
    mockFetch.mockRejectedValue(new Error("offline"));

    await expect(sendTelemetryPing()).resolves.toBeUndefined();
  });

  it("treats an error response as done — the status is never inspected by design", async () => {
    mockFetch.mockResolvedValue({ status: 400 });

    await expect(sendTelemetryPing()).resolves.toBeUndefined();
  });
});

describe("startTelemetryHeartbeat", () => {
  it("uses a one-hour heartbeat", () => {
    // Guards the plan's verification trap: shipping the temporary 1-minute
    // value used during manual testing.
    expect(TELEMETRY_PING_INTERVAL_MS).toBe(3_600_000);
  });

  it("pings immediately and then once per interval", async () => {
    vi.useFakeTimers();
    try {
      startTelemetryHeartbeat();
      await vi.advanceTimersByTimeAsync(0);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(TELEMETRY_PING_INTERVAL_MS);
      expect(mockFetch).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(TELEMETRY_PING_INTERVAL_MS * 2);
      expect(mockFetch).toHaveBeenCalledTimes(4);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});
