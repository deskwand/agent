import { describe, it, expect } from "vitest";
import {
  parseAmountToCents,
  creditsForAmountCents,
  waitForOrderConfirmation,
  usdForCredits,
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

describe("usdForCredits", () => {
  it("formats whole dollars", () => {
    expect(usdForCredits(10000)).toBe("$10.00");
    expect(usdForCredits(2000)).toBe("$2.00");
  });
  it("rounds to cents (avoid 0.015 float trap — use 17)", () => {
    expect(usdForCredits(17)).toBe("$0.02"); // 0.017 → 2 分
    expect(usdForCredits(1234)).toBe("$1.23"); // 1.234 → 1.23
  });
  it("shows <$0.01 instead of misleading $0.00", () => {
    expect(usdForCredits(3)).toBe("<$0.01"); // 0.003
    expect(usdForCredits(1)).toBe("<$0.01");
    expect(usdForCredits(4)).toBe("<$0.01"); // 0.004（边界内）
  });
  it("zero credits is exactly $0.00", () => {
    expect(usdForCredits(0)).toBe("$0.00");
  });
});
