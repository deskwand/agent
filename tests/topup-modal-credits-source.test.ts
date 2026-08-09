import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const modalPath = path.resolve(
  process.cwd(),
  "src/renderer/components/TopUpModal.tsx",
);
const zhPath = path.resolve(process.cwd(), "src/renderer/i18n/locales/zh.json");
const enPath = path.resolve(process.cwd(), "src/renderer/i18n/locales/en.json");

describe("TopUpModal dual-unit display", () => {
  it("uses bidirectional conversion and usd in success hint", () => {
    const source = fs.readFileSync(modalPath, "utf8");
    expect(source).toContain("topUp.amountEqualsCredits");
    expect(source).toContain("usdForCredits");
    expect(source).not.toContain("topUp.creditsHint");
  });

  it("drops creditsHint and unused creditsWithUsd, keeps amountEqualsCredits", () => {
    const zh = fs.readFileSync(zhPath, "utf8");
    const en = fs.readFileSync(enPath, "utf8");
    expect(zh).not.toContain('"creditsHint"');
    expect(en).not.toContain('"creditsHint"');
    expect(zh).not.toContain('"creditsWithUsd"');
    expect(en).not.toContain('"creditsWithUsd"');
    expect(zh).toContain('"amountEqualsCredits"');
    expect(en).toContain('"amountEqualsCredits"');
  });
});
