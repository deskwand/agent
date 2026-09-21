import Store, { type Options as StoreOptions } from "electron-store";
import {
  API_PROVIDER_PRESETS,
  PI_AI_CURATED_PRESETS,
} from "../../shared/api-model-presets";
import type {
  SharedProviderPreset,
  VisionModelConfig,
} from "../../shared/api-model-presets";
import { VALID_THEME_PRESETS } from "../../shared/theme";
import type { ThemePreset } from "../../shared/theme";
import {
  normalizeWebAccessConfig,
  type WebAccessConfig,
} from "../../shared/web-access";
import { type SubagentConfig } from "../../shared/subagent-config";
import { logWarn } from "../utils/logger";
import {
  normalizeAnthropicBaseUrl,
  shouldUseAnthropicAuthToken,
} from "./auth-utils";
import { resolveModelContextWindow } from "../agent/pi-model-resolution";
import {
  extractOAuthProviderId,
  isOAuthProfileKey,
} from "../../shared/oauth-utils";

export type ProviderType =
  | "openrouter"
  | "anthropic"
  | "deepseek"
  | "custom"
  | "openai"
  | "gemini"
  | "ollama"
  | "oauth"
  | "zhipu"
  | "opencode"
  | "opencode-go";
export type CustomProtocolType = "anthropic" | "openai" | "gemini";
export type AppTheme = "dark" | "light" | "system";
export type { ThemePreset };
export type ProviderProfileKey = string;

export interface ProviderProfile {
  apiKey: string;
  baseUrl?: string;
  model: string;
  contextWindow?: number;
  maxTokens?: number;
}

export interface ApiProviderModel {
  id: string;
  label: string;
  source: "preset" | "custom";
  contextWindow?: number;
  maxTokens?: number;
  input?: ("text" | "image")[];
}

export interface ApiProviderConfig {
  provider: ProviderType;
  customProtocol: CustomProtocolType;
  name?: string;
  apiKey: string;
  baseUrl?: string;
  defaultModel: string;
  models: ApiProviderModel[];
  updatedAt: string;
}

export interface SaveProviderPayload {
  profileKey: ProviderProfileKey;
  config: ApiProviderConfig;
}

export interface UtilityModelRuntimeConfig {
  inheritFromActive: boolean;
  providerProfileKey?: ProviderProfileKey;
  model?: string;
  timeoutMs: number;
}

export interface MemoryRuntimeConfig {
  maxNavSteps: number;
  ingestionConcurrency: number;
  storageRoot?: string;
}

export const UI_FONT_SIZE_MIN = 12;
export const UI_FONT_SIZE_MAX = 20;
export const UI_FONT_SIZE_DEFAULT = 14;

/** Clamp a UI font size to the supported range; non-finite values fall back to default. */
export function clampUiFontSize(value: number): number {
  if (!Number.isFinite(value)) return UI_FONT_SIZE_DEFAULT;
  return Math.min(
    UI_FONT_SIZE_MAX,
    Math.max(UI_FONT_SIZE_MIN, Math.round(value)),
  );
}

// ── AppConfig: external shape (consumers see this) ──────────────────
export interface AppConfig {
  provider: ProviderType;
  apiKey: string;
  baseUrl?: string;
  customProtocol?: CustomProtocolType;
  model: string;
  contextWindow?: number;
  maxTokens?: number;
  activeProfileKey: ProviderProfileKey;
  profiles: Partial<Record<ProviderProfileKey, ProviderProfile>>;
  activeProviderKey: ProviderProfileKey;
  providers: Partial<Record<ProviderProfileKey, ApiProviderConfig>>;
  deskWandCodePath?: string;
  defaultWorkdir?: string;
  enableDevLogs: boolean;
  theme: AppTheme;
  themePreset: ThemePreset;
  uiFontSize?: number;
  sandboxEnabled: boolean;
  memoryEnabled: boolean;
  memoryRuntime: MemoryRuntimeConfig;
  utilityRuntime: UtilityModelRuntimeConfig;
  enableThinking: boolean;
  thinkingLevel: string;
  autoSkillLearning: boolean;
  telemetryEnabled: boolean;
  isConfigured: boolean;
  visionModel?: VisionModelConfig;
  webAccess: WebAccessConfig;
  subagent?: SubagentConfig;
}

// ── StoredConfig: what actually hits disk (no root projection dupes) ─
interface StoredConfig {
  activeProviderKey: ProviderProfileKey;
  providers: Partial<Record<ProviderProfileKey, ApiProviderConfig>>;
  deskWandCodePath: string;
  defaultWorkdir: string;
  enableDevLogs: boolean;
  theme: AppTheme;
  themePreset: ThemePreset;
  uiFontSize?: number;
  sandboxEnabled: boolean;
  memoryEnabled: boolean;
  memoryRuntime: MemoryRuntimeConfig;
  utilityRuntime: UtilityModelRuntimeConfig;
  enableThinking: boolean;
  thinkingLevel: string;
  autoSkillLearning: boolean;
  telemetryEnabled: boolean;
  isConfigured: boolean;
  visionModel?: VisionModelConfig;
  webAccess: WebAccessConfig;
  subagent?: SubagentConfig;
}

