import { describe, it, expect } from "vitest";
import {
  parseAmountToCents,
  creditsForAmountCents,
  waitForOrderConfirmation,
} from "../src/renderer/utils/topup";

describe("parseAmountToCents", () => {
  it("parses dollar input to cents", () => {
    expect(parseAmountToCents("5")).toBe(500);
    expect(parseAmountToCents("$12.34")).toBe(1234);
    expect(parseAmountToCents("10.00")).toBe(1000);
  });
  it("rejects out of range or malformed input", () => {
    expect(parseAmountToCents("1")).toBeNull();
    expect(parseAmountToCents("201")).toBeNull();
    expect(parseAmountToCents("abc")).toBeNull();
    expect(parseAmountToCents("12.345")).toBeNull();
  });
});

describe("creditsForAmountCents", () => {
  it("converts cents to credits at 1 credit = $0.001", () => {
    expect(creditsForAmountCents(500)).toBe(5000);
    expect(creditsForAmountCents(1234)).toBe(12340);
  });
});

describe("waitForOrderConfirmation", () => {
  it("returns confirmed when poll reports confirmed", async () => {
    const result = await waitForOrderConfirmation(
      async () => "confirmed",
      "o1",
      { intervalMs: 5, timeoutMs: 500 },
    );
    expect(result).toBe("confirmed");
  });
  it("returns expired when the order expires", async () => {
    const result = await waitForOrderConfirmation(async () => "expired", "o1", {
      intervalMs: 5,
      timeoutMs: 500,
    });
    expect(result).toBe("expired");
  });
  it("returns timeout when deadline passes", async () => {
    const result = await waitForOrderConfirmation(async () => "pending", "o1", {
      intervalMs: 5,
      timeoutMs: 40,
    });
    expect(result).toBe("timeout");
  });
  it("retries after poll errors", async () => {
    let calls = 0;
    const result = await waitForOrderConfirmation(
      async () => {
        calls++;
        if (calls === 1) throw new Error("network");
        return "confirmed";
      },
      "o1",
      { intervalMs: 5, timeoutMs: 500 },
    );
    expect(result).toBe("confirmed");
    expect(calls).toBe(2);
  });
});
