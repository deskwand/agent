import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const cardPath = path.resolve(
  process.cwd(),
  "src/renderer/components/MessageCard.tsx",
);
const storePath = path.resolve(process.cwd(), "src/renderer/store/index.ts");

describe("Insufficient credits card", () => {
  it("MessageCard renders topup card when code is INSUFFICIENT_BALANCE", () => {
    const source = fs.readFileSync(cardPath, "utf8");
    expect(source).toContain('message.code === "INSUFFICIENT_BALANCE"');
    expect(source).toContain("topUp.goTopUp");
    expect(source).toContain("setTopUpOpen(true)");
  });

  it("store exposes topUpOpen state and setter", () => {
    const source = fs.readFileSync(storePath, "utf8");
    expect(source).toContain("topUpOpen: false");
    expect(source).toContain("setTopUpOpen");
  });
});
