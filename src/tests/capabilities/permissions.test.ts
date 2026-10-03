import { describe, expect, it } from "vitest";
import {
  readCapabilityPermissions,
  type PermissionProbes,
} from "../../main/capabilities/permissions";

function probes(over: Partial<PermissionProbes> = {}): PermissionProbes {
  return {
    platform: "darwin",
    isAccessibilityTrusted: () => true,
    screenAccessStatus: () => "granted",
    ...over,
  };
}

describe("readCapabilityPermissions", () => {
  it("requires both permissions on macOS and reports each one", () => {
    expect(readCapabilityPermissions(probes())).toEqual({
      required: true,
      accessibility: true,
      screenRecording: true,
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

  it("does not require permissions off macOS", () => {
    for (const platform of ["win32", "linux"] as const) {
      expect(readCapabilityPermissions(probes({ platform }))).toEqual({
        required: false,
        accessibility: false,
        screenRecording: false,
      });
    }
  });
});
