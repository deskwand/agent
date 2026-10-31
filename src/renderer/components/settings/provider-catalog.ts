/**
 * provider 分类目录：API 设置页的目录页按这里渲染。
 *
 * 只服务这一页的排版（分类顺序、i18n 键名、取 key 页地址、引导页精简集），
 * 主进程没有消费者，所以放 renderer 而不是 src/shared。
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

export type ProviderCategoryId = "subscription" | "vendor" | "relay" | "local";
export type CatalogEntryKind =
  | "oauth"
  | "provider"
  | "plan"
  | "local"
  | "cloud";

export interface ProviderCatalogEntry {
  kind: CatalogEntryKind;
  /** oauth: OAuth provider id；provider: ProviderType；plan: profile key；cloud/local: 固定 id */
  id: string;
  /** 覆盖显示名；留空按 kind 取默认来源 */
  labelKey?: string;
  /** 「获取 Key ↗」的目标页；只在有稳定取 key 页面的厂商上填 */
  keyUrl?: string;
  /** 进引导页精简集（不分组渲染）。只给「一步就能成」的入口 */
  compact?: boolean;
  /** 额外搜索词（域名、别名），让搜索框能按域名命中 */
  searchTerms?: readonly string[];
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
  local: { title: "api.categoryLocal", hint: "api.categoryLocalHint" },
};

export const PROVIDER_CATALOG: readonly ProviderCatalogCategory[] = [
  {
    id: "subscription",
    entries: [
      // DeskWand 自己的云服务排首位：首次启动最快的路，不需要任何 key。
      {
        kind: "cloud",
        id: "deskwand",
        labelKey: "connect.rowDeskwand",
        compact: true,
        searchTerms: ["deskwand", "cloud", "云服务", "登录"],
      },
      // 订阅类显示 Claude（产品名），供应商类显示 Anthropic（公司名），与参考图一致。
      {
        kind: "oauth",
        id: "anthropic",
        labelKey: "api.catalogClaude",
        compact: true,
        searchTerms: ["claude", "anthropic", "订阅"],
      },
      {
        kind: "oauth",
        id: "openai-codex",
        compact: true,
        searchTerms: ["chatgpt", "codex", "openai"],
      },
      {
        kind: "oauth",
        id: "github-copilot",
        compact: true,
        searchTerms: ["copilot", "github"],
      },
      {
        kind: "oauth",
        id: "openrouter",
        compact: true,
        searchTerms: ["openrouter"],
      },
    ],
  },
  {
    id: "vendor",
    entries: [
      {
        kind: "provider",
        id: "anthropic",
        compact: true,
        keyUrl: "https://console.anthropic.com/settings/keys",
        searchTerms: ["api.anthropic.com", "claude"],
      },
      {
        kind: "provider",
        id: "openai",
        keyUrl: "https://platform.openai.com/api-keys",
        searchTerms: ["api.openai.com", "gpt"],
      },
      {
        kind: "provider",
        id: "gemini",
        keyUrl: "https://aistudio.google.com/apikey",
        searchTerms: ["googleapis.com", "google"],
      },
      {
        kind: "provider",
        id: "deepseek",
        compact: true,
        keyUrl: "https://platform.deepseek.com/api_keys",
        searchTerms: ["api.deepseek.com"],
      },
      {
        kind: "provider",
        id: "zhipu",
        keyUrl: "https://open.bigmodel.cn/usercenter/apikeys",
        searchTerms: ["bigmodel.cn", "z.ai", "glm", "智谱"],
      },
      {
        kind: "provider",
        id: "custom",
        compact: true,
        searchTerms: ["custom", "url", "兼容", "自定义"],
      },
    ],
  },
  {
    id: "relay",
    entries: [
      {
        kind: "provider",
        id: "openrouter",
        searchTerms: ["openrouter.ai", "中转"],
      },
      {
        kind: "provider",
        id: "opencode",
        searchTerms: ["opencode.ai", "zen"],
      },
      {
        kind: "provider",
        id: "opencode-go",
        searchTerms: ["opencode.ai", "go"],
      },
      // 订阅套餐也是「粘一把 key 就能成」，进引导页精简集
      {
        kind: "plan",
        id: "custom:subscription-bailian-coding",
        compact: true,
        searchTerms: ["bailian", "百炼", "阿里"],
      },
      {
        kind: "plan",
        id: "custom:subscription-ark-coding",
        compact: true,
        searchTerms: ["ark", "火山", "volcengine"],
      },
    ],
  },
  {
    id: "local",
    entries: [
      {
        kind: "local",
        id: "magpie",
        compact: true,
        searchTerms: ["magpie", "本机", "local", "127.0.0.1"],
      },
    ],
  },
];
