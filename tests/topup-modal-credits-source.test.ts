import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf8");

describe("USD-only top-up display", () => {
  it("removes the credit conversion helpers from topup.ts", () => {
    const topup = read("src/renderer/utils/topup.ts");
    expect(topup).not.toContain("CREDITS_PER_USD");
    expect(topup).not.toContain("usdForCredits");
    expect(topup).not.toContain("creditsForAmountCents");
    expect(topup).toContain("export function formatMicroUsd");
  });

  it("calls formatMicroUsd in the modal instead of converting cents to credits", () => {
    const modal = read("src/renderer/components/TopUpModal.tsx");
    expect(modal).toContain("formatMicroUsd(");
    expect(modal).not.toContain("creditsForAmountCents");
    expect(modal).not.toContain("usdForCredits");
    expect(modal).not.toContain("topUp.amountEqualsCredits");
  });

  it("reports the amount the server actually credited, never the ordered amount", () => {
    const modal = read("src/renderer/components/TopUpModal.tsx");
    expect(modal).not.toContain("creditedMicroUsd ??");
    expect(modal).toContain("formatMicroUsd(creditedMicroUsd)");
    expect(modal).toContain("topUp.confirmedAmountPending");
    // 轮询被取消后不得写入状态
    expect(modal).toContain("!cancelled && o.status === \"confirmed\"");
  });

  it("drops the credit wording from both locales", () => {
    for (const locale of ["zh", "en"]) {
      const json = read(`src/renderer/i18n/locales/${locale}.json`);
      expect(json).not.toContain('"amountEqualsCredits"');
      expect(json).not.toContain('"creditsHint"');
      expect(json).not.toContain('"creditsWithUsd"');
      expect(json).not.toContain('"creditsUnit"');
      // 只传 usd 参数，任何 {{credits}} 占位符都会原样渲染给用户
      expect(json).not.toContain("{{credits}}");
    }
  });
});
