import type { AppConfig } from "../../../config/config-store";
import { ensureFreshOAuthToken } from "../../shared-auth";
import { extractOAuthProviderId } from "../../../../shared/oauth-utils";
import type {
  WebAccessAuthProvider,
  WebAccessCredential,
} from "../../../../shared/web-access";

const OPENAI_BASE_URL = "https://api.openai.com/v1";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com";

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

export type ResolvedWebAccessAuth = OpenAIWebSearchAuth | GeminiApiAuth;
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
  resolveOAuthToken: OAuthTokenResolver = ensureFreshOAuthToken,
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
