import { describe, it, expect } from "vitest";
import {
  generateRecoveryCode,
  validateRecoveryCode,
} from "../src/main/vault/recovery";
import { deriveMek } from "../src/main/vault/crypto";

describe("vault recovery", () => {
  it("generates a valid base58 code", () => {
    const code = generateRecoveryCode();
    expect(validateRecoveryCode(code)).toBe(true);
    expect(code.length).toBeGreaterThanOrEqual(24);
  });

  it("rejects invalid codes", () => {
    expect(validateRecoveryCode("0O1l")).toBe(false);
    expect(validateRecoveryCode("short")).toBe(false);
    expect(validateRecoveryCode("")).toBe(false);
  });

  it("deriveMek is deterministic per code", () => {
    const code = generateRecoveryCode();
    expect(deriveMek(code).equals(deriveMek(code))).toBe(true);
  });
});
