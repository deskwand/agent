import { getCodingSubscription } from "../../shared/coding-subscriptions";
import { oauthProfileKey } from "../../shared/oauth-utils";
import type { AppConfig, ProviderProfileKey } from "../types";

/** 与 utils/cloud-provider.ts 同形：调用方传自己的 t，模块不持有 i18n 实例。 */
type Translate = (key: string, opts?: { defaultValue: string }) => string;

export interface ConnectResult {
  config: AppConfig;
  /** 只有 OpenRouter 会带：模型列表回落到预置时把原因交回调用方决定怎么提示。 */
  openRouterModelsFromFallback?: { error?: string };
}

/**
 * 连接一个 OAuth 订阅通道，返回最新 AppConfig。
 *
 * 只做 IPC，不写 store：设置页用自己的 applyConfig，欢迎页等主进程推的
 * config.status。保存成功后才切 active —— 保存失败时切 active 会让 UI 出现
 * 「已连接」的假象。
 */
export async function connectOAuthProvider(
  providerId: string,
  name: string,
  t: Translate,
): Promise<ConnectResult> {
  if (providerId === "openrouter") {
    return connectOpenRouter(name, t);
  }

  const status = await window.electronAPI.auth.status(providerId);
  const force = Boolean(
    status?.loggedIn &&
    status?.expiresAt &&
    Date.now() / 1000 > status.expiresAt,
  );
  await window.electronAPI.auth.login(providerId, force);

  const profileKey = oauthProfileKey(providerId) as ProviderProfileKey;
  const saved = await window.electronAPI.config.saveProvider({
    profileKey,
    config: {
      provider: "oauth",
      customProtocol: "anthropic",
      name,
      apiKey: "", // credentials live in auth.json
      baseUrl: "",
      defaultModel: "",
      models: [],
      updatedAt: new Date().toISOString(),
    },
  });

  const defaultModel = saved.config.providers[profileKey]?.defaultModel;
  if (!defaultModel) {
    throw new Error(
      `Pi SDK returned no default model for OAuth provider ${providerId}`,
    );
  }
  const activated = await window.electronAPI.config.setActiveProvider({
    profileKey,
    defaultModel,
  });
  return { config: activated.config };
}

async function connectOpenRouter(
  name: string,
  t: Translate,
): Promise<ConnectResult> {
  const loginResult = await window.electronAPI.openrouterAuth.login();
  const modelsResult = await window.electronAPI.config.fetchOpenRouterModels();
  const defaultModel = modelsResult.models[0]?.id;
  if (!defaultModel) {
    throw new Error(t("api.oauthOpenRouterModelLoadError"));
  }
  // 不传 baseUrl：openrouter 不是 custom profile，主进程的 normalizeProviderConfig
  // 对非 custom 键一律用 fallbackProfile.baseUrl（config-store.ts 的 isCustomProfile
  // 分支与 defaultProfiles.openrouter），渲染进程传什么都会被覆盖。
  await window.electronAPI.config.saveProvider({
    profileKey: "openrouter" as ProviderProfileKey,
    config: {
      provider: "openrouter",
      customProtocol: "anthropic",
      name,
      apiKey: loginResult.apiKey,
      defaultModel,
      models: modelsResult.models,
      updatedAt: new Date().toISOString(),
    },
  });
  const activated = await window.electronAPI.config.setActiveProvider({
    profileKey: "openrouter" as ProviderProfileKey,
    defaultModel,
  });
  return {
    config: activated.config,
    openRouterModelsFromFallback: modelsResult.usedFallback
      ? { error: modelsResult.error }
      : undefined,
  };
}

/** 连接一个国内 Coding Plan 订阅（粘 Key）。校验与模型列表沿用设置页既有规则。 */
export async function connectCodingSubscription(
  profileKey: string,
  apiKey: string,
  t: Translate,
  preferredModel?: string,
): Promise<ConnectResult> {
  const plan = getCodingSubscription(profileKey);
  if (!plan) throw new Error(t("api.subscriptionInvalidPlan"));
  if (
    profileKey === "custom:subscription-bailian-coding" &&
    !apiKey.startsWith("sk-sp-")
  ) {
    throw new Error(t("api.subscriptionInvalidKey"));
  }
  const defaultModel =
    preferredModel && plan.modelIds.includes(preferredModel)
      ? preferredModel
      : plan.defaultModel;
  const saved = await window.electronAPI.config.saveProvider({
    profileKey: profileKey as ProviderProfileKey,
    config: {
      provider: "custom",
      customProtocol: "openai",
      name: plan.name,
      apiKey,
      baseUrl: plan.baseUrl,
      defaultModel,
      models: plan.modelIds.map((id) => ({
        id,
        label: id,
        source: "preset" as const,
      })),
      updatedAt: new Date().toISOString(),
    },
  });
  const activated = await window.electronAPI.config.setActiveProvider({
    profileKey: profileKey as ProviderProfileKey,
    defaultModel:
      saved.config.providers[profileKey as ProviderProfileKey]?.defaultModel ||
      defaultModel,
  });
  return { config: activated.config };
}
