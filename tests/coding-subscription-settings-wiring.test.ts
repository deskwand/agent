import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  "src/renderer/components/settings/SettingsAPI.tsx",
  "utf8",
);

describe("coding subscription settings wiring", () => {
  it("delegates subscription keys to the shared connect module", () => {
    expect(source).toContain("<CodingSubscriptionCards");
    expect(source).toContain("handleSubscriptionSave");
    expect(source).toContain("handleSubscriptionDelete");
    expect(source).toContain("connectCodingSubscription(");
    expect(source).toContain("config.deleteProvider({");
  });

  it("delegates oauth logins to the shared connect module", () => {
    expect(source).toContain("connectOAuthProvider(");
  });

  it("excludes subscriptions from the generic API editor", () => {
    expect(source).toContain("!isCodingSubscriptionProfileKey(profileKey)");
  });
});
