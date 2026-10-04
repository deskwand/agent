import { describe, expect, it } from "vitest";
import {
  PROVIDER_CATALOG,
  OAUTH_PROVIDERS,
} from "../../renderer/components/settings/provider-catalog";
import { API_PROVIDER_PRESETS } from "../../shared/api-model-presets";
import { CODING_SUBSCRIPTIONS } from "../../shared/coding-subscriptions";

describe("provider catalog", () => {
  it("每个条目都钉在一个真实存在的来源上", () => {
    for (const category of PROVIDER_CATALOG) {
      for (const entry of category.entries) {
        if (entry.kind === "oauth") {
          expect(
            OAUTH_PROVIDERS.some((p) => p.id === entry.id),
            `oauth ${entry.id}`,
          ).toBe(true);
        } else if (entry.kind === "provider") {
          expect(
            Object.keys(API_PROVIDER_PRESETS),
            `provider ${entry.id}`,
          ).toContain(entry.id);
        } else {
          expect(
            CODING_SUBSCRIPTIONS.some((p) => p.profileKey === entry.id),
            `plan ${entry.id}`,
          ).toBe(true);
        }
      }
    }
  });

  it("三类按固定顺序铺开", () => {
    expect(PROVIDER_CATALOG.map((c) => c.id)).toEqual([
      "subscription",
      "vendor",
      "relay",
    ]);
  });

  it("没有重复的 kind+id", () => {
    const keys = PROVIDER_CATALOG.flatMap((c) =>
      c.entries.map((e) => `${e.kind}:${e.id}`),
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("订阅类的 Anthropic 用 Claude 作为显示名，与供应商类区分", () => {
    const subscription = PROVIDER_CATALOG.find((c) => c.id === "subscription");
    const claude = subscription?.entries.find((e) => e.id === "anthropic");
    expect(claude?.labelKey).toBe("api.catalogClaude");
  });
});
