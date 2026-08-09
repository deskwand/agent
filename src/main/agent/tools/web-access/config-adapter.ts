import type { AppConfig } from "../../../config/config-store";
import { resolveProviderApiKey } from "../../shared-model-runtime";
import { extractOAuthProviderId } from "../../../../shared/oauth-utils";
import type {
  WebAccessAuthProvider,
  WebAccessCredential,
} from "../../../../shared/web-access";

const OPENAI_BASE_URL = "https://api.openai.com/v1";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com";
const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEEPSEEK_SEARCH_MODEL = "deepseek-v4-flash";

export interface OpenAIWebSearchAuth {
  provider: "openai" | "openai-codex";
  apiKey: string;
  baseUrl: string;
  model: string;
  headers: Record<string, string>;
}

export interface GeminiApiAuth {
  provider: "gemini";
  apiKey: string;
  baseUrl: string;
}

export interface DeepSeekWebSearchAuth {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export type ResolvedWebAccessAuth =
  | OpenAIWebSearchAuth
  | GeminiApiAuth
  | DeepSeekWebSearchAuth;
export type OAuthTokenResolver = (
  providerId: string,
) => Promise<string | undefined>;
export type ResolveWebAccessProviderAuth = (
  provider: WebAccessAuthProvider,
  credential: WebAccessCredential,
) => Promise<ResolvedWebAccessAuth | undefined>;

function dedicatedAuth(
  provider: WebAccessAuthProvider,
  credential: WebAccessCredential,
): ResolvedWebAccessAuth | undefined {
  if (provider === "deepseek") {
    // 本地代理场景 apiKey 可为空；但全空（无 key 无 baseUrl）视为未配置，
    // 避免 auto 链在 exa 失败后对官方端点做确定性无效请求
    if (!credential.apiKey.trim() && !credential.baseUrl.trim()) {
      return undefined;
    }
    return {
      apiKey: credential.apiKey.trim(),
      baseUrl: credential.baseUrl.trim() || DEEPSEEK_BASE_URL,
      model: DEEPSEEK_SEARCH_MODEL,
    };
  }
  const apiKey = credential.apiKey.trim();
  if (!apiKey) return undefined;
  if (provider === "openai") {
    return {
      provider: "openai",
      apiKey,
      baseUrl: credential.baseUrl.trim() || OPENAI_BASE_URL,
      model: "gpt-5.4",
      headers: {},
    };
  }
  return {
    provider: "gemini",
    apiKey,
    baseUrl: credential.baseUrl.trim() || GEMINI_BASE_URL,
  };
}

export async function resolveWebAccessProviderAuth(
  provider: WebAccessAuthProvider,
  credential: WebAccessCredential,
  appConfig: AppConfig,
  resolveOAuthToken: OAuthTokenResolver = resolveProviderApiKey,
): Promise<ResolvedWebAccessAuth | undefined> {
  if (credential.source === "dedicated") {
    return dedicatedAuth(provider, credential);
  }

  const profileKey = credential.profileKey.trim();
  if (!profileKey) return undefined;
  const profile = appConfig.providers[profileKey];
  if (!profile) return undefined;

  const oauthProviderId = extractOAuthProviderId(profileKey);
  if (provider === "openai" && oauthProviderId === "openai-codex") {
    const apiKey = await resolveOAuthToken(oauthProviderId);
    return apiKey
      ? {
          provider: "openai-codex",
          apiKey,
          baseUrl: "https://chatgpt.com/backend-api/codex",
          model: "gpt-5.4",
          headers: {},
        }
      : undefined;
  }
  if (profile.provider === "oauth") return undefined;

  if (provider === "deepseek") {
    if (profile.provider !== "deepseek" && profileKey !== "deepseek") {
      return undefined;
    }
    if (!profile.apiKey.trim() && !profile.baseUrl?.trim()) {
      return undefined;
    }
    return {
      apiKey: profile.apiKey.trim(),
      baseUrl: profile.baseUrl?.trim() || DEEPSEEK_BASE_URL,
      model: DEEPSEEK_SEARCH_MODEL,
    };
  }

  const apiKey = profile.apiKey.trim();
  if (!apiKey) return undefined;
  if (
    provider === "openai" &&
    (profile.provider === "openai" || profile.customProtocol === "openai")
  ) {
    return {
      provider: "openai",
      apiKey,
      baseUrl: profile.baseUrl?.trim() || OPENAI_BASE_URL,
      model: "gpt-5.4",
      headers: {},
    };
  }
  if (
    provider === "gemini" &&
    (profile.provider === "gemini" || profile.customProtocol === "gemini")
  ) {
    return {
      provider: "gemini",
      apiKey,
      baseUrl: profile.baseUrl?.trim() || GEMINI_BASE_URL,
    };
  }
  return undefined;
}

/**
 * DeepSeekWebSearchAuth 没有 provider 字段，其余两种都有。
 * 注意：此判别依赖该结构差异——若未来 DeepSeekWebSearchAuth
 * 增加 provider 字段或联合类型新增无 provider 字段的成员，需同步调整。
 */
export function isDeepSeekAuth(
  auth: ResolvedWebAccessAuth,
): auth is DeepSeekWebSearchAuth {
  return !("provider" in auth);
}
