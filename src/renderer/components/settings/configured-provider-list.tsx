import type { ApiProviderConfig, ProviderType } from "../../types";
import {
  ProviderBrandIcon,
  resolveProviderBrand,
  type ProviderBrand,
} from "./provider-icons";
import { OAUTH_PROVIDERS } from "./provider-catalog";

export interface ConfiguredProviderRow {
  profileKey: string;
  config: ApiProviderConfig;
}

/**
 * 只有 OpenRouter 的登录写裸 profile key，其余登录都写 `oauth:<id>`
 * （见 services/connect-provider.ts）。所以白名单只有它：否则一个用 API Key
 * 配的 `anthropic` profile 会被当成 OAuth 行，登出按钮也会与 `oauth:anthropic` 撞。
 */
const BARE_OAUTH_PROFILE_KEYS = new Set(["openrouter"]);

/** 行对应的 OAuth provider id；不是登录写入的 profile 就返回 undefined。 */
export function oauthProviderIdForProfile(
  profileKey: string,
): string | undefined {
  if (profileKey.startsWith("oauth:")) return profileKey.slice("oauth:".length);
  return BARE_OAUTH_PROFILE_KEYS.has(profileKey) ? profileKey : undefined;
}

/**
 * 行的品牌图标。
 *
 * oauth profile 存的 `config.provider` 是合成值 `"oauth"`，它既不在预设表里、
 * 也不在 BRAND_SPECS 里，直接送进 resolveProviderBrand 只会拿到 undefined，
 * 整行就渲染成 Server 占位图。品牌只能从目录的 OAuth 条目取。
 */
export function rowBrand(
  profileKey: string,
  config: ApiProviderConfig,
): ProviderBrand | ProviderType {
  // 应用自己的云端 profile 不是品牌供应商；它的 customProtocol 是 openai，
  // 不挡住的话会套上 OpenAI 的标。
  if (profileKey === "custom:deskwand") return "custom";
  if (config.localGateway === "magpie") return "magpie";
  const oauthId = oauthProviderIdForProfile(profileKey);
  const oauthEntry = oauthId
    ? OAUTH_PROVIDERS.find((p) => p.id === oauthId)
    : undefined;
  if (oauthEntry) return oauthEntry.brand;
  return (
    resolveProviderBrand(config.provider, config.customProtocol) ?? "custom"
  );
}

export function hostOf(baseUrl?: string): string | undefined {
  if (!baseUrl) return undefined;
  try {
    return new URL(baseUrl).host;
  } catch {
    return undefined;
  }
}

export { ProviderBrandIcon };
