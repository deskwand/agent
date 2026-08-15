import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const menuPath = path.resolve(
  process.cwd(),
  "src/renderer/components/AccountMenu.tsx",
);

describe("AccountMenu balance row", () => {
  const source = fs.readFileSync(menuPath, "utf8");

  it("shows balance with a Coins icon and inline top-up button", () => {
    expect(source).toContain("Coins");
    expect(source).toContain("accountMenu.balance");
    expect(source).toContain("accountMenu.topUpAction");
  });

  it("refreshes balance on open via getMe", () => {
    expect(source).toContain("getMe");
    expect(source).toContain("creditsBalance");
    expect(source).toContain("useEffect");
  });

  it("no longer renders the standalone top-up menu row", () => {
    expect(source).not.toContain('label={t("accountMenu.topUpAction")}');
  });
});
