import { describe, expect, it } from "vitest";
import "../../renderer/i18n/config";
import i18n from "../../renderer/i18n/config";
import {
  entryBrand,
  entryForProfile,
  entryKeyUrl,
  entryLabel,
  entryProfileKey,
  entrySubtitle,
} from "../../renderer/components/settings/api/provider-entry";
import {
  PROVIDER_CATALOG,
  type ProviderCatalogEntry,
} from "../../renderer/components/settings/provider-catalog";
import type { ApiProviderConfig } from "../../renderer/types";
import { API_PROVIDER_PRESETS } from "../../shared/api-model-presets";

const t = (key: string) => i18n.t(key);
const presets = API_PROVIDER_PRESETS;
const deepseek: ProviderCatalogEntry = { kind: "provider", id: "deepseek" };

describe("目录条目渲染源", () => {
  it("预设供应商显示预设名，不是裸 id", () => {
    expect(entryLabel(deepseek, presets, t)).toBe("DeepSeek");
  });

  it("副标题给出 host，方便区分同厂商不同站", () => {
    expect(entrySubtitle(deepseek, presets, t)).toBe("api.deepseek.com");
  });

  it("自定义条目的名字走「其他供应商」，不是 custom", () => {
    const custom: ProviderCatalogEntry = { kind: "provider", id: "custom" };
    expect(entryLabel(custom, presets, t)).not.toBe("custom");
    expect(entryLabel(custom, presets, t).length).toBeGreaterThan(0);
  });

  it("云服务条目认得出云图标与 profile 前缀", () => {
    const cloud: ProviderCatalogEntry = { kind: "cloud", id: "deskwand" };
    expect(entryBrand(cloud)).toBe("custom");
    expect(entryProfileKey(cloud)).toBe("custom:deskwand");
  });

  it("plan 条目的 profile key 就是它的 id", () => {
    const plan: ProviderCatalogEntry = {
      kind: "plan",
      id: "custom:subscription-bailian-coding",
    };
    expect(entryProfileKey(plan)).toBe("custom:subscription-bailian-coding");
  });

  it("oauth / local 没有 profile key（它们各自走登录与探测）", () => {
    expect(entryProfileKey({ kind: "oauth", id: "anthropic" })).toBeUndefined();
    expect(entryProfileKey({ kind: "local", id: "magpie" })).toBeUndefined();
  });

  it("只有带 keyUrl 的条目才有取 key 链接", () => {
    const withKey = PROVIDER_CATALOG.flatMap((c) => [...c.entries]).find(
      (entry) => entry.kind === "provider" && entry.id === "deepseek",
    )!;
    expect(entryKeyUrl(withKey)).toContain("deepseek");
    expect(entryKeyUrl({ kind: "oauth", id: "anthropic" })).toBeUndefined();
  });
});

describe("entryForProfile", () => {
  const baseConfig: ApiProviderConfig = {
    provider: "deepseek",
    customProtocol: "openai",
    apiKey: "sk-x",
    baseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    models: [],
    updatedAt: "2024-01-01T00:00:00.000Z",
  };

  it("普通供应商回推成 provider 条目", () => {
    expect(entryForProfile("deepseek", baseConfig)).toEqual({
      kind: "provider",
      id: "deepseek",
    });
  });

  it("oauth profile 去掉前缀后回推成 oauth 条目", () => {
    expect(
      entryForProfile("oauth:openai-codex", {
        ...baseConfig,
        provider: "oauth",
      }),
    ).toEqual({ kind: "oauth", id: "openai-codex" });
  });

  it("本机网关回推成 local 条目（localGateway 优先于 provider）", () => {
    expect(
      entryForProfile("custom:magpie", {
        ...baseConfig,
        provider: "custom",
        localGateway: "magpie",
      }),
    ).toEqual({ kind: "local", id: "magpie" });
  });
});
