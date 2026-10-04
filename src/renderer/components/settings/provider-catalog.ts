/**
 * provider 分类目录：API 设置页主模型 tab 的分类网格按这里渲染。
 *
 * 只服务这一页的排版（分类顺序、i18n 键名），主进程没有消费者，
 * 所以放 renderer 而不是 src/shared。
 */

/** OAuth 登录类供应商：登录即可，无需密钥。 */
export const OAUTH_PROVIDERS = [
  {
    id: "openai-codex",
    name: "OpenAI Codex",
    descriptionKey: "api.oauthOpenAIDesc",
    noteKey: "",
    brand: "openai",
  },
  {
    id: "github-copilot",
    name: "GitHub Copilot",
    descriptionKey: "api.oauthGitHubDesc",
    noteKey: "",
    brand: "github",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    descriptionKey: "api.oauthAnthropicDesc",
    noteKey: "api.oauthAnthropicNote",
    brand: "anthropic",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    descriptionKey: "api.oauthOpenRouterDesc",
    noteKey: "",
    brand: "openrouter",
  },
] as const;

export type ProviderCategoryId = "subscription" | "vendor" | "relay";
export type CatalogEntryKind = "oauth" | "provider" | "plan";

export interface ProviderCatalogEntry {
  kind: CatalogEntryKind;
  /** oauth: OAuth provider id；provider: ProviderType；plan: profile key */
  id: string;
  /** 覆盖显示名；provider 类留空取 presets[id].name，oauth 类留空取 OAUTH_PROVIDERS[].name */
  labelKey?: string;
}

export interface ProviderCatalogCategory {
  id: ProviderCategoryId;
  entries: readonly ProviderCatalogEntry[];
}

export const CATEGORY_I18N: Record<
  ProviderCategoryId,
  { title: string; hint: string }
> = {
  subscription: {
    title: "api.categorySubscription",
    hint: "api.categorySubscriptionHint",
  },
  vendor: { title: "api.categoryVendor", hint: "api.categoryVendorHint" },
  relay: { title: "api.categoryRelay", hint: "api.categoryRelayHint" },
};

export const PROVIDER_CATALOG: readonly ProviderCatalogCategory[] = [
  {
    id: "subscription",
    entries: [
      // 订阅类显示 Claude（产品名），供应商类显示 Anthropic（公司名），与参考图一致。
      { kind: "oauth", id: "anthropic", labelKey: "api.catalogClaude" },
      { kind: "oauth", id: "openai-codex" },
      { kind: "oauth", id: "github-copilot" },
      { kind: "oauth", id: "openrouter" },
    ],
  },
  {
    id: "vendor",
    entries: [
      { kind: "provider", id: "anthropic" },
      { kind: "provider", id: "openai" },
      { kind: "provider", id: "gemini" },
      { kind: "provider", id: "deepseek" },
      { kind: "provider", id: "zhipu" },
      { kind: "provider", id: "custom" },
    ],
  },
  {
    id: "relay",
    entries: [
      { kind: "provider", id: "openrouter" },
      { kind: "provider", id: "opencode" },
      { kind: "provider", id: "opencode-go" },
      { kind: "plan", id: "custom:subscription-bailian-coding" },
      { kind: "plan", id: "custom:subscription-ark-coding" },
    ],
  },
];