export interface LegacyEnvBridgeSnapshot {
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_AUTH_TOKEN?: string;
  ANTHROPIC_BASE_URL?: string;
  DESKWAND_MODEL?: string;
  ANTHROPIC_DEFAULT_SONNET_MODEL?: string;
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
  OPENAI_API_MODE?: string;
  OPENAI_ACCOUNT_ID?: string;
  GEMINI_API_KEY?: string;
  GEMINI_BASE_URL?: string;
  COWORK_WORKDIR?: string;
}

export const PROVIDER_PRESETS = API_PROVIDER_PRESETS;
const PI_AI_CURATED: Record<string, { piProvider: string; pick?: string[] }> =
  PI_AI_CURATED_PRESETS;

const VALID_THEMES: AppTheme[] = ["dark", "light", "system"];

const defaultProfiles: Record<ProviderProfileKey, ProviderProfile> = {
  openrouter: {
    apiKey: "",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "anthropic/claude-sonnet-4-6",
  },
  anthropic: {
    apiKey: "",
    baseUrl: "https://api.anthropic.com",
    model: "claude-sonnet-4-6",
  },
  deepseek: {
    apiKey: "",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-v4-pro",
  },
  openai: {
    apiKey: "",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-5.4",
  },
  gemini: {
    apiKey: "",
    baseUrl: "https://generativelanguage.googleapis.com",
    model: "gemini-2.5-flash",
  },
  opencode: {
    apiKey: "",
    baseUrl: "https://opencode.ai/zen/v1",
    model: "gpt-5.6-luna",
  },
  "opencode-go": {
    apiKey: "",
    baseUrl: "https://opencode.ai/zen/go/v1",
    model: "kimi-k3",
  },
  "custom:anthropic": {
    apiKey: "",
    baseUrl: "https://open.bigmodel.cn/api/anthropic",
    model: "glm-5",
  },
  "custom:openai": {
    apiKey: "",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-5.4",
  },
  "custom:gemini": {
    apiKey: "",
    baseUrl: "https://generativelanguage.googleapis.com",
    model: "gemini-2.5-flash",
  },
};

function defaultMemoryRuntime(): MemoryRuntimeConfig {
  return {
    maxNavSteps: 2,
    ingestionConcurrency: 4,
    storageRoot: "",
  };
}

export function defaultStoredConfig(): StoredConfig {
  return {
    activeProviderKey: "openrouter",
    providers: {},
    deskWandCodePath: "",
    defaultWorkdir: "",
    enableDevLogs: false,
    theme: "light",
    themePreset: "graphite",
    uiFontSize: UI_FONT_SIZE_DEFAULT,
    sandboxEnabled: false,
    memoryEnabled: false,
    memoryRuntime: defaultMemoryRuntime(),
    utilityRuntime: {
      inheritFromActive: true,
      providerProfileKey: undefined,
      model: "",
      timeoutMs: 180000,
    },
    enableThinking: false,
    thinkingLevel: "medium",
    autoSkillLearning: false,
    telemetryEnabled: true,
    isConfigured: false,
    visionModel: undefined,
    webAccess: normalizeWebAccessConfig(undefined),
  };
}

