import { describe, expect, it } from "vitest";
import { formatTokenSpeed } from "../../renderer/utils/token-speed";

describe("formatTokenSpeed", () => {
  it("rounds sub-10 values to one decimal and the rest to integers", () => {
    expect(formatTokenSpeed(8.44)).toBe("8.4 tok/s");
    expect(formatTokenSpeed(42.4)).toBe("42 tok/s");
  });

  it("rounds 9.96 up to 10 without a trailing zero", () => {
    expect(formatTokenSpeed(9.96)).toBe("10 tok/s");
  });

  it("renders nothing when a tiny positive value rounds to zero", () => {
    expect(formatTokenSpeed(0.04)).toBe("");
  });

  it("renders nothing for missing or non-positive input", () => {
    expect(formatTokenSpeed(0)).toBe("");
    expect(formatTokenSpeed(-1)).toBe("");
    expect(formatTokenSpeed(Number.NaN)).toBe("");
    expect(formatTokenSpeed(Number.POSITIVE_INFINITY)).toBe("");
    expect(formatTokenSpeed(null)).toBe("");
    expect(formatTokenSpeed(undefined)).toBe("");
  });
});
