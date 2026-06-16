import { useMemo } from "react";
import { API_PROVIDER_PRESETS } from "../../shared/api-model-presets";
import { useAppStore } from "../store";
import type {
  ApiProviderConfig,
  AppConfig,
  CustomProtocolType,
  ProviderPreset,
  ProviderPresets,
  ProviderProfile,
  ProviderProfileKey,
  ProviderType,
} from "../types";

export const FALLBACK_PROVIDER_PRESETS: ProviderPresets = API_PROVIDER_PRESETS;

export interface UIProviderProfile {
  apiKey: string;
  baseUrl: string;
  model: string;
  customModel: string;
  useCustomModel: boolean;
  contextWindow: string;
  maxTokens: string;
}

export interface ConfigStateSnapshot {
  activeProfileKey: ProviderProfileKey;
  profiles: Record<ProviderProfileKey, UIProviderProfile>;
  enableThinking: boolean;
}

export interface ApiConfigBootstrap {
  snapshot: ConfigStateSnapshot;
  activeProviderKey: ProviderProfileKey;
  providers: Partial<Record<ProviderProfileKey, ApiProviderConfig>>;
}

const PROFILE_KEYS: ProviderProfileKey[] = [
  "openrouter",
  "anthropic",
  "deepseek",
  "openai",
  "gemini",
  "custom:anthropic",
  "custom:openai",
  "custom:gemini",
];

export function profileKeyFromProvider(
  provider: ProviderType,
  customProtocol: CustomProtocolType = "anthropic",
): ProviderProfileKey {
  if (provider !== "custom") {
    return provider as ProviderProfileKey;
  }
  if (customProtocol === "openai") {
    return "custom:openai";
  }
  if (customProtocol === "gemini") {
    return "custom:gemini";
  }
  return "custom:anthropic";
}

export function profileKeyToProvider(profileKey: ProviderProfileKey): {
  provider: ProviderType;
  customProtocol: CustomProtocolType;
} {
  if (profileKey === "custom:openai")
    return { provider: "custom", customProtocol: "openai" };
  if (profileKey === "custom:gemini")
    return { provider: "custom", customProtocol: "gemini" };
  if (profileKey === "custom:anthropic")
    return { provider: "custom", customProtocol: "anthropic" };
  if (profileKey === "openai")
    return { provider: "openai", customProtocol: "openai" };
  if (profileKey === "deepseek")
    return { provider: "deepseek", customProtocol: "openai" };
  if (profileKey === "gemini")
    return { provider: "gemini", customProtocol: "gemini" };
  return { provider: profileKey, customProtocol: "anthropic" };
}

function presetForProfile(
  profileKey: ProviderProfileKey,
  presets: ProviderPresets,
): ProviderPreset {
  if (profileKey === "custom:openai") return presets.openai;
  if (profileKey === "custom:gemini") return presets.gemini;
  if (profileKey === "custom:anthropic") return presets.custom;
  return presets[profileKey];
}

function normalizeProfile(
  profileKey: ProviderProfileKey,
  profile: Partial<ProviderProfile> | undefined,
  presets: ProviderPresets,
): UIProviderProfile {
  const preset = presetForProfile(profileKey, presets);
  const modelValue = profile?.model?.trim() || preset.models[0]?.id || "";
  const hasPresetModel = preset.models.some((item) => item.id === modelValue);
  return {
    apiKey: profile?.apiKey || "",
    baseUrl: profile?.baseUrl || preset.baseUrl,
    model: hasPresetModel ? modelValue : preset.models[0]?.id || modelValue,
    customModel: hasPresetModel ? "" : modelValue,
    useCustomModel: !hasPresetModel,
    contextWindow: profile?.contextWindow ? String(profile.contextWindow) : "",
    maxTokens: profile?.maxTokens ? String(profile.maxTokens) : "",
  };
}

export function buildApiConfigSnapshot(
  config: AppConfig | null | undefined,
  presets: ProviderPresets,
): ConfigStateSnapshot {
  const activeProfileKey =
    config?.activeProviderKey || config?.activeProfileKey || "openrouter";
  const profiles = {} as Record<ProviderProfileKey, UIProviderProfile>;
  for (const key of PROFILE_KEYS) {
    const providerConfig = config?.providers?.[key];
    const modelProfile = config?.profiles?.[key];
    const providerModel = providerConfig?.models.find(
      (item) => item.id === providerConfig.defaultModel,
    );
    profiles[key] = normalizeProfile(
      key,
      {
        apiKey: providerConfig?.apiKey ?? modelProfile?.apiKey,
        baseUrl: providerConfig?.baseUrl ?? modelProfile?.baseUrl,
        model:
          providerModel?.id ??
          providerConfig?.defaultModel ??
          modelProfile?.model,
        contextWindow:
          providerModel?.contextWindow ?? modelProfile?.contextWindow,
        maxTokens: providerModel?.maxTokens ?? modelProfile?.maxTokens,
      },
      presets,
    );
  }
  return {
    activeProfileKey,
    profiles,
    enableThinking: Boolean(config?.enableThinking),
  };
}

export function buildApiConfigDraftSignature(
  activeProfileKey: ProviderProfileKey,
  profiles: Record<ProviderProfileKey, UIProviderProfile>,
  enableThinking: boolean,
): string {
  return JSON.stringify({
    activeProfileKey,
    enableThinking,
    profiles: PROFILE_KEYS.map((key) => ({
      key,
      apiKey: profiles[key]?.apiKey || "",
      baseUrl: profiles[key]?.baseUrl || "",
      model: profiles[key]?.useCustomModel
        ? profiles[key]?.customModel || ""
        : profiles[key]?.model || "",
    })),
  });
}

export function buildApiConfigBootstrap(
  config: AppConfig | null | undefined,
  presets: ProviderPresets,
): ApiConfigBootstrap {
  return {
    snapshot: buildApiConfigSnapshot(config, presets),
    activeProviderKey:
      config?.activeProviderKey || config?.activeProfileKey || "openrouter",
    providers: config?.providers || {},
  };
}

export function useApiConfigState() {
  const appConfig = useAppStore((state) => state.appConfig);
  return useMemo(
    () => ({
      appConfig,
      bootstrap: buildApiConfigBootstrap(appConfig, FALLBACK_PROVIDER_PRESETS),
      presets: FALLBACK_PROVIDER_PRESETS,
    }),
    [appConfig],
  );
}