function profileKeyFromProvider(
  provider: ProviderType,
  customProtocol: CustomProtocolType = "anthropic",
  customId?: string,
): ProviderProfileKey {
  if (provider !== "custom") {
    return provider;
  }
  if (customId) {
    return `custom:${customId}`;
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
  /** 保存时保留注册表动态 enrich 的模型列表（而非静态预设） */
  preserveDynamicModels?: boolean;
} {
  if (isOAuthProfileKey(profileKey))
    return { provider: "oauth" as ProviderType, customProtocol: "anthropic" };
  if (profileKey.startsWith("custom:"))
    return { provider: "custom", customProtocol: "anthropic" };
  if (profileKey === "openai")
    return { provider: "openai", customProtocol: "openai" };
  if (profileKey === "deepseek")
    return { provider: "deepseek", customProtocol: "openai" };
  if (profileKey === "gemini")
    return { provider: "gemini", customProtocol: "gemini" };
  if (profileKey === "opencode")
    return {
      provider: "opencode",
      customProtocol: "openai",
      preserveDynamicModels: true,
    };
  if (profileKey === "opencode-go")
    return {
      provider: "opencode-go",
      customProtocol: "openai",
      preserveDynamicModels: true,
    };
  if (profileKey === "openrouter")
    return {
      provider: "openrouter",
      customProtocol: "anthropic",
      preserveDynamicModels: true,
    };
  return { provider: profileKey as ProviderType, customProtocol: "anthropic" };
}

function defaultProtocolForProvider(
  provider: ProviderType,
): CustomProtocolType {
  if (provider === "openai" || provider === "deepseek") return "openai";
  if (
    provider === "opencode" ||
    provider === "opencode-go" ||
    provider === "ollama"
  )
    return "openai";
  if (provider === "gemini") return "gemini";
  return "anthropic";
}

function toBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function nowISO(): string {
  return new Date().toISOString();
}

export function buildLegacyEnvBridgeSnapshot(
  config: AppConfig,
): LegacyEnvBridgeSnapshot {
  const snapshot: LegacyEnvBridgeSnapshot = {};

  if (config.provider === "openai" || config.provider === "deepseek") {
    if (config.apiKey) {
      snapshot.OPENAI_API_KEY = config.apiKey;
    }
    if (config.baseUrl) {
      snapshot.OPENAI_BASE_URL = config.baseUrl;
    }
    if (config.model) {
      snapshot.OPENAI_MODEL = config.model;
    }
  } else if (config.provider === "gemini") {
    if (config.apiKey) {
      snapshot.GEMINI_API_KEY = config.apiKey;
    }
    if (config.baseUrl) {
      snapshot.GEMINI_BASE_URL = config.baseUrl;
    }
  } else {
    const useAuthToken = shouldUseAnthropicAuthToken({
      provider: config.provider,
      customProtocol: config.customProtocol,
      apiKey: config.apiKey,
    });
    if (useAuthToken) {
      if (config.apiKey) {
        snapshot.ANTHROPIC_AUTH_TOKEN = config.apiKey;
      }
    } else if (config.apiKey) {
      snapshot.ANTHROPIC_API_KEY = config.apiKey;
    }
    const normalizedBaseUrl = normalizeAnthropicBaseUrl(config.baseUrl);
    if (normalizedBaseUrl) {
      snapshot.ANTHROPIC_BASE_URL = normalizedBaseUrl;
    }
    if (config.model) {
      snapshot.DESKWAND_MODEL = config.model;
      snapshot.ANTHROPIC_DEFAULT_SONNET_MODEL = config.model;
    }
  }

  if (config.defaultWorkdir) {
    snapshot.COWORK_WORKDIR = config.defaultWorkdir;
  }

  return snapshot;
}

function isCustomProtocol(value: unknown): value is CustomProtocolType {
  return value === "anthropic" || value === "openai" || value === "gemini";
}

function isProfileKey(value: unknown): value is ProviderProfileKey {
  return typeof value === "string" && value.length > 0;
}

function isCustomProfile(profileKey: ProviderProfileKey): boolean {
  return profileKey.startsWith("custom:");
}

function isAppTheme(value: unknown): value is AppTheme {
  return typeof value === "string" && VALID_THEMES.includes(value as AppTheme);
}

function isThemePreset(value: unknown): value is ThemePreset {
  return (
    typeof value === "string" &&
    VALID_THEME_PRESETS.includes(value as ThemePreset)
  );
}

function normalizeCustomProtocol(
  value: CustomProtocolType | undefined,
  fallback: CustomProtocolType,
): CustomProtocolType {
  return isCustomProtocol(value) ? value : fallback;
}

function getSortedPresetModels(
  profileKey: ProviderProfileKey,
): ApiProviderModel[] {
  const { provider } = profileKeyToProvider(profileKey);
  const preset = (
    PROVIDER_PRESETS as unknown as Record<string, SharedProviderPreset>
  )[provider];
  if (!preset) return [];
  return [...preset.models]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((item) => ({
      id: item.id,
      label: item.name || item.id,
      source: "preset" as const,
    }));
}

function getDefaultProviderModel(
  profileKey: ProviderProfileKey,
): ApiProviderModel {
  const presetModels = getSortedPresetModels(profileKey);
  if (presetModels[0]) {
    return presetModels[0];
  }
  const profile = defaultProfiles[profileKey];
  const modelId = profile?.model || "unknown";
  return {
    id: modelId,
    label: modelId,
    source: "preset",
  };
}

function normalizeProviderModel(
  raw: Partial<ApiProviderModel> | undefined,
  fallbackId: string,
): ApiProviderModel | null {
  const id = toNonEmptyString(raw?.id) || fallbackId;
  if (!id) {
    return null;
  }
  const label = toNonEmptyString(raw?.label) || id;
  const source = raw?.source === "custom" ? "custom" : "preset";
  const model: ApiProviderModel = { id, label, source };
  if (source === "custom") {
    if (typeof raw?.contextWindow === "number" && raw.contextWindow > 0) {
      model.contextWindow = Math.round(raw.contextWindow);
    }
    if (typeof raw?.maxTokens === "number" && raw.maxTokens > 0) {
      model.maxTokens = Math.round(raw.maxTokens);
    }
    if (Array.isArray(raw?.input) && raw.input.length > 0) {
      model.input = raw.input;
    }
  }
  // Auto-resolve contextWindow for all models (preset + custom without manual override)
  if (!model.contextWindow || model.contextWindow <= 0) {
    try {
      const cw = resolveModelContextWindow(id);
      if (cw > 0) model.contextWindow = cw;
    } catch {
      /* pi registry may be unavailable; model keeps no contextWindow */
    }
  }
  return model;
}

export function normalizeProviderConfig(
  profileKey: ProviderProfileKey,
  raw: Partial<ApiProviderConfig> | undefined,
): ApiProviderConfig {
  const meta = profileKeyToProvider(profileKey);
  const fallbackProfile = defaultProfiles[profileKey] || {
    apiKey: "",
    baseUrl: "",
    model: "",
  };
  const fallbackModel = getDefaultProviderModel(profileKey);
  const isCustomProfile =
    meta.provider === "custom" || meta.provider === "oauth";
  const rawModels = Array.isArray(raw?.models) ? raw.models : [];
  // Provider metadata flag: openrouter/opencode keep dynamically enriched
  // models from the pi-ai registry instead of the static preset list.
  const preserveRawModels =
    isCustomProfile ||
    (meta.preserveDynamicModels === true && rawModels.length > 0);
  const deduped = new Map<string, ApiProviderModel>();

  if (preserveRawModels) {
    for (const item of rawModels) {
      const normalized = normalizeProviderModel(item, "");
      if (normalized) {
        deduped.set(normalized.id, normalized);
      }
    }
    if (deduped.size === 0 && fallbackModel.id) {
      deduped.set(fallbackModel.id, fallbackModel);
    }
  }

  const models = preserveRawModels
    ? Array.from(deduped.values())
    : getSortedPresetModels(profileKey);
  const dm = toNonEmptyString(raw?.defaultModel);
  const defaultModelCandidate = preserveRawModels
    ? dm || models[0]?.id || fallbackProfile.model
    : dm && models.some((m) => m.id === raw?.defaultModel)
      ? dm
      : fallbackModel.id || fallbackProfile.model;
  const defaultModel = preserveRawModels
    ? deduped.has(defaultModelCandidate)
      ? defaultModelCandidate
      : models[0]?.id || fallbackProfile.model
    : defaultModelCandidate;
  return {
    provider: meta.provider,
    customProtocol: normalizeCustomProtocol(
      raw?.customProtocol,
      meta.customProtocol,
    ),
    name:
      typeof raw?.name === "string" ? raw.name.trim() || undefined : undefined,
    apiKey: typeof raw?.apiKey === "string" ? raw.apiKey : "",
    baseUrl: isCustomProfile
      ? toNonEmptyString(raw?.baseUrl) || fallbackProfile.baseUrl
      : fallbackProfile.baseUrl,
    defaultModel,
    models,
    updatedAt: toNonEmptyString(raw?.updatedAt) || nowISO(),
  };
}

function clearProviderConfig(
  profileKey: ProviderProfileKey,
): ApiProviderConfig {
  const cleared = normalizeProviderConfig(profileKey, undefined);
  return {
    ...cleared,
    apiKey: "",
    baseUrl: cleared.baseUrl,
    updatedAt: nowISO(),
  };
}

/**
 * Attempt to enrich a provider payload with models from the
 * pi-ai built-in registry (which is the authoritative source for
 * OAuth and opencode provider models). Falls back to the
 * renderer-provided models if pi-ai is unavailable or does not know
 * the provider.
 */
export async function enrichProviderModelsFromRegistry(
  payload: SaveProviderPayload,
): Promise<SaveProviderPayload> {
  const provider = payload.config.provider;
  if (
    provider !== "oauth" &&
    provider !== "opencode" &&
    provider !== "opencode-go"
  )
    return payload;
  const isOAuth = provider === "oauth";
  const providerId = isOAuth
    ? extractOAuthProviderId(payload.profileKey)
    : provider;
  if (!providerId) {
    if (isOAuth) {
      throw new Error(`Pi SDK has no OAuth provider for ${payload.profileKey}`);
    }
    return payload;
  }

  let piModels:
    | Array<{
        id: string;
        name: string;
        contextWindow?: number;
        maxTokens?: number;
        input?: ("text" | "image")[];
      }>
    | undefined;
  try {
    const { getModels } = await import("@earendil-works/pi-ai/compat");
    piModels = getModels(providerId as Parameters<typeof getModels>[0]);
  } catch (error) {
    if (isOAuth) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to load Pi SDK models for OAuth provider ${providerId}: ${message}`,
      );
    }
    logWarn(
      "[Config] Failed to enrich provider models from pi-ai, using renderer fallback:",
      error,
    );
    return payload;
  }

  if (!piModels?.length) {
    if (isOAuth) {
      throw new Error(
        `Pi SDK returned no models for OAuth provider ${providerId}`,
      );
    }
    return payload;
  }

  const models: ApiProviderModel[] = piModels.map((m) => ({
    id: m.id,
    label: m.name,
    source: "preset" as const,
    contextWindow: m.contextWindow,
    maxTokens: m.maxTokens,
    input: m.input,
  }));
  // Keep an explicit non-empty defaultModel when it exists in the
  // enriched set (e.g. the plan-aware defaults set by the UI);
  // otherwise fall back to the registry-order first model.
  const defaultModel =
    payload.config.defaultModel &&
    models.some((m) => m.id === payload.config.defaultModel)
      ? payload.config.defaultModel
      : models[0]?.id || payload.config.defaultModel;
  return {
    ...payload,
    config: {
      ...payload.config,
      models,
      defaultModel,
    },
  };
}

function sanitizeSaveProviderPayload(
  payload: SaveProviderPayload,
): ApiProviderConfig {
  const profileKey = payload.profileKey;
  const meta = profileKeyToProvider(profileKey);

  if (meta.provider === "oauth") {
    // OAuth: preserve models & defaultModel from payload.
    // Credentials live in auth.json, not here.
    const raw = payload.config;
    const rawModels: ApiProviderModel[] = Array.isArray(raw?.models)
      ? raw.models.map((m) => ({ ...m }))
      : [];
    const defaultModel =
      toNonEmptyString(raw?.defaultModel) || rawModels[0]?.id || "";
    return {
      provider: "oauth",
      customProtocol: meta.customProtocol,
      name:
        typeof raw?.name === "string"
          ? raw.name.trim() || undefined
          : undefined,
      apiKey: "",
      baseUrl: "",
      defaultModel,
      models: rawModels,
      updatedAt: nowISO(),
    };
  }

  const normalized = normalizeProviderConfig(profileKey, payload.config);

  if (meta.provider !== "custom") {
    const preserveOpenRouterModels =
      meta.provider === "openrouter" && normalized.models.length > 0;
    return {
      ...normalized,
      provider: meta.provider,
      customProtocol: meta.customProtocol,
      apiKey:
        typeof payload.config.apiKey === "string"
          ? payload.config.apiKey.trim()
          : "",
      baseUrl: normalizeProviderConfig(profileKey, undefined).baseUrl,
      defaultModel: preserveOpenRouterModels
        ? normalized.defaultModel
        : getDefaultProviderModel(profileKey).id,
      models: preserveOpenRouterModels
        ? normalized.models
        : getSortedPresetModels(profileKey),
      updatedAt: nowISO(),
    };
  }

  return {
    ...normalized,
    updatedAt: nowISO(),
  };
}

function normalizeUtilityModelRuntimeConfig(
  raw: unknown,
): UtilityModelRuntimeConfig {
  const value =
    typeof raw === "object" && raw !== null
      ? (raw as Partial<UtilityModelRuntimeConfig>)
      : {};
  return {
    inheritFromActive: toBoolean(value.inheritFromActive, true),
    providerProfileKey: isProfileKey(value.providerProfileKey)
      ? value.providerProfileKey
      : undefined,
    model: typeof value.model === "string" ? value.model : "",
    timeoutMs:
      typeof value.timeoutMs === "number" && Number.isFinite(value.timeoutMs)
        ? Math.max(5000, Math.round(value.timeoutMs))
        : 180000,
  };
}

function normalizeMemoryRuntimeConfig(raw: unknown): MemoryRuntimeConfig {
  const defaults = defaultMemoryRuntime();
  const value =
    typeof raw === "object" && raw !== null
      ? (raw as Partial<MemoryRuntimeConfig>)
      : {};
  return {
    maxNavSteps:
      typeof value.maxNavSteps === "number" &&
      Number.isFinite(value.maxNavSteps)
        ? Math.max(0, Math.min(4, Math.round(value.maxNavSteps)))
        : defaults.maxNavSteps,
    ingestionConcurrency:
      typeof value.ingestionConcurrency === "number" &&
      Number.isFinite(value.ingestionConcurrency)
        ? Math.max(1, Math.min(16, Math.round(value.ingestionConcurrency)))
        : defaults.ingestionConcurrency,
    storageRoot:
      typeof value.storageRoot === "string"
        ? value.storageRoot
        : defaults.storageRoot,
  };
}

let cachedDynamicPresets: typeof PROVIDER_PRESETS | null = null;

export async function getPiAiModelPresets(): Promise<typeof PROVIDER_PRESETS> {
  if (cachedDynamicPresets) return cachedDynamicPresets;
  try {
    // TODO: migrate from compat to createModels() when compat is removed
    const { getModels } = (await import("@earendil-works/pi-ai/compat")) as {
      getModels: (
        provider: string,
      ) => Array<{ id: string; name: string }> | undefined;
    };
    const result = { ...PROVIDER_PRESETS } as Record<
      string,
      (typeof PROVIDER_PRESETS)[keyof typeof PROVIDER_PRESETS]
    >;
    for (const [providerKey, curated] of Object.entries(PI_AI_CURATED)) {
      const preset =
        PROVIDER_PRESETS[providerKey as keyof typeof PROVIDER_PRESETS];
      if (!preset) continue;
      const registryModels = getModels(curated.piProvider);
      if (!registryModels?.length) continue;
      const registryIds = new Set(registryModels.map((item) => item.id));
      const models = curated.pick
        ? curated.pick
            .filter((id) => registryIds.has(id))
            .map((id) => {
              const found = registryModels.find((item) => item.id === id);
              return { id, name: found?.name || id };
            })
        : registryModels.map((item) => ({
            id: item.id,
            name: item.name || item.id,
          }));
      if (models.length > 0) {
        result[providerKey] = { ...preset, models };
      }
    }
    cachedDynamicPresets = result as unknown as typeof PROVIDER_PRESETS;
    return cachedDynamicPresets;
  } catch (error) {
    logWarn(
      "[ConfigStore] Failed to load pi-ai model presets, using fallback:",
      error,
    );
    return PROVIDER_PRESETS;
  }
}

// ── Dynamic projection (also exported for tests) ──────────────────

export function buildProjectedConfig(stored: StoredConfig): AppConfig {
  const activeKey = stored.activeProviderKey || "openrouter";
  const active = normalizeProviderConfig(
    activeKey,
    stored.providers[activeKey],
  );
  const activeModel =
    active.models.find((m) => m.id === active.defaultModel) || active.models[0];

  const profiles = {} as Record<ProviderProfileKey, ProviderProfile>;
  const providers = {} as Record<ProviderProfileKey, ApiProviderConfig>;
  for (const key of Object.keys(stored.providers)) {
    const p = normalizeProviderConfig(key, stored.providers[key]);
    const pm = p.models.find((m) => m.id === p.defaultModel) || p.models[0];
    profiles[key] = {
      apiKey: p.apiKey,
      baseUrl: p.baseUrl,
      model: p.defaultModel,
      contextWindow: pm?.contextWindow,
      maxTokens: pm?.maxTokens,
    };
    providers[key] = p;
  }

  return {
    provider: active.provider,
    apiKey: active.apiKey,
    baseUrl: active.baseUrl,
    customProtocol: active.customProtocol,
    model: active.defaultModel,
    contextWindow: activeModel?.contextWindow,
    maxTokens: activeModel?.maxTokens,
    activeProfileKey: activeKey,
    profiles,
    activeProviderKey: activeKey,
    providers,
    deskWandCodePath: stored.deskWandCodePath,
    defaultWorkdir: stored.defaultWorkdir,
    enableDevLogs: stored.enableDevLogs,
    theme: stored.theme,
    themePreset: stored.themePreset,
    uiFontSize: stored.uiFontSize,
    sandboxEnabled: stored.sandboxEnabled,
    memoryEnabled: stored.memoryEnabled,
    memoryRuntime: stored.memoryRuntime,
    utilityRuntime: stored.utilityRuntime,
    enableThinking: stored.enableThinking,
    thinkingLevel: stored.thinkingLevel,
    autoSkillLearning: stored.autoSkillLearning,
    telemetryEnabled: stored.telemetryEnabled,
    isConfigured: stored.isConfigured,
    visionModel: stored.visionModel,
    webAccess: normalizeWebAccessConfig(stored.webAccess),
    subagent: stored.subagent,
  };
}

// ────────────────────────────────────────────────────────────────────
//  ConfigStore  —  single source of truth: providers map + non-provider fields
//  Root-level provider/apiKey/baseUrl/model/... are dynamic projections.
// ────────────────────────────────────────────────────────────────────

export class ConfigStore {
  private store: Store<StoredConfig>;

  constructor() {
    const storeOptions: StoreOptions<StoredConfig> = {
      name: "config",
      defaults: defaultStoredConfig(),
    };
    this.store = new Store<StoredConfig>(storeOptions);
  }

  // ── Read ─────────────────────────────────────────────────────────

  /** Dynamically project StoredConfig → AppConfig for consumers. */
  getAll(): AppConfig {
    return buildProjectedConfig(this.store.store);
  }

  get<K extends keyof AppConfig>(key: K): AppConfig[K] {
    return this.getAll()[key];
  }

  // ── Write ────────────────────────────────────────────────────────

  set<K extends keyof AppConfig>(key: K, value: AppConfig[K]): void {
    this.update({ [key]: value } as Partial<AppConfig>);
  }

  update(updates: Partial<AppConfig>): void {
    const stored = { ...this.store.store };

    // ── Resolve target provider key ──
    let targetKey = stored.activeProviderKey;
    if (isProfileKey(updates.activeProviderKey)) {
      targetKey = updates.activeProviderKey;
    } else if (updates.provider !== undefined) {
      const cp =
        updates.customProtocol ?? defaultProtocolForProvider(updates.provider);
      targetKey = profileKeyFromProvider(updates.provider, cp);
    }

    // ── Apply provider-level mutations ──
    const hasMutation =
      updates.provider !== undefined ||
      updates.customProtocol !== undefined ||
      updates.apiKey !== undefined ||
      updates.baseUrl !== undefined ||
      updates.model !== undefined ||
      updates.contextWindow !== undefined ||
      updates.maxTokens !== undefined;

    if (hasMutation) {
      const current = this._provider(targetKey);
      const merged = { ...current };

      if (updates.provider !== undefined) merged.provider = updates.provider;
      if (updates.customProtocol !== undefined)
        merged.customProtocol = updates.customProtocol;
      if (updates.apiKey !== undefined) {
        if (merged.provider !== "oauth") {
          merged.apiKey = updates.apiKey;
        }
      }
      if (updates.baseUrl !== undefined) merged.baseUrl = updates.baseUrl;

      // Model selection / update
      const nextModel =
        updates.model !== undefined ? updates.model : current.defaultModel;
      const existing = merged.models.find((m) => m.id === nextModel);
      if (existing) {
        // Update existing model metadata
        if (updates.contextWindow !== undefined)
          existing.contextWindow = updates.contextWindow;
        if (updates.maxTokens !== undefined)
          existing.maxTokens = updates.maxTokens;
        merged.defaultModel = nextModel;
      } else if (updates.model !== undefined) {
        // New custom model
        const newModel = normalizeProviderModel(
          {
            id: nextModel,
            label: nextModel,
            source: "custom",
            contextWindow: updates.contextWindow,
            maxTokens: updates.maxTokens,
          },
          nextModel,
        );
        merged.models = newModel ? [newModel, ...merged.models] : merged.models;
        merged.defaultModel = nextModel;
      } else if (
        updates.contextWindow !== undefined ||
        updates.maxTokens !== undefined
      ) {
        // Update active model even when model field unchanged
        const active = merged.models.find((m) => m.id === current.defaultModel);
        if (active) {
          if (updates.contextWindow !== undefined)
            active.contextWindow = updates.contextWindow;
          if (updates.maxTokens !== undefined)
            active.maxTokens = updates.maxTokens;
        }
      }

      merged.updatedAt = nowISO();
      stored.providers[targetKey] = normalizeProviderConfig(targetKey, merged);
    }

    stored.activeProviderKey = targetKey;

    // ── Non-provider fields ──
    if (updates.deskWandCodePath !== undefined)
      stored.deskWandCodePath = updates.deskWandCodePath;
    if (updates.defaultWorkdir !== undefined)
      stored.defaultWorkdir = updates.defaultWorkdir;
    if (updates.enableDevLogs !== undefined)
      stored.enableDevLogs = updates.enableDevLogs;
    if (isAppTheme(updates.theme)) stored.theme = updates.theme;
    if (isThemePreset(updates.themePreset))
      stored.themePreset = updates.themePreset;
    if (updates.sandboxEnabled !== undefined)
      stored.sandboxEnabled = updates.sandboxEnabled;
    if (updates.memoryEnabled !== undefined)
      stored.memoryEnabled = updates.memoryEnabled;
    if (updates.memoryRuntime !== undefined)
      stored.memoryRuntime = normalizeMemoryRuntimeConfig(
        updates.memoryRuntime,
      );
    if (updates.utilityRuntime !== undefined)
      stored.utilityRuntime = normalizeUtilityModelRuntimeConfig(
        updates.utilityRuntime,
      );
    if (updates.enableThinking !== undefined)
      stored.enableThinking = updates.enableThinking;
    if (updates.thinkingLevel !== undefined)
      stored.thinkingLevel = updates.thinkingLevel;
    if (updates.autoSkillLearning !== undefined)
      stored.autoSkillLearning = updates.autoSkillLearning;
    if (updates.telemetryEnabled !== undefined)
      stored.telemetryEnabled = updates.telemetryEnabled;
    if (updates.uiFontSize !== undefined)
      stored.uiFontSize = clampUiFontSize(updates.uiFontSize);
    if (updates.visionModel !== undefined)
      stored.visionModel = updates.visionModel;
    if (updates.webAccess !== undefined)
      stored.webAccess = normalizeWebAccessConfig(updates.webAccess);
    if (updates.subagent !== undefined) stored.subagent = updates.subagent;

    stored.isConfigured =
      updates.isConfigured ??
      Object.values(stored.providers).some(
        (p) => !!p?.apiKey?.trim() || p?.provider === "oauth",
      );

    this.store.set(stored);
  }

  saveProvider(payload: SaveProviderPayload): AppConfig {
    const stored = { ...this.store.store };
    stored.providers[payload.profileKey] = sanitizeSaveProviderPayload(payload);
    stored.isConfigured = Object.values(stored.providers).some(
      (p) => !!p?.apiKey?.trim() || p?.provider === "oauth",
    );
    this.store.set(stored);
    return this.getAll();
  }

  async syncOAuthProviderModelsFromRegistry(): Promise<void> {
    for (const [profileKey, config] of Object.entries(
      this.store.store.providers,
    )) {
      if (
        !config ||
        config.provider !== "oauth" ||
        !isOAuthProfileKey(profileKey)
      )
        continue;
      const providerId = extractOAuthProviderId(profileKey);
      try {
        const enriched = await enrichProviderModelsFromRegistry({
          profileKey,
          config,
        });
        this.saveProvider(enriched);
      } catch (error) {
        logWarn("[Config] Failed to sync OAuth provider models from pi-ai:", {
          profileKey,
          providerId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  deleteProvider(payload: { profileKey: ProviderProfileKey }): AppConfig {
    const stored = { ...this.store.store };
    const removedEntirely =
      isCustomProfile(payload.profileKey) ||
      isOAuthProfileKey(payload.profileKey) ||
      payload.profileKey === "openrouter";
    if (removedEntirely) {
      delete stored.providers[payload.profileKey];
    } else {
      stored.providers[payload.profileKey] = clearProviderConfig(
        payload.profileKey,
      );
    }
    const remaining = Object.keys(stored.providers).filter(
      (k) => stored.providers[k],
    );
    if (remaining.length === 0) {
      // Reset only provider-related fields; keep theme, memory, sandbox, etc.
      stored.providers = {};
      stored.activeProviderKey = "openrouter";
      stored.isConfigured = false;
      this.store.set(stored);
      return this.getAll();
    }
    if (stored.activeProviderKey === payload.profileKey) {
      const fallbackKey = remaining.find((key) => {
        const target = stored.providers[key];
        if (!target) return false;
        return this.hasUsableCredentialsForProjection({
          provider: target.provider,
          apiKey: target.apiKey,
          baseUrl: target.baseUrl,
          models: target.models,
        });
      });
      stored.activeProviderKey = fallbackKey || remaining[0];
    }
    stored.isConfigured = Object.values(stored.providers).some(
      (p) => !!p?.apiKey?.trim() || p?.provider === "oauth",
    );
    this.store.set(stored);
    return this.getAll();
  }

  setActiveProvider(payload: {
    profileKey: ProviderProfileKey;
    defaultModel?: string;
  }): AppConfig {
    const stored = { ...this.store.store };
    if (!stored.providers[payload.profileKey]) {
      throw new Error(`Provider not found: ${payload.profileKey}`);
    }
    if (payload.defaultModel) {
      const p = this._provider(payload.profileKey);
      stored.providers[payload.profileKey] = normalizeProviderConfig(
        payload.profileKey,
        { ...p, defaultModel: payload.defaultModel },
      );
    }
    stored.activeProviderKey = payload.profileKey;
    this.store.set(stored);
    return this.getAll();
  }

  // ── Credential checks ────────────────────────────────────────────

  private hasUsableCredentialsForProjection(input: {
    provider: ProviderType;
    apiKey?: string;
    baseUrl?: string;
    /** OAuth providers are usable only after login (which saves models). */
    models?: ReadonlyArray<{ id: string }>;
  }): boolean {
    if (input.provider === "ollama") {
      return Boolean(input.baseUrl?.trim());
    }
    if (input.provider === "oauth") {
      return (input.models?.length ?? 0) > 0;
    }
    return Boolean(input.apiKey?.trim());
  }

  hasUsableCredentials(config: AppConfig = this.getAll()): boolean {
    return this.hasUsableCredentialsForProjection({
      provider: config.provider,
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      models: config.providers?.[config.activeProviderKey]?.models,
    });
  }

  hasAnyUsableCredentials(config: AppConfig = this.getAll()): boolean {
    return Object.values(config.providers).some((provider) => {
      if (!provider) return false;
      return this.hasUsableCredentialsForProjection({
        provider: provider.provider,
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
        models: provider.models,
      });
    });
  }

  isConfigured(): boolean {
    return this.hasAnyUsableCredentials(this.getAll());
  }

  // ── Legacy env bridge ────────────────────────────────────────────

  /**
   * Compatibility bridge for legacy env-driven consumers.
   * Runtime model selection should use ModelResolutionService instead.
   */
  syncLegacyEnvBridge(): void {
    const snapshot = buildLegacyEnvBridgeSnapshot(this.getAll());
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.DESKWAND_MODEL;
    delete process.env.ANTHROPIC_DEFAULT_SONNET_MODEL;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.OPENAI_MODEL;
    delete process.env.OPENAI_API_MODE;
    delete process.env.OPENAI_ACCOUNT_ID;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_BASE_URL;
    delete process.env.COWORK_WORKDIR;

    for (const [key, value] of Object.entries(snapshot)) {
      if (value) {
        process.env[key] = value;
      }
    }
  }

  /** @deprecated Use syncLegacyEnvBridge(). */
  applyToEnv(): void {
    this.syncLegacyEnvBridge();
  }

  reset(): void {
    this.store.set(defaultStoredConfig());
  }

  getPath(): string {
    return this.store.path;
  }

  // ── Internal helpers ─────────────────────────────────────────────

  /** Normalized provider config for a given key (fills defaults when missing). */
  private _provider(key: ProviderProfileKey): ApiProviderConfig {
    return normalizeProviderConfig(key, this.store.store.providers[key]);
  }
}

export const configStore = new ConfigStore();
