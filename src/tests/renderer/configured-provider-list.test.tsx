// @vitest-environment jsdom
// 组件本身已由 provider-list-page.tsx 取代；这里只保留行品牌与 OAuth profile 的解析规则，
// 它们是列表页与详情页共用的纯函数。
import { describe, expect, it } from "vitest";
import "../../renderer/i18n/config";
import {
  oauthProviderIdForProfile,
  rowBrand,
} from "../../renderer/components/settings/configured-provider-list";
import type { ApiProviderConfig } from "../../renderer/types";

const openrouterConfig: ApiProviderConfig = {
  provider: "openrouter",
  customProtocol: "anthropic",
  name: "",
  apiKey: "sk-or-v1-test",
  baseUrl: "https://openrouter.ai/api/v1",
  defaultModel: "openrouter/free",
  models: [
    { id: "openrouter/free", label: "Free", source: "preset" },
    { id: "openrouter/paid", label: "Paid", source: "preset" },
  ],
  updatedAt: "2024-01-01T00:00:00.000Z",
};

describe("configured provider row helpers", () => {
  it("oauth: 前缀的 profile key 能还原出 provider id", () => {
    expect(oauthProviderIdForProfile("openrouter")).toBe("openrouter");
    expect(oauthProviderIdForProfile("oauth:openai-codex")).toBe(
      "openai-codex",
    );
  });

  it("只有登录写入的 profile 才被当成 OAuth 行", () => {
    // anthropic 用 API Key 配时不能走 OAuth 分支，否则会与 oauth:anthropic 撞 testid
    expect(oauthProviderIdForProfile("anthropic")).toBeUndefined();
    expect(oauthProviderIdForProfile("custom:sub-1")).toBeUndefined();
    expect(oauthProviderIdForProfile("oauth:anthropic")).toBe("anthropic");
  });

  it("oauth profile 的图标来自目录里的 OAuth 条目，不是 Server 兜底", () => {
    // config.provider 是合成值 "oauth"，预设表与 BRAND_SPECS 都没有它；
    // 品牌只能从 OAUTH_PROVIDERS[].brand 取，否则整行渲染成 Server 占位图。
    const oauthConfig = { ...openrouterConfig, provider: "oauth" as const };
    expect(rowBrand("oauth:openai-codex", oauthConfig)).toBe("openai");
    expect(rowBrand("oauth:anthropic", oauthConfig)).toBe("anthropic");
    expect(rowBrand("oauth:github-copilot", oauthConfig)).toBe("github");
  });

  it("非 oauth 行的品牌仍按 provider / 协议解析", () => {
    expect(rowBrand("openrouter", openrouterConfig)).toBe("openrouter");
    expect(
      rowBrand("deepseek", { ...openrouterConfig, provider: "deepseek" }),
    ).toBe("deepseek");
    // 自定义 endpoint 按协议取品牌
    expect(
      rowBrand("custom:x", {
        ...openrouterConfig,
        provider: "custom",
        customProtocol: "anthropic",
      }),
    ).toBe("anthropic");
  });
});
