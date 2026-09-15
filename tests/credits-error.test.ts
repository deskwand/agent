import { describe, it, expect } from "vitest";
import { detectInsufficientCredits } from "../src/main/agent/credits-error";

describe("detectInsufficientCredits", () => {
  it("matches folded provider error text (status + JSON body)", () => {
    expect(
      detectInsufficientCredits(
        '402: {"error":{"code":"INSUFFICIENT_BALANCE","message":"Insufficient credits"}}',
      ),
    ).toBe(true);
  });
  it("matches plain code text", () => {
    expect(detectInsufficientCredits("INSUFFICIENT_BALANCE")).toBe(true);
  });
  it("does not match unrelated errors", () => {
    expect(detectInsufficientCredits("Connection refused")).toBe(false);
    expect(detectInsufficientCredits("")).toBe(false);
  });
});
