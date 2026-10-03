import { describe, expect, it } from "vitest";
import { missingPermissionKinds } from "../../shared/capabilities";
import {
  readCapabilityPermissions,
  type PermissionProbes,
} from "../../main/capabilities/permissions";

function probes(over: Partial<PermissionProbes> = {}): PermissionProbes {
  return {
    platform: "darwin",
    isAccessibilityTrusted: () => true,
    screenAccessStatus: () => "granted",
    microphoneAccessStatus: () => "granted",
    ...over,
  };
}

describe("readCapabilityPermissions", () => {
  it("requires both permissions on macOS and reports each one", () => {
    expect(readCapabilityPermissions(probes())).toEqual({
      required: true,
      accessibility: true,
      screenRecording: true,
      microphone: true,
    });
  });

  it("reports which one is missing", () => {
    const r = readCapabilityPermissions(
      probes({ isAccessibilityTrusted: () => false }),
    );
    expect(r).toEqual({
      required: true,
      accessibility: false,
      screenRecording: true,
      microphone: true,
    });
  });

  it("does not treat a not-determined screen status as granted", () => {
    // macOS 在应用真正尝试捕获前就返回 not-determined；
    // 把它当已授予，用户会以为能截图却一直失败。
    const r = readCapabilityPermissions(
      probes({ screenAccessStatus: () => "not-determined" }),
    );
    expect(r.required).toBe(true);
    expect(r.screenRecording).toBe(false);
  });

  it("reports microphone access on macOS", () => {
    const permissions = readCapabilityPermissions({
      platform: "darwin",
      isAccessibilityTrusted: () => true,
      screenAccessStatus: () => "granted",
      microphoneAccessStatus: () => "granted",
    });
    expect(permissions.microphone).toBe(true);
  });

  it("treats not-determined microphone access as not granted", () => {
    // 与 screen-recording 同一条原则：not-determined 不是已授予，
    // 否则界面会显示"已授予"而首次录音仍然失败。
    const permissions = readCapabilityPermissions({
      platform: "darwin",
      isAccessibilityTrusted: () => true,
      screenAccessStatus: () => "granted",
      microphoneAccessStatus: () => "not-determined",
    });
    expect(permissions.microphone).toBe(false);
  });

  it("does not require permissions off macOS", () => {
    for (const platform of ["win32", "linux"] as const) {
      expect(readCapabilityPermissions(probes({ platform }))).toEqual({
        required: false,
        accessibility: false,
        screenRecording: false,
        microphone: false,
      });
    }
  });
});

describe("missingPermissionKinds", () => {
  it("flags each missing kind by its own field, not by position", () => {
    const missing = missingPermissionKinds({
      required: true,
      accessibility: true,
      screenRecording: true,
      microphone: false,
    });
    expect(missing).toEqual(["microphone"]);
  });

  it("returns nothing when the platform does not require permissions", () => {
    expect(
      missingPermissionKinds({
        required: false,
        accessibility: false,
        screenRecording: false,
        microphone: false,
      }),
    ).toEqual([]);
  });
});
