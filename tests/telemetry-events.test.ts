import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const { mockConfigGet, mockFetch, mockGetDeviceId, mockLogWarn } =
  vi.hoisted(() => ({
    mockConfigGet: vi.fn(() => true),
    mockFetch: vi.fn(() => Promise.resolve({ ok: true })),
    mockGetDeviceId: vi.fn(() =>
      Promise.resolve("550e8400-e29b-41d4-a716-446655440000"),
    ),
    mockLogWarn: vi.fn(),
  }));

vi.mock("../src/main/utils/logger", () => ({
  log: vi.fn(),
  logWarn: mockLogWarn,
  logError: vi.fn(),
}));

vi.mock("../src/main/config/config-store", () => ({
  configStore: { get: mockConfigGet },
}));

vi.mock("../src/main/telemetry", () => ({
  getOrCreateDeviceId: mockGetDeviceId,
}));

vi.mock("../src/shared/oauth-config", () => ({
  DESKWAND_API_URL: "https://api.test",
}));

import {
  trackEvent,
  resetFeatureDedupeForTest,
} from "../src/main/telemetry-events";

describe("trackEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mockFetch);
    mockConfigGet.mockReturnValue(true);
    // The module-level daily dedupe table survives across cases — without this
    // a re-run would find the feature already recorded and skip the request.
    resetFeatureDedupeForTest();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts an event with the device id", async () => {
    await trackEvent("reply_ok");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, { body: string }];
    expect(url).toBe("https://api.test/v1/telemetry/event");
    expect(JSON.parse(init.body)).toMatchObject({
      deviceId: "550e8400-e29b-41d4-a716-446655440000",
      event: "reply_ok",
    });
  });

  it("does nothing when telemetry is disabled", async () => {
    mockConfigGet.mockReturnValue(false);

    await trackEvent("reply_ok");

    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockGetDeviceId).not.toHaveBeenCalled();
  });

  it("sends feature and code only when provided", async () => {
    await trackEvent("feature_use", { feature: "browser" });
    await trackEvent("error", { code: "network" });

    const featureBody = JSON.parse(
      (mockFetch.mock.calls[0] as [string, { body: string }])[1].body,
    );
    expect(featureBody.feature).toBe("browser");
    expect(featureBody).not.toHaveProperty("code");

    const codeBody = JSON.parse(
      (mockFetch.mock.calls[1] as [string, { body: string }])[1].body,
    );
    expect(codeBody.code).toBe("network");
    expect(codeBody).not.toHaveProperty("feature");
  });

  it("dedupes feature_use per feature per day", async () => {
    await trackEvent("feature_use", { feature: "browser" });
    await trackEvent("feature_use", { feature: "browser" });
    await trackEvent("feature_use", { feature: "file_op" });

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("does not suppress a feature for the day when the send fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: false, status: 500 })),
    );
    await trackEvent("feature_use", { feature: "browser" });

    vi.stubGlobal("fetch", mockFetch);
    await trackEvent("feature_use", { feature: "browser" });

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("logs but stays silent to the caller when the server rejects the event", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: false, status: 400 })),
    );

    await expect(trackEvent("reply_ok")).resolves.toBeUndefined();
    expect(mockLogWarn).toHaveBeenCalled();
  });

  it("ignores feature_use without a feature", async () => {
    await trackEvent("feature_use");

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("never throws when the request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("network down"))),
    );

    await expect(trackEvent("reply_ok")).resolves.toBeUndefined();
  });

  it("never throws when reading the device id fails", async () => {
    mockGetDeviceId.mockRejectedValueOnce(new Error("no userData"));

    await expect(trackEvent("reply_ok")).resolves.toBeUndefined();
  });
});
