import { describe, expect, it } from "vitest";
import { resolveCompactionSettingsForWindow } from "../src/main/agent/compaction-settings";

describe("resolveCompactionSettingsForWindow", () => {
  it("disables compaction for tiny windows (< 16K)", () => {
    expect(resolveCompactionSettingsForWindow(8192)).toEqual({
      enabled: false,
    });
  });

  it("uses 25% reserve / 30% keep for small windows (16K-64K)", () => {
    const settings = resolveCompactionSettingsForWindow(32768);
    expect(settings).toEqual({
      enabled: true,
      reserveTokens: 8192,
      keepRecentTokens: 9830,
    });
  });

  it("uses 20% reserve / 25% keep for medium windows (64K-256K)", () => {
    const settings = resolveCompactionSettingsForWindow(128000);
    expect(settings).toEqual({
      enabled: true,
      reserveTokens: 25600,
      keepRecentTokens: 32000,
    });
  });

  it("uses 15% reserve / 20% keep for large windows (>= 256K)", () => {
    const settings = resolveCompactionSettingsForWindow(512000);
    expect(settings).toEqual({
      enabled: true,
      reserveTokens: 76800,
      keepRecentTokens: 102400,
    });
  });

  it("falls back to the tiny-window tier when the size is unknown/zero", () => {
    expect(resolveCompactionSettingsForWindow(0)).toEqual({ enabled: false });
  });

  it("pins tier boundaries exactly (parity with AgentRunner.runAgent inline tiers)", () => {
    // 16384 → small tier; 65536 → medium tier; 262144 → large tier
    expect(resolveCompactionSettingsForWindow(16384)).toEqual({
      enabled: true,
      reserveTokens: 4096,
      keepRecentTokens: 4915,
    });
    expect(resolveCompactionSettingsForWindow(65536)).toEqual({
      enabled: true,
      reserveTokens: 13107,
      keepRecentTokens: 16384,
    });
    expect(resolveCompactionSettingsForWindow(262144)).toEqual({
      enabled: true,
      reserveTokens: 39321,
      keepRecentTokens: 52428,
    });
    // Just below each boundary falls in the previous tier
    expect(resolveCompactionSettingsForWindow(16383)).toEqual({
      enabled: false,
    });
    expect(resolveCompactionSettingsForWindow(65535).reserveTokens).toBe(16383);
    expect(resolveCompactionSettingsForWindow(262143).reserveTokens).toBe(
      52428,
    );
  });
});
