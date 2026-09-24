import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  "src/renderer/components/settings/SettingsAPI.tsx",
  "utf8",
);

describe("coding subscription settings wiring", () => {
  it("uses the config IPC rather than OAuth for subscription keys", () => {
    expect(source).toContain("<CodingSubscriptionCards");
    expect(source).toContain("handleSubscriptionSave");
    expect(source).toContain("handleSubscriptionDelete");
    expect(source).toContain("config.saveProvider({");
    expect(source).toContain("config.deleteProvider({");
  });

  it("excludes subscriptions from the generic API editor", () => {
    expect(source).toContain("!isCodingSubscriptionProfileKey(profileKey)");
  });
});
