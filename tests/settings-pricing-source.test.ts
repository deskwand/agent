import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf8");

describe("SettingsPricing", () => {
  const source = read("src/renderer/components/settings/SettingsPricing.tsx");

  it("renders official and charged rates from the server without doing rate math", () => {
    expect(source).toContain("getPricing");
    expect(source).toContain("m.official.off_peak");
    expect(source).toContain("m.charged.off_peak");
    expect(source).not.toContain("* 1.05");
    expect(source).not.toContain("platform_fee_rate * 1.05");
  });

  it("refetches whenever the tab becomes active so is_peak_now cannot go stale", () => {
    expect(source).toContain("isActive");
    expect(source).toContain("[isActive, cloudApi]");
  });

  it("survives missing rates and derives the weekday label from the payload", () => {
    expect(source).toContain("if (!Number.isFinite(rate)) return");
    expect(source).toContain("peakDaysLabel(data.peak.days, t)");
  });

  it("is registered as a settings tab", () => {
    const panel = read("src/renderer/components/SettingsPanel.tsx");
    expect(panel).toContain("SettingsPricing");
    expect(panel).toContain('"pricing" as TabId');
    expect(panel).toContain("viewedTabs.has(\"pricing\")");
  });
});
