import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { shouldDisableHardwareAcceleration } from "../main/gpu-policy";

describe("shouldDisableHardwareAcceleration", () => {
  it.each<NodeJS.Platform>(["darwin", "win32"])(
    "enables acceleration by default on %s",
    (platform) => {
      expect(shouldDisableHardwareAcceleration(platform, {})).toBe(false);
    },
  );

  it("keeps Linux software-rendered by default", () => {
    expect(shouldDisableHardwareAcceleration("linux", {})).toBe(true);
  });

  it("enables Linux GPU when DESKWAND_ENABLE_GPU=1", () => {
    expect(
      shouldDisableHardwareAcceleration("linux", {
        DESKWAND_ENABLE_GPU: "1",
      }),
    ).toBe(false);
  });

  it.each<NodeJS.Platform>(["darwin", "win32", "linux"])(
    "honors explicit safe mode on %s",
    (platform) => {
      expect(
        shouldDisableHardwareAcceleration(platform, {
          DESKWAND_DISABLE_GPU: "1",
          DESKWAND_ENABLE_GPU: "1",
        }),
      ).toBe(true);
    },
  );

  it("only accepts the exact value 1", () => {
    expect(
      shouldDisableHardwareAcceleration("linux", {
        DESKWAND_ENABLE_GPU: "true",
      }),
    ).toBe(true);
    expect(
      shouldDisableHardwareAcceleration("darwin", {
        DESKWAND_DISABLE_GPU: "true",
      }),
    ).toBe(false);
  });
});

describe("main-process integration", () => {
  const source = fs.readFileSync(
    path.resolve(import.meta.dirname, "../main/index.ts"),
    "utf8",
  );

  it("applies the policy before Electron readiness", () => {
    const policyIndex = source.indexOf(
      "const hardwareAccelerationDisabled = shouldDisableHardwareAcceleration(",
    );
    const readyIndex = source.indexOf(".whenReady()");

    expect(policyIndex).toBeGreaterThan(-1);
    expect(readyIndex).toBeGreaterThan(-1);
    expect(policyIndex).toBeLessThan(readyIndex);
  });

  it("retains both software-rendering safeguards", () => {
    expect(source).toMatch(
      /if \(hardwareAccelerationDisabled\) \{[\s\S]*?app\.disableHardwareAcceleration\(\);[\s\S]*?app\.commandLine\.appendSwitch\("disable-gpu"\);[\s\S]*?\}/,
    );
    expect(source.match(/app\.disableHardwareAcceleration\(\)/g)).toHaveLength(
      1,
    );
  });
});
