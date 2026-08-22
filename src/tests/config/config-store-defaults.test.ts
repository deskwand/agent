import { describe, expect, it } from "vitest";
import {
  clampUiFontSize,
  defaultStoredConfig,
  UI_FONT_SIZE_DEFAULT,
  UI_FONT_SIZE_MAX,
  UI_FONT_SIZE_MIN,
} from "../../main/config/config-store";

describe("defaultStoredConfig", () => {
  it("defaults the global memory switch to disabled", () => {
    expect(defaultStoredConfig().memoryEnabled).toBe(false);
  });

  it("defaults auto skill learning to disabled", () => {
    expect(defaultStoredConfig().autoSkillLearning).toBe(false);
  });
});

describe("uiFontSize", () => {
  it("defaults to 14", () => {
    expect(defaultStoredConfig().uiFontSize).toBe(UI_FONT_SIZE_DEFAULT);
    expect(defaultStoredConfig().uiFontSize).toBe(14);
  });

  it("clamps out-of-range values", () => {
    expect(clampUiFontSize(8)).toBe(UI_FONT_SIZE_MIN);
    expect(clampUiFontSize(25)).toBe(UI_FONT_SIZE_MAX);
    expect(clampUiFontSize(16)).toBe(16);
  });

  it("falls back to default for non-finite values", () => {
    expect(clampUiFontSize(Number.NaN)).toBe(UI_FONT_SIZE_DEFAULT);
    expect(clampUiFontSize(Number.POSITIVE_INFINITY)).toBe(
      UI_FONT_SIZE_DEFAULT,
    );
  });
});
