import { describe, it, expect } from "vitest";
import {
  parseAmountToCents,
  formatMicroUsd,
  waitForOrderConfirmation,
  explorerTxUrl,
  formatTopUpTime,
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

describe("formatMicroUsd", () => {
  it("formats whole dollars", () => {
    expect(formatMicroUsd(10_000_000)).toBe("$10.00");
    expect(formatMicroUsd(2_000_000)).toBe("$2.00");
  });
  it("rounds to cents (avoid the 0.015 float trap — use 17)", () => {
    expect(formatMicroUsd(17_000)).toBe("$0.02");
    expect(formatMicroUsd(1_234_000)).toBe("$1.23");
  });
  it("shows <$0.01 instead of a misleading $0.00", () => {
    expect(formatMicroUsd(3_000)).toBe("<$0.01");
    expect(formatMicroUsd(1_000)).toBe("<$0.01");
    expect(formatMicroUsd(4_000)).toBe("<$0.01");
  });
  it("zero is exactly $0.00", () => {
    expect(formatMicroUsd(0)).toBe("$0.00");
  });
  it("keeps the sign on an overdrawn balance, even below one cent", () => {
    expect(formatMicroUsd(-2_500_000)).toBe("-$2.50");
    expect(formatMicroUsd(-3_000)).toBe("-<$0.01");
  });
  it("degrades gracefully when the balance is missing or non-finite", () => {
    expect(formatMicroUsd(Number.NaN)).toBe("—");
    expect(formatMicroUsd(Number.POSITIVE_INFINITY)).toBe("—");
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

describe("explorerTxUrl", () => {
  it("builds the chain explorer tx url", () => {
    expect(explorerTxUrl("bsc", "0xabc")).toBe("https://bscscan.com/tx/0xabc");
    expect(explorerTxUrl("arb", "0xabc")).toBe("https://arbiscan.io/tx/0xabc");
    expect(explorerTxUrl("base", "0xabc")).toBe(
      "https://basescan.org/tx/0xabc",
    );
  });
});

describe("formatTopUpTime", () => {
  it("formats SQLite UTC to a non-empty string containing the year", () => {
    const out = formatTopUpTime("2026-08-16 12:00:00");
    expect(out.length).toBeGreaterThan(0);
    expect(out).toContain("2026");
  });
  it("falls back to the raw string on invalid input", () => {
    expect(formatTopUpTime("not-a-date")).toBe("not-a-date");
  });
});
