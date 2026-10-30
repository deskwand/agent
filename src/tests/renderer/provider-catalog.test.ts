import { describe, expect, it } from "vitest";
import {
  PROVIDER_CATALOG,
  OAUTH_PROVIDERS,
} from "../../renderer/components/settings/provider-catalog";
import { API_PROVIDER_PRESETS } from "../../shared/api-model-presets";
import { CODING_SUBSCRIPTIONS } from "../../shared/coding-subscriptions";
import { getLocalGatewayPreset } from "../../shared/local-gateways";

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
        } else if (entry.kind === "local") {
          expect(getLocalGatewayPreset(entry.id)?.id, `local ${entry.id}`).toBe(
            entry.id,
          );
        } else if (entry.kind === "plan") {
          expect(
            CODING_SUBSCRIPTIONS.some((p) => p.profileKey === entry.id),
            `plan ${entry.id}`,
          ).toBe(true);
        } else {
          // cloud 指向应用自己的云服务，没有外部来源可校验。
          expect(entry.id, `cloud ${entry.id}`).toBe("deskwand");
        }
      }
    }
  });

  it("四类按固定顺序铺开", () => {
    expect(PROVIDER_CATALOG.map((c) => c.id)).toEqual([
      "subscription",
      "vendor",
      "relay",
      "local",
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

describe("目录条目扩展", () => {
  function flatEntries() {
    return PROVIDER_CATALOG.flatMap((category) => [...category.entries]);
  }

  it("订阅组首位是 DeskWand 云服务", () => {
    const first = PROVIDER_CATALOG[0].entries[0];
    expect(first.kind).toBe("cloud");
    expect(first.id).toBe("deskwand");
  });

  it("厂商条目带取 key 页地址", () => {
    const deepseek = flatEntries().find(
      (entry) => entry.kind === "provider" && entry.id === "deepseek",
    );
    expect(deepseek?.keyUrl).toBe("https://platform.deepseek.com/api_keys");
  });

  it("引导页精简集是 compact 条目的子集", () => {
    const compact = flatEntries().filter((entry) => entry.compact);
    expect(compact.length).toBeGreaterThanOrEqual(6);
    expect(compact.length).toBeLessThan(flatEntries().length);
  });

  it("搜索词覆盖厂商域名，供搜索框匹配", () => {
    const anthropic = flatEntries().find(
      (entry) => entry.kind === "provider" && entry.id === "anthropic",
    );
    expect(anthropic?.searchTerms).toContain("api.anthropic.com");
  });
});
