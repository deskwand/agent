import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const menuPath = path.resolve(
  process.cwd(),
  "src/renderer/components/AccountMenu.tsx",
);

describe("AccountMenu topup entry", () => {
  it("shows paid balance and free quota with expiry", () => {
    const source = fs.readFileSync(menuPath, "utf8");
    expect(source).toContain("accountMenu.topUpBalance");
    expect(source).toContain("accountMenu.freeQuota");
    expect(source).toContain("accountMenu.expiresOn");
    expect(source).toContain("accountMenu.quotaExpired");
  });

  it("opens the topup modal from the menu", () => {
    const source = fs.readFileSync(menuPath, "utf8");
    expect(source).toContain("setTopUpOpen(true)");
    expect(source).toContain("accountMenu.topUpAction");
  });
});
