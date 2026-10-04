import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  Bot,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Eye,
  Globe2,
  Key,
  Loader2,
  Pencil,
  PlugZap,
  Plus,
  Search,
  Server,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import ApiDiagnosticsPanel from "../ApiDiagnosticsPanel";
import { mergeProviderModels } from "../../utils/merge-provider-models";
import type {
  MergeProviderModelsResult,
  ProviderModelRow,
} from "../../utils/merge-provider-models";
import {
  ConnectTimeoutError,
  diagnoseProviderModels,
} from "../../services/connect-models";
import { useAppStore } from "../../store";
import {
  FALLBACK_PROVIDER_PRESETS,
  profileKeyFromProvider,
  profileKeyToProvider,
} from "../../hooks/useApiConfigState";
import { oauthProfileKey } from "../../../shared/oauth-utils";
import { isCodingSubscriptionProfileKey } from "../../../shared/coding-subscriptions";
import {
  connectCodingSubscription,
  connectOAuthProvider,
} from "../../services/connect-provider";
import type {
  ApiProviderConfig,
  ApiProviderModel,
  AppConfig,
  CustomProtocolType,
  DiagnosticResult,
  ProviderPreset,
  ProviderPresets,
  ProviderProfileKey,
  ProviderType,
  UtilityModelRuntimeConfig,
  VisionModelConfig,
} from "../../types";
import {
  normalizeWebAccessConfig,
  WEB_SEARCH_PROVIDERS,
  type WebAccessAuthProvider,
  type WebAccessConfig,
} from "../../../shared/web-access";
import { ProviderBrandIcon, resolveProviderBrand } from "./provider-icons";
import { resolveProviderDisplayName } from "../../utils/model-label";
import {
  SettingsCard,
  SettingsContentSection,
  SettingsRow,
  SettingsSection,
  SettingsSwitch,
} from "./shared";
import { CodingSubscriptionCards } from "./coding-subscription-cards";
import { OAUTH_PROVIDERS } from "./provider-catalog";
import { ConfiguredProviderList } from "./configured-provider-list";
import { ProviderCatalogGrid } from "./provider-catalog-grid";

type ProviderChoice = ProviderType;

interface SettingsAPIProps {
  embedded?: boolean;
  onSaved?: () => void;
}

interface ProviderDraft {
  profileKey: ProviderProfileKey;
  provider: ProviderType;
  customProtocol: CustomProtocolType;
  name: string;
  apiKey: string;
  baseUrl: string;
  defaultModel: string;
  models: ApiProviderModel[];
  /** 用户取消勾选过的模型 id，写回 config.disabledModels */
  disabledModels?: string[];
}

const PROVIDER_ORDER: ProviderChoice[] = [
  "openrouter",
  "opencode",
  "anthropic",
  "deepseek",
  "openai",
  "gemini",
  "custom",
];

/** 视觉模型设置页的 provider 列表：在主模型列表基础上追加「智谱」，排除 OpenCode（MVP 不含视觉） */
const VISION_PROVIDER_ORDER: ProviderChoice[] = [
  ...PROVIDER_ORDER.filter((provider) => provider !== "opencode"),
  "zhipu",
];

/** 智谱区域端点（两站 API Key 不互通，仅 baseUrl 不同） */
const ZHIPU_REGIONS = [
  {
    id: "cn",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    labelKey: "api.zhipuRegionCn",
  },
  {
    id: "global",
    baseUrl: "https://api.z.ai/api/paas/v4",
    labelKey: "api.zhipuRegionGlobal",
  },
] as const;

/** OpenCode 订阅计划：Zen（按量付费）与 Go（$10/月订阅），同一账号同一 API Key */
const OPENCODE_PLANS = [
  {
    id: "zen",
    provider: "opencode" as const,
    labelKey: "api.opencodePlanZen",
  },
  {
    id: "go",
    provider: "opencode-go" as const,
    labelKey: "api.opencodePlanGo",
  },
] as const;

function sortedPresetModels(
  preset: ProviderPreset,
): Array<{ id: string; name: string }> {
  return [...preset.models].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
}

function providerLabel(
  profileKey: ProviderProfileKey,
  presets: ProviderPresets,
  t: (key: string) => string,
  config?: ApiProviderConfig,
): string {
  const { provider } = profileKeyToProvider(profileKey);
  if (provider !== "custom") {
    return (
      (presets as unknown as Record<string, ProviderPreset>)[provider]?.name ||
      provider
    );
  }
  const customProtocol = config?.customProtocol || "anthropic";
  if (customProtocol === "openai") return `${t("api.otherProvider")} / OpenAI`;
  if (customProtocol === "gemini") return `${t("api.otherProvider")} / Gemini`;
  return `${t("api.otherProvider")} / Anthropic`;
}

function providerOptionLabel(
  provider: ProviderType,
  presets: ProviderPresets,
  t: (key: string) => string,
): string {
  return provider === "custom"
    ? t("api.otherProvider")
    : (presets as unknown as Record<string, ProviderPreset>)[provider]?.name ||
        provider;
}

/** 视觉模型卡片名称：custom 按协议显示品牌名（OpenAI/Anthropic/Gemini） */
const VISION_PROTOCOL_NAMES: Record<CustomProtocolType, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  gemini: "Gemini",
};

function visionProviderName(
  provider: ProviderType,
  customProtocol: CustomProtocolType | undefined,
  presets: ProviderPresets,
  t: (key: string) => string,
): string {
  return provider === "custom"
    ? VISION_PROTOCOL_NAMES[customProtocol ?? "anthropic"]
    : providerOptionLabel(provider, presets, t);
}

function modelsPresetForDraft(
  provider: ProviderType,
  customProtocol: CustomProtocolType,
  presets: ProviderPresets,
): ProviderPreset {
  if (provider === "custom") {
    if (customProtocol === "openai") return presets.openai;
    if (customProtocol === "gemini") return presets.gemini;
    return presets.custom;
  }
  if (provider === "oauth") {
    return {
      name: "OAuth",
      models: [],
      baseUrl: "",
      keyPlaceholder: "",
      keyHint: "",
    };
  }
  return (presets as unknown as Record<string, ProviderPreset>)[provider];
}

function requiresApiKey(provider?: ProviderType): boolean {
  if (provider === "oauth") return false;
  return true;
}

function hasUsableCredentials(
  profileKey: ProviderProfileKey,
  config: ApiProviderConfig,
): boolean {
  if (!config.defaultModel.trim()) return false;
  // OAuth providers store credentials in auth.json, not apiKey field
  if (profileKey.startsWith("oauth:")) return true;
  // OAuth providers are validated via auth.json, not config apiKey (which is always "")
  const apiKey = config.apiKey.trim();
  return Boolean(apiKey);
}

/** OpenCode 各计划的默认模型（与 config-store defaultProfiles 保持一致，成本均衡优先） */
const OPENCODE_DEFAULT_MODELS: Partial<Record<ProviderType, string>> = {
  opencode: "gpt-5.6-luna",
  "opencode-go": "kimi-k3",
};

function createEmptyDraft(
  provider: ProviderType,
  presets: ProviderPresets,
  customProtocol: CustomProtocolType = "anthropic",
): ProviderDraft {
  const profileKey =
    provider === "custom"
      ? `custom:${crypto.randomUUID()}`
      : profileKeyFromProvider(provider, customProtocol);
  const preset = modelsPresetForDraft(provider, customProtocol, presets);
  const presetModels = sortedPresetModels(preset);
  const defaultPresetModel = presetModels[0];
  return {
    profileKey,
    provider,
    customProtocol,
    name: "",
    apiKey: "",
    baseUrl: preset.baseUrl,
    defaultModel:
      OPENCODE_DEFAULT_MODELS[provider] || defaultPresetModel?.id || "",
    models: [],
  };
}

function createDraftFromProvider(
  profileKey: ProviderProfileKey,
  config: ApiProviderConfig,
  presets: ProviderPresets,
): ProviderDraft {
  const preset = modelsPresetForDraft(
    config.provider,
    config.customProtocol,
    presets,
  );
  return {
    profileKey,
    provider: config.provider,
    customProtocol: config.customProtocol,
    name: config.name || "",
    apiKey: config.apiKey,
    baseUrl: config.baseUrl || preset.baseUrl,
    defaultModel: config.defaultModel,
    models: config.models.map((item) => ({ ...item })),
    disabledModels: config.disabledModels ? [...config.disabledModels] : [],
  };
}

function sanitizeDraft(
  draft: ProviderDraft,
  presets: ProviderPresets,
): ProviderDraft {
  const preset = modelsPresetForDraft(
    draft.provider,
    draft.customProtocol,
    presets,
  );
  const presetModels = sortedPresetModels(preset);

  if (draft.provider !== "custom" && draft.provider !== "oauth") {
    return {
      ...draft,
      name: draft.name.trim(),
      apiKey: draft.apiKey.trim(),
      customProtocol:
        draft.provider === "opencode" || draft.provider === "opencode-go"
          ? "openai"
          : draft.customProtocol,
      baseUrl: preset.baseUrl,
      defaultModel:
        OPENCODE_DEFAULT_MODELS[draft.provider] || presetModels[0]?.id || "",
      models: [],
    };
  }

  const deduped = new Map<string, ApiProviderModel>();
  for (const item of draft.models) {
    const id = item.id.trim();
    if (!id) continue;
    deduped.set(id, {
      id,
      label: item.label.trim() || id,
      source: item.source,
      contextWindow:
        item.source === "custom" &&
        typeof item.contextWindow === "number" &&
        item.contextWindow > 0
          ? Math.round(item.contextWindow)
          : undefined,
      maxTokens:
        item.source === "custom" &&
        typeof item.maxTokens === "number" &&
        item.maxTokens > 0
          ? Math.round(item.maxTokens)
          : undefined,
      input:
        item.source === "custom" &&
        Array.isArray(item.input) &&
        item.input.length > 0
          ? item.input
          : undefined,
    });
  }
  const models = Array.from(deduped.values());
  return {
    ...draft,
    name: draft.name.trim(),
    apiKey: draft.apiKey.trim(),
    baseUrl: draft.baseUrl.trim(),
    defaultModel: models[0]?.id || "",
    models,
  };
}

function searchMatchingProfiles(
  appConfig: AppConfig,
  provider: WebAccessAuthProvider,
): Array<{ key: string; name: string }> {
  return Object.entries(appConfig.providers).flatMap(([key, config]) => {
    if (!config) return [];
    if (provider === "openai") {
      if (
        key === "oauth:openai-codex" ||
        config.provider === "openai" ||
        (config.provider !== "oauth" && config.customProtocol === "openai")
      )
        return [{ key, name: config.name || key }];
      return [];
    }
    if (provider === "deepseek") {
      if (config.provider === "deepseek")
        return [{ key, name: config.name || key }];
      return [];
    }
    if (
      config.provider === "gemini" ||
      (config.provider !== "oauth" && config.customProtocol === "gemini")
    )
      return [{ key, name: config.name || key }];
    return [];
  });
}

function searchAddInheritedDefaults(appConfig: AppConfig): WebAccessConfig {
  let draft = normalizeWebAccessConfig(appConfig.webAccess);
  for (const provider of ["openai", "gemini", "deepseek"] as const) {
    const credential = draft[provider];
    if (credential.source !== "inherit" || credential.profileKey) continue;
    const profiles = searchMatchingProfiles(appConfig, provider);
    const selected =
      profiles.find((p) => p.key === appConfig.activeProviderKey) ??
      profiles[0];
    if (selected) {
      draft = {
        ...draft,
        [provider]: { ...credential, profileKey: selected.key },
      };
    }
  }
  return draft;
}

export function SettingsAPI({
  embedded = false,
  onSaved,
}: SettingsAPIProps = {}) {
  const { t } = useTranslation();
  const setAppConfig = useAppStore((state) => state.setAppConfig);
  const setIsConfigured = useAppStore((state) => state.setIsConfigured);
  const [presets, setPresets] = useState<ProviderPresets>(
    FALLBACK_PROVIDER_PRESETS,
  );
  const [appConfig, setLocalConfig] = useState(
    useAppStore.getState().appConfig,
  );
  const [isLoadingConfig, setIsLoadingConfig] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // ── 连接 / 模型探测状态 ──
  const [connectState, setConnectState] = useState<
    "idle" | "connecting" | "connected" | "failed"
  >("idle");
  const [diagResult, setDiagResult] = useState<DiagnosticResult | null>(null);
  const [modelRows, setModelRows] = useState<ProviderModelRow[]>([]);
  const [modelFilter, setModelFilter] = useState("");
  const [connectMessage, setConnectMessage] = useState("");

  const resetConnectState = () => {
    setConnectState("idle");
    setDiagResult(null);
    setModelRows([]);
    setModelFilter("");
    setConnectMessage("");
  };

  const closeEditor = () => {
    setEditorOpen(false);
    resetConnectState();
  };
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState<ProviderDraft | null>(null);
  const [originalProfileKey, setOriginalProfileKey] =
    useState<ProviderProfileKey | null>(null);
  const [pendingDeleteProfileKey, setPendingDeleteProfileKey] =
    useState<ProviderProfileKey | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // ── Tab state ──
  const [activeTab, setActiveTab] = useState<
    "main" | "vision" | "search" | "utility"
  >("main");

  // ── Search / webAccess state ──
  const [searchDraft, setSearchDraft] = useState<WebAccessConfig | null>(null);
  const [searchExpanded, setSearchExpanded] = useState<string | null>(null);
  const [isSearchSaving, setIsSearchSaving] = useState(false);
  const [searchMessage, setSearchMessage] = useState<"saved" | "error" | null>(
    null,
  );

  // ── Vision model state ──
  const [visionDraft, setVisionDraft] = useState<VisionModelConfig>({
    enabled: false,
    provider: "openai",
    customProtocol: undefined,
    apiKey: "",
    baseUrl: "",
    model: "",
  });
  const [visionEditorOpen, setVisionEditorOpen] = useState(false);
  const [isVisionSaving, setIsVisionSaving] = useState(false);
  const [visionError, setVisionError] = useState("");
  const [visionSuccess, setVisionSuccess] = useState("");

  // ── Utility model state ──
  const [utilityDraft, setUtilityDraft] = useState<UtilityModelRuntimeConfig>({
    inheritFromActive: true,
    providerProfileKey: undefined,
    model: "",
    timeoutMs: 180000,
  });
  const [isUtilitySaving, setIsUtilitySaving] = useState(false);
  const [utilityMessage, setUtilityMessage] = useState<
    "saved" | "error" | null
  >(null);

  // ── OAuth state ──
  const [oauthStatuses, setOAuthStatuses] = useState<
    Record<
      string,
      { loggedIn: boolean; expiresAt?: number; providerName: string }
    >
  >({});
  const [oauthLoading, setOAuthLoading] = useState<Record<string, boolean>>({});
  const [oauthErrors, setOAuthErrors] = useState<Record<string, string>>({});
  const [pendingOAuthLogoutProviderId, setPendingOAuthLogoutProviderId] =
    useState<string | null>(null);
  // ── 订阅套餐弹窗（Coding Plan）：包住既有的 CodingSubscriptionCards ──
  const [planDialogOpen, setPlanDialogOpen] = useState(false);

  const isVisionConfigured = !!appConfig?.visionModel?.model?.trim();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!window.electronAPI) {
        setIsLoadingConfig(false);
        return;
      }
      const [nextConfig, nextPresets] = await Promise.all([
        window.electronAPI.config.get(),
        window.electronAPI.config.getPresets(),
      ]);
      if (cancelled) return;
      setLocalConfig(nextConfig);
      setPresets(nextPresets);
      setAppConfig(nextConfig);
      setIsConfigured(Boolean(nextConfig.isConfigured));
      // Initialize vision model state from config
      if (nextConfig.visionModel) {
        setVisionDraft(nextConfig.visionModel);
      }
      if (nextConfig.utilityRuntime) {
        setUtilityDraft(nextConfig.utilityRuntime);
      }
      // Initialize search / webAccess state from config
      setSearchDraft(searchAddInheritedDefaults(nextConfig));
      // Load OAuth statuses
      const statuses: Record<string, unknown> = {};
      for (const provider of OAUTH_PROVIDERS) {
        try {
          statuses[provider.id] =
            provider.id === "openrouter"
              ? await window.electronAPI.openrouterAuth.status()
              : await window.electronAPI.auth.status(provider.id);
        } catch {
          statuses[provider.id] = {
            loggedIn: false,
            providerName: provider.name,
          };
        }
      }
      setOAuthStatuses(statuses as typeof oauthStatuses);
      setIsLoadingConfig(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [setAppConfig, setIsConfigured]);

  const configuredProviders = useMemo(() => {
    const providers = appConfig?.providers || {};
    return (
      Object.entries(providers).filter(
        ([profileKey, config]) =>
          profileKey !== "custom:deskwand" &&
          !isCodingSubscriptionProfileKey(profileKey) &&
          config &&
          hasUsableCredentials(profileKey as ProviderProfileKey, config),
      ) as Array<[string, ApiProviderConfig]>
    ).map(([profileKey, config]) => ({
      profileKey: profileKey as ProviderProfileKey,
      config,
    }));
  }, [appConfig]);

  /**
   * 网格「已配置」角标用。
   * 供应商走 configuredProviders（与列表同一份判断）；Coding Plan 被那个筛选
   * 排除在外，但它们确实已配置，所以单独补进来，否则中转分类的角标永远是空的。
   */
  const configuredProfileKeys = useMemo(() => {
    const keys = new Set(
      configuredProviders.map((row) => row.profileKey as string),
    );
    for (const key of Object.keys(appConfig?.providers ?? {})) {
      if (isCodingSubscriptionProfileKey(key)) keys.add(key);
    }
    return keys;
  }, [configuredProviders, appConfig]);

  const isCreating = originalProfileKey === null;
  const isCustomDraft = draft?.provider === "custom";

  const openCreate = (provider: ProviderType = "openrouter") => {
    setOriginalProfileKey(null);
    setDraft(createEmptyDraft(provider, presets));
    setError("");
    setSuccessMessage("");
    resetConnectState();
    setEditorOpen(true);
  };

  const openEdit = (profileKey: ProviderProfileKey) => {
    const provider = appConfig?.providers?.[profileKey];
    if (!provider) return;
    setOriginalProfileKey(profileKey);
    const nextDraft = createDraftFromProvider(profileKey, provider, presets);
    setDraft(nextDraft);
    setError("");
    setSuccessMessage("");
    resetConnectState();
    setEditorOpen(true);

    // 先把本地已有列表显示出来（断网也能看到当前启用集）
    const isOpencode =
      nextDraft.provider === "opencode" || nextDraft.provider === "opencode-go";
    if (isOpencode) return;
    setModelRows(
      provider.models.map((model) => ({
        id: model.id,
        label: model.label,
        isNew: false,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        input: model.input,
        enabled: true,
        isDefault: model.id === provider.defaultModel,
      })),
    );
    // 后台静默刷新：失败只在顶部留一行提示，不打断用户（设计 §4.5）
    if (nextDraft.apiKey) {
      void runConnect(nextDraft, true).catch(() => {
        setConnectMessage(t("api.modelsRefreshFailed"));
      });
    }
  };

  const applyConfig = (config: typeof appConfig) => {
    setLocalConfig(config);
    setAppConfig(config);
    setIsConfigured(Boolean(config?.isConfigured));
  };

  const handleSave = async () => {
    if (!draft || !window.electronAPI) return;
    const sanitized = sanitizeDraft(draft, presets);
    if (sanitized.provider === "custom" && !sanitized.models.length) {
      setError(t("api.modelRequired"));
      return;
    }
    if (sanitized.provider === "custom") {
      const ids = sanitized.models.map((m) => m.id);
      if (new Set(ids).size !== ids.length) {
        setError(t("api.duplicateModel"));
        return;
      }
    }
    if (requiresApiKey(sanitized.provider) && !sanitized.apiKey) {
      setError(t("api.enterApiKey"));
      return;
    }
    setIsSaving(true);
    setError("");
    setSuccessMessage("");
    try {
      const payload = {
        profileKey: sanitized.profileKey,
        config: {
          provider: sanitized.provider,
          customProtocol: sanitized.customProtocol,
          name: sanitized.name || undefined,
          apiKey: sanitized.apiKey,
          baseUrl: sanitized.baseUrl,
          defaultModel: sanitized.defaultModel,
          models: sanitized.models,
          ...((sanitized.disabledModels ?? []).length > 0
            ? { disabledModels: sanitized.disabledModels }
            : {}),
          updatedAt: new Date().toISOString(),
        },
      };
      const saved = await window.electronAPI.config.saveProvider(payload);
      let nextConfig = saved.config;
      if (originalProfileKey && originalProfileKey !== sanitized.profileKey) {
        const deleted = await window.electronAPI.config.deleteProvider({
          profileKey: originalProfileKey,
        });
        nextConfig = deleted.config;
      }
      applyConfig(nextConfig);
      setSuccessMessage(t("common.saved"));
      setEditorOpen(false);
      onSaved?.();
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : String(saveError),
      );
    } finally {
      setIsSaving(false);
    }
  };

  // ── 连接：落盘 → 诊断拉模型 → 合并 → 写回 ──
  const isOpencodeDraft =
    draft?.provider === "opencode" || draft?.provider === "opencode-go";

  /** 目录（预设供应商才有；自定义与 oauth/opencode 传空数组） */
  const catalogForDraft = (value: ProviderDraft) => {
    if (value.provider === "custom" || value.provider === "oauth") return [];
    return sortedPresetModels(
      modelsPresetForDraft(value.provider, value.customProtocol, presets),
    );
  };

  /**
   * 连接写回必须自拼 payload：`sanitizeDraft` 对非 custom 供应商会把
   * models 置为空数组（现有行为，不动）。
   */
  const buildProviderPayload = (
    sanitized: ProviderDraft,
    models: ApiProviderModel[],
    defaultModel: string,
    disabledModels: string[],
  ) => ({
    profileKey: sanitized.profileKey,
    config: {
      provider: sanitized.provider,
      customProtocol: sanitized.customProtocol,
      name: sanitized.name || undefined,
      apiKey: sanitized.apiKey,
      baseUrl: sanitized.baseUrl,
      defaultModel,
      models,
      ...(disabledModels.length > 0 ? { disabledModels } : {}),
      updatedAt: new Date().toISOString(),
    },
  });

  /** 写回模型集；失败时把原因写进 connectMessage 并返回 false */
  const persistModels = async (
    sanitized: ProviderDraft,
    models: ApiProviderModel[],
    defaultModel: string,
    disabledModels: string[],
  ): Promise<boolean> => {
    if (!window.electronAPI) return false;
    try {
      const saved = await window.electronAPI.config.saveProvider(
        buildProviderPayload(sanitized, models, defaultModel, disabledModels),
      );
      applyConfig(saved.config);
      return true;
    } catch (saveError) {
      setConnectMessage(
        saveError instanceof Error ? saveError.message : String(saveError),
      );
      return false;
    }
  };

  /** 勾选行 → 持久化模型（保留端点提供的元数据） */
  const rowsToModels = (
    rows: ProviderModelRow[],
    source: ApiProviderModel["source"],
  ): ApiProviderModel[] =>
    rows.map((row) => ({
      id: row.id,
      label: row.label,
      source,
      ...(typeof row.contextWindow === "number" && row.contextWindow > 0
        ? { contextWindow: Math.round(row.contextWindow) }
        : {}),
      ...(typeof row.maxTokens === "number" && row.maxTokens > 0
        ? { maxTokens: Math.round(row.maxTokens) }
        : {}),
      ...(Array.isArray(row.input) && row.input.length > 0
        ? { input: row.input }
        : {}),
    }));

  const applyMergeToDraft = (merge: MergeProviderModelsResult) => {
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            models: merge.enabled,
            defaultModel: merge.defaultModel,
            disabledModels: merge.disabled,
          }
        : prev,
    );
    setModelRows(merge.rows);
  };

  /**
   * `silent` = 打开编辑弹窗时的后台刷新（设计 §4.5）：失败只在顶部留一行
   * 提示并保留本地列表，不弹出诊断面板、不打断用户。
   */
  const runConnect = async (draftValue: ProviderDraft, silent = false) => {
    if (!window.electronAPI) return;
    const sanitized = sanitizeDraft(draftValue, presets);
    const isCustom = sanitized.provider === "custom";
    // 从配置里判定是否已落过盘（不能读 originalProfileKey：openEdit 会
    // 同步调它，那时 state 还是上一轮的值）
    const alreadySaved = Boolean(appConfig?.providers?.[sanitized.profileKey]);

    const fail = (message?: string) => {
      if (silent) {
        setConnectMessage(message ?? t("api.modelsRefreshFailed"));
        setConnectState("idle");
        return;
      }
      if (message) setConnectMessage(message);
      setConnectState("failed");
    };

    if (requiresApiKey(sanitized.provider) && !sanitized.apiKey) {
      setError(t("api.enterApiKey"));
      return;
    }
    if (isCustom && !sanitized.baseUrl) {
      setError(t("api.enterBaseUrl"));
      return;
    }

    setError("");
    setSuccessMessage("");
    setConnectMessage("");
    setDiagResult(null);
    setConnectState("connecting");

    // 预设供应商先落盘（目录兜底，断网也可用）；自定义供应商等拉取成功再落盘。
    // 编辑已有供应商时不预写 —— 它已经落过盘，预写会把现有模型列表洗回目录。
    if (!isCustom && !alreadySaved) {
      setIsSaving(true);
      const savedFirst = await persistModels(
        sanitized,
        [],
        sanitized.defaultModel,
        sanitized.disabledModels ?? [],
      );
      setIsSaving(false);
      if (!savedFirst) {
        setConnectState("idle");
        return;
      }
    }

    let result: DiagnosticResult;
    try {
      result = await diagnoseProviderModels({
        provider: sanitized.provider,
        apiKey: sanitized.apiKey,
        baseUrl: isCustom ? sanitized.baseUrl : undefined,
        customProtocol: sanitized.customProtocol,
        captureModels: true,
      });
    } catch (connectError) {
      fail(
        connectError instanceof ConnectTimeoutError
          ? t("api.connectTimeout")
          : connectError instanceof Error
            ? connectError.message
            : String(connectError),
      );
      return;
    }

    setDiagResult(result);

    if (result.skippedReason) {
      fail(t("api.modelsBusy"));
      return;
    }
    if (!result.overallOk) {
      fail();
      return;
    }

    const live = result.modelsSource === "live" ? (result.models ?? []) : null;
    const merge = mergeProviderModels({
      catalog: catalogForDraft(draftValue),
      live,
      saved: draftValue.models,
      disabled: draftValue.disabledModels ?? [],
      defaultModel: draftValue.defaultModel,
      modelSource: isCustom ? "custom" : "preset",
    });
    applyMergeToDraft(merge);

    // 自定义供应商拿不到可用列表：不落盘，退回手填编辑器 + 「保存」
    if (isCustom && (!live || merge.enabled.length === 0)) {
      fail(t("api.modelsManualHint"));
      return;
    }

    // 有可用的启用集才写回：预设供应商已在前面用内置目录兜底落过盘。
    if (merge.enabled.length > 0) {
      const persisted = await persistModels(
        sanitized,
        merge.enabled,
        merge.defaultModel,
        merge.disabled,
      );
      if (!persisted) {
        fail();
        return;
      }
    }

    setConnectState("connected");
    if (result.modelsSource === "unsupported") {
      setConnectMessage(t("api.modelsUnsupported"));
    } else if (result.modelsFiltered) {
      setConnectMessage(
        t("api.modelsFiltered", { count: result.modelsFiltered }),
      );
    } else {
      setConnectMessage(t("api.connected"));
    }
  };

  const handleConnect = () => {
    if (draft) void runConnect(draft);
  };

  /**
   * 失败态的「保存」：把当前草稿字段（新 Key / 名称）落盘，避免它们被静默丢弃。
   * 有探测结果时用启用集写回（保留端点独有的模型），没有则走原有保存路径
   * （主进程按内置目录兜底）。
   */
  const handleSaveDraft = async () => {
    if (!draft || !window.electronAPI) return;
    if (modelRows.length === 0) {
      await handleSave();
      return;
    }
    const sanitized = sanitizeDraft(draft, presets);
    const rows = modelRows;
    const ok = await persistModels(
      sanitized,
      rowsToModels(rows, isCustomDraft ? "custom" : "preset"),
      rows.some((row) => row.isDefault)
        ? (rows.find((row) => row.isDefault)?.id ?? draft.defaultModel)
        : draft.defaultModel,
      rows.filter((row) => !row.enabled).map((row) => row.id),
    );
    if (ok) closeEditor();
  };

  const persistCurrentModels = async (
    rows: ProviderModelRow[],
    defaultModel: string,
    disabled: string[],
  ): Promise<boolean> => {
    if (!draft) return false;
    const sanitized = sanitizeDraft(draft, presets);
    const enabled = rowsToModels(
      rows.filter((row) => row.enabled),
      isCustomDraft ? "custom" : "preset",
    );
    const ok = await persistModels(sanitized, enabled, defaultModel, disabled);
    if (!ok) {
      setConnectMessage(t("api.modelsSyncFailed"));
    }
    return ok;
  };

  /** 写回失败时回滚到快照（设计 §4.4：不能只有乐观更新） */
  const restoreSnapshot = (snapshot: {
    rows: ProviderModelRow[];
    draft: ProviderDraft | null;
  }) => {
    setModelRows(snapshot.rows);
    if (snapshot.draft) setDraft(snapshot.draft);
  };

  const toggleModel = (id: string) => {
    const target = modelRows.find((row) => row.id === id);
    if (!target) return;
    const enabledNow = modelRows.filter((row) => row.enabled).length;
    if (target.enabled && enabledNow <= 1) {
      setConnectMessage(t("api.atLeastOneModel"));
      return;
    }

    const nextRows = modelRows.map((row) =>
      row.id === id ? { ...row, enabled: !row.enabled } : row,
    );
    const nextEnabled = nextRows.filter((row) => row.enabled);
    const nextDefault = nextEnabled.some(
      (row) => row.id === draft?.defaultModel,
    )
      ? (draft?.defaultModel ?? "")
      : (nextEnabled[0]?.id ?? "");
    const nextRowsWithDefault = nextRows.map((row) => ({
      ...row,
      isDefault: row.id === nextDefault,
    }));
    const nextDisabled = nextRowsWithDefault
      .filter((row) => !row.enabled)
      .map((row) => row.id);

    const snapshot = { rows: modelRows, draft };
    setModelRows(nextRowsWithDefault);
    setConnectMessage("");
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            defaultModel: nextDefault,
            disabledModels: nextDisabled,
            models: rowsToModels(
              nextEnabled,
              prev.provider === "custom" ? "custom" : "preset",
            ),
          }
        : prev,
    );
    void persistCurrentModels(
      nextRowsWithDefault,
      nextDefault,
      nextDisabled,
    ).then((ok) => {
      if (!ok) restoreSnapshot(snapshot);
    });
  };

  const setDefaultModelRow = (id: string) => {
    if (!modelRows.some((row) => row.id === id && row.enabled)) return;
    const nextRows = modelRows.map((row) => ({
      ...row,
      isDefault: row.id === id,
    }));
    const nextDisabled = nextRows
      .filter((row) => !row.enabled)
      .map((r) => r.id);
    const snapshot = { rows: modelRows, draft };
    setModelRows(nextRows);
    setDraft((prev) => (prev ? { ...prev, defaultModel: id } : prev));
    void persistCurrentModels(nextRows, id, nextDisabled).then((ok) => {
      if (!ok) restoreSnapshot(snapshot);
    });
  };

  // ── Vision model save (from modal) ──
  const handleVisionSave = async () => {
    if (!window.electronAPI) return;
    if (visionDraft.enabled && !visionDraft.model.trim()) {
      setVisionError(t("api.modelRequired"));
      return;
    }
    if (
      visionDraft.enabled &&
      !visionDraft.apiKey.trim() &&
      visionDraft.provider !== "ollama"
    ) {
      setVisionError(t("api.enterApiKey"));
      return;
    }
    setIsVisionSaving(true);
    setVisionError("");
    setVisionSuccess("");
    try {
      const config: VisionModelConfig = {
        enabled: visionDraft.enabled,
        provider: visionDraft.provider,
        customProtocol:
          visionDraft.provider === "custom"
            ? visionDraft.customProtocol
            : undefined,
        apiKey: visionDraft.apiKey,
        baseUrl: visionDraft.baseUrl || undefined,
        model: visionDraft.model,
      };
      const saved = await window.electronAPI.config.save({
        visionModel: config,
      });
      applyConfig(saved.config);
      setVisionEditorOpen(false);
      setVisionSuccess(t("common.saved"));
    } catch (saveError) {
      setVisionError(
        saveError instanceof Error ? saveError.message : String(saveError),
      );
    } finally {
      setIsVisionSaving(false);
    }
  };

  // ── Vision model toggle (instant save from card) ──
  // IMPORTANT: toggle must use the SAVED config (appConfig.visionModel),
  // NOT the draft (visionDraft) which may contain unsaved editor changes.
  const handleVisionToggle = async (newEnabled: boolean) => {
    if (!window.electronAPI) return;
    const saved = appConfig?.visionModel;
    if (!saved) return;
    const config: VisionModelConfig = {
      enabled: newEnabled,
      provider: saved.provider,
      customProtocol:
        saved.provider === "custom" ? saved.customProtocol : undefined,
      apiKey: saved.apiKey,
      baseUrl: saved.baseUrl || undefined,
      model: saved.model,
    };
    setIsVisionSaving(true);
    try {
      const savedConfig = await window.electronAPI.config.save({
        visionModel: config,
      });
      applyConfig(savedConfig.config);
      setVisionDraft((prev) => ({ ...prev, enabled: newEnabled }));
    } catch (saveError) {
      setVisionError(
        saveError instanceof Error ? saveError.message : String(saveError),
      );
    } finally {
      setIsVisionSaving(false);
    }
  };

  // ── Close vision editor, resetting draft to saved state ──
  const closeVisionEditor = () => {
    setVisionEditorOpen(false);
    if (appConfig?.visionModel) {
      setVisionDraft(appConfig.visionModel);
    }
  };

  // ── Open vision model editor ──
  const openVisionEditor = () => {
    // Pre-fill draft from saved config, or use defaults
    if (appConfig?.visionModel) {
      setVisionDraft(appConfig.visionModel);
    }
    setVisionError("");
    setVisionSuccess("");
    setVisionEditorOpen(true);
  };

  // ── Mask API key for display ──
  const maskApiKey = (key: string): string => {
    if (!key || key.length <= 8) return key || "—";
    return `${key.slice(0, 4)}...${key.slice(-4)}`;
  };

  // ── Vision model helper: reuse active provider's API key ──
  const reuseActiveProviderApiKey = () => {
    const activeKey = appConfig?.activeProviderKey;
    if (!activeKey) return;
    const provider = appConfig?.providers?.[activeKey];
    if (!provider?.apiKey) return;
    setVisionDraft((prev) => ({ ...prev, apiKey: provider.apiKey }));
  };

  const requestDelete = (profileKey: ProviderProfileKey) => {
    setPendingDeleteProfileKey(profileKey);
    setError("");
    setSuccessMessage("");
  };

  const closeDeleteDialog = () => {
    if (isDeleting) return;
    setPendingDeleteProfileKey(null);
  };

  const confirmDelete = async () => {
    if (!window.electronAPI || !pendingDeleteProfileKey) return;
    setIsDeleting(true);
    setError("");
    setSuccessMessage("");
    try {
      const result = await window.electronAPI.config.deleteProvider({
        profileKey: pendingDeleteProfileKey,
      });
      applyConfig(result.config);
      setPendingDeleteProfileKey(null);
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : String(deleteError),
      );
    } finally {
      setIsDeleting(false);
    }
  };

  const selectProvider = (provider: ProviderType) => {
    setDraft((current) => {
      const next = createEmptyDraft(
        provider,
        presets,
        current?.customProtocol || "anthropic",
      );
      return {
        ...next,
        apiKey: current?.apiKey || "",
      };
    });
  };

  const selectCustomProtocol = (protocol: CustomProtocolType) => {
    setDraft((current) => {
      if (!current || current.provider !== "custom") {
        const next = createEmptyDraft("custom", presets, protocol);
        return {
          ...next,
          apiKey: current?.apiKey || "",
        };
      }
      return { ...current, customProtocol: protocol };
    });
  };

  // ── OAuth handlers ──
  const handleOAuthLogin = async (providerId: string) => {
    if (!window.electronAPI) return;
    setOAuthLoading((prev) => ({ ...prev, [providerId]: true }));
    setOAuthErrors((prev) => {
      const next = { ...prev };
      delete next[providerId];
      return next;
    });
    try {
      const providerInfo = OAUTH_PROVIDERS.find((p) => p.id === providerId);
      const result = await connectOAuthProvider(
        providerId,
        providerInfo?.name || providerId,
        t,
      );
      applyConfig(result.config);
      if (result.openRouterModelsFromFallback) {
        const fallbackMsg = t("api.oauthOpenRouterFallbackNotice");
        setSuccessMessage(
          result.openRouterModelsFromFallback.error
            ? `${fallbackMsg} (${result.openRouterModelsFromFallback.error})`
            : fallbackMsg,
        );
      }
      // Only update UI after config save succeeded
      const status =
        providerId === "openrouter"
          ? await window.electronAPI.openrouterAuth.status()
          : await window.electronAPI.auth.status(providerId);
      setOAuthStatuses((prev) => ({ ...prev, [providerId]: status }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Login failed";
      setOAuthErrors((prev) => ({ ...prev, [providerId]: message }));
    } finally {
      setOAuthLoading((prev) => ({ ...prev, [providerId]: false }));
    }
  };

  const handleOAuthLogout = async (providerId: string) => {
    if (!window.electronAPI) return;
    if (providerId === "openrouter") {
      await window.electronAPI.openrouterAuth.logout();
    } else {
      await window.electronAPI.auth.logout(providerId);
    }
    setOAuthStatuses((prev) => ({
      ...prev,
      [providerId]: {
        loggedIn: false,
        providerName: prev[providerId]?.providerName || providerId,
      },
    }));
    // Reset any stale error from a previous login attempt
    setOAuthErrors((prev) => {
      const next = { ...prev };
      delete next[providerId];
      return next;
    });
    // Remove provider from ConfigStore so it disappears from model selector
    try {
      const profileKey: ProviderProfileKey =
        providerId === "openrouter"
          ? "openrouter"
          : oauthProfileKey(providerId);
      const deleted = await window.electronAPI.config.deleteProvider({
        profileKey,
      });
      applyConfig(deleted.config);
    } catch {
      // Provider may not exist in config yet — ignore
    }
  };

  const confirmDisconnectOAuth = async (providerId: string) => {
    if (!window.electronAPI) return;
    setPendingOAuthLogoutProviderId(null);
    await handleOAuthLogout(providerId);
  };

  const closeOAuthDisconnectDialog = () => {
    setPendingOAuthLogoutProviderId(null);
  };

  const handleSubscriptionSave = async (profileKey: string, apiKey: string) => {
    const result = await connectCodingSubscription(
      profileKey,
      apiKey,
      t,
      appConfig?.providers[profileKey]?.defaultModel,
    );
    applyConfig(result.config);
    onSaved?.();
  };

  const handleSubscriptionDelete = async (profileKey: string) => {
    const deleted = await window.electronAPI.config.deleteProvider({
      profileKey,
    });
    applyConfig(deleted.config);
    onSaved?.();
  };

  const updateDraft = (patch: Partial<ProviderDraft>) => {
    setDraft((current) => {
      if (!current) return current;
      const next = { ...current, ...patch };
      if (next.provider !== "custom") {
        next.profileKey = profileKeyFromProvider(
          next.provider,
          next.customProtocol,
        );
      }
      return next;
    });
  };

  const addModel = () => {
    setDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        models: [
          ...current.models,
          { id: "", label: "", source: "custom" as const },
        ],
      };
    });
  };

  const updateModel = (index: number, patch: Partial<ApiProviderModel>) => {
    setDraft((current) => {
      if (!current) return current;
      const models = current.models.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      );
      return { ...current, models };
    });
  };

  const removeModel = (index: number) => {
    setDraft((current) => {
      if (!current) return current;
      const removing = current.models[index];
      const models = current.models.filter(
        (_, itemIndex) => itemIndex !== index,
      );
      const defaultModel =
        removing?.id === current.defaultModel
          ? models[0]?.id || ""
          : current.defaultModel;
      return { ...current, models, defaultModel };
    });
  };

  /**
   * 已配置列表（或空态）。
   * 标题块在 embedded 时隐藏，但列表本身照常渲染 —— 与改动前一致。
   */
  const configuredList =
    configuredProviders.length === 0 ? (
      <SettingsCard>
        <SettingsRow
          title={t("api.configuredListEmptyTitle")}
          description={t("api.configuredListEmpty")}
        />
      </SettingsCard>
    ) : (
      <ConfiguredProviderList
        rows={configuredProviders}
        presets={presets}
        oauthStatuses={oauthStatuses}
        onEdit={openEdit}
        onDelete={requestDelete}
        onDisconnect={(providerId) =>
          setPendingOAuthLogoutProviderId(providerId)
        }
      />
    );

  if (isLoadingConfig) {
    return (
      <div className="flex flex-col items-center justify-center py-12 space-y-3">
        <p className="text-xs uppercase tracking-[0.16em] text-text-muted">
          DeskWand
        </p>
        <div className="flex items-center gap-2">
          <Loader2 className="h-5 w-5 animate-spin text-accent" />
          <span className="text-sm text-text-secondary">
            {t("common.loading")}
          </span>
        </div>
      </div>
    );
  }

  return (
    <>
      {!embedded && (
        <div className="flex gap-1 border-b border-border-muted mb-5">
          <button
            type="button"
            onClick={() => setActiveTab("main")}
            className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === "main"
                ? "border-accent text-accent"
                : "border-transparent text-text-muted hover:text-text-secondary"
            }`}
          >
            <Bot className="h-3.5 w-3.5" />
            {t("api.mainModelTab")}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("vision")}
            className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === "vision"
                ? "border-accent text-accent"
                : "border-transparent text-text-muted hover:text-text-secondary"
            }`}
          >
            <Eye className="h-3.5 w-3.5" />
            {t("api.visionModelTab")}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("search")}
            className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === "search"
                ? "border-accent text-accent"
                : "border-transparent text-text-muted hover:text-text-secondary"
            }`}
          >
            <Globe2 className="h-3.5 w-3.5" />
            {t("api.searchModelTab")}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("utility")}
            className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === "utility"
                ? "border-accent text-accent"
                : "border-transparent text-text-muted hover:text-text-secondary"
            }`}
          >
            <Zap className="h-3.5 w-3.5" />
            {t("api.utilityModelTab")}
          </button>
        </div>
      )}

      {(activeTab === "main" || embedded) && (
        <div className="max-w-[1080px] space-y-5">
          {!embedded && (
            <SettingsSection
              title={t("api.configuredListTitle")}
              description={t("api.configuredListDesc")}
            >
              {configuredList}
            </SettingsSection>
          )}

          {embedded && configuredList}

          {embedded && (
            <button
              type="button"
              onClick={() => openCreate()}
              className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-accent-foreground hover:bg-accent-hover"
            >
              <Plus className="h-3.5 w-3.5" />
              {t("api.addApi")}
            </button>
          )}

          <SettingsSection title={t("api.addApi")}>
            <ProviderCatalogGrid
              presets={presets}
              configuredProfileKeys={configuredProfileKeys}
              oauthStatuses={oauthStatuses}
              oauthLoading={oauthLoading}
              oauthErrors={oauthErrors}
              onCreateProvider={openCreate}
              onCreatePlan={() => setPlanDialogOpen(true)}
              onOAuthLogin={handleOAuthLogin}
              onOAuthDisconnect={(providerId) =>
                setPendingOAuthLogoutProviderId(providerId)
              }
            />
          </SettingsSection>
        </div>
      )}

      {activeTab === "vision" && !embedded && (
        <div className="max-w-[720px] space-y-5">
          {!isVisionConfigured ? (
            /* ── Empty state ── */
            <div className="rounded-2xl border border-dashed border-border-muted px-6 py-10 text-center">
              <div className="text-3xl mb-3">🔮</div>
              <h3 className="text-sm font-medium text-text-primary">
                {t("api.visionModelNotConfigured")}
              </h3>
              <p className="mt-1 text-xs text-text-muted max-w-xs mx-auto">
                {t("api.visionModelNotConfiguredDesc")}
              </p>
              <button
                type="button"
                onClick={openVisionEditor}
                className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground hover:bg-accent-hover"
              >
                <Plus className="h-3.5 w-3.5" />
                {t("api.visionModelConfigureButton")}
              </button>
            </div>
          ) : (
            /* ── Configured card ── */
            <div
              className={`rounded-2xl border border-border-muted bg-background px-4 py-3 shadow-card ${
                !visionDraft.enabled ? "opacity-60" : ""
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex min-w-0 items-center gap-2 text-sm font-medium text-text-primary">
                    <ProviderBrandIcon
                      brand={
                        resolveProviderBrand(
                          visionDraft.provider,
                          visionDraft.customProtocol,
                        ) ?? "custom"
                      }
                      className="h-4 w-4 flex-shrink-0"
                    />
                    <span className="truncate">
                      {visionProviderName(
                        visionDraft.provider,
                        visionDraft.customProtocol,
                        presets,
                        t,
                      )}
                      {" / "}
                      {visionDraft.model}
                    </span>
                  </p>
                  <p className="mt-1 truncate text-xs text-text-muted">
                    API Key: {maskApiKey(visionDraft.apiKey)}
                    {!visionDraft.enabled && (
                      <span className="ml-1">
                        — {t("api.visionModelDisabledHint")}
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <SettingsSwitch
                    checked={visionDraft.enabled}
                    onChange={(next) => {
                      void handleVisionToggle(next);
                    }}
                    label={t("api.visionModelEnable")}
                    testId="vision-model-enabled"
                  />
                  <button
                    type="button"
                    onClick={openVisionEditor}
                    className="inline-flex items-center gap-1 rounded-lg border border-border-muted px-2.5 py-1.5 text-xs text-text-secondary hover:bg-surface-hover hover:text-text-primary"
                  >
                    <Pencil className="h-3 w-3" />
                    {t("api.editApi")}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Search tab ── */}
      {activeTab === "search" && !embedded && searchDraft && (
        <div className="max-w-[720px] space-y-5">
          <SettingsContentSection
            title={t("webAccess.groupTitle")}
            description={t("webAccess.groupDescription")}
          >
            <fieldset
              disabled={isSearchSaving}
              className="m-0 min-w-0 space-y-3 border-0 p-0"
            >
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-text-secondary">
                  {t("webAccess.defaultProvider")}
                </span>
                <select
                  value={searchDraft.defaultProvider}
                  onChange={(event) => {
                    setSearchDraft({
                      ...searchDraft,
                      defaultProvider: event.target
                        .value as WebAccessConfig["defaultProvider"],
                    });
                    setSearchMessage(null);
                  }}
                  className="w-full rounded-lg border border-border-muted bg-background px-3 py-2 text-sm text-text-primary"
                >
                  {WEB_SEARCH_PROVIDERS.map((provider) => (
                    <option key={provider} value={provider}>
                      {t(`webAccess.providers.${provider}`)}
                    </option>
                  ))}
                </select>
              </label>

              {(["openai", "gemini", "deepseek"] as const).map((provider) => {
                const credential = searchDraft[provider];
                const isOpen = searchExpanded === provider;
                return (
                  <div
                    key={provider}
                    className="rounded-xl border border-border-muted"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setSearchExpanded((c) =>
                          c === provider ? null : provider,
                        )
                      }
                      aria-expanded={isOpen}
                      aria-controls={`web-access-${provider}-settings`}
                      className="flex w-full items-center justify-between px-4 py-3 text-left"
                    >
                      <span className="flex items-center gap-2 text-sm font-medium text-text-primary">
                        <ProviderBrandIcon
                          brand={provider}
                          className="h-4 w-4 flex-shrink-0"
                        />
                        {t(`webAccess.providers.${provider}`)}
                      </span>
                      {isOpen ? (
                        <ChevronDown className="h-4 w-4 text-text-muted" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-text-muted" />
                      )}
                    </button>
                    {isOpen && (
                      <div
                        id={`web-access-${provider}-settings`}
                        className="space-y-3 border-t border-border-muted px-4 py-3"
                      >
                        <label className="block space-y-1">
                          <span className="text-xs text-text-muted">
                            {t("webAccess.credentialSource")}
                          </span>
                          <select
                            value={credential.source}
                            onChange={(event) => {
                              setSearchDraft((c) =>
                                c
                                  ? {
                                      ...c,
                                      [provider]: {
                                        ...c[provider],
                                        source: event.target.value as
                                          | "inherit"
                                          | "dedicated",
                                      },
                                    }
                                  : c,
                              );
                              setSearchMessage(null);
                            }}
                            className="w-full rounded-lg border border-border-muted bg-background px-3 py-2 text-sm"
                          >
                            <option value="inherit">
                              {t("webAccess.inherit")}
                            </option>
                            <option value="dedicated">
                              {t("webAccess.dedicated")}
                            </option>
                          </select>
                        </label>
                        {credential.source === "inherit" ? (
                          <label className="block space-y-1">
                            <span className="text-xs text-text-muted">
                              {t("webAccess.profile")}
                            </span>
                            <select
                              value={credential.profileKey}
                              onChange={(event) => {
                                setSearchDraft((c) =>
                                  c
                                    ? {
                                        ...c,
                                        [provider]: {
                                          ...c[provider],
                                          profileKey: event.target.value,
                                        },
                                      }
                                    : c,
                                );
                              }}
                              className="w-full rounded-lg border border-border-muted bg-background px-3 py-2 text-sm"
                            >
                              <option value="">
                                {t("webAccess.unavailable")}
                              </option>
                              {searchMatchingProfiles(
                                appConfig || ({ providers: {} } as AppConfig),
                                provider,
                              ).map((profile) => (
                                <option key={profile.key} value={profile.key}>
                                  {resolveProviderDisplayName(
                                    profile.key,
                                    profile.name,
                                    t,
                                  ) || profile.key}
                                </option>
                              ))}
                            </select>
                          </label>
                        ) : (
                          <>
                            <label className="block space-y-1">
                              <span className="text-xs text-text-muted">
                                {t("webAccess.apiKey")}
                              </span>
                              <input
                                type="password"
                                autoComplete="new-password"
                                value={credential.apiKey}
                                onChange={(event) => {
                                  setSearchDraft((c) =>
                                    c
                                      ? {
                                          ...c,
                                          [provider]: {
                                            ...c[provider],
                                            apiKey: event.target.value,
                                          },
                                        }
                                      : c,
                                  );
                                }}
                                className="w-full rounded-lg border border-border-muted bg-background px-3 py-2 text-sm"
                              />
                            </label>
                            <label className="block space-y-1">
                              <span className="text-xs text-text-muted">
                                {t("webAccess.baseUrl")}
                              </span>
                              <input
                                value={credential.baseUrl}
                                onChange={(event) => {
                                  setSearchDraft((c) =>
                                    c
                                      ? {
                                          ...c,
                                          [provider]: {
                                            ...c[provider],
                                            baseUrl: event.target.value,
                                          },
                                        }
                                      : c,
                                  );
                                }}
                                className="w-full rounded-lg border border-border-muted bg-background px-3 py-2 text-sm"
                              />
                            </label>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {(
                [
                  ["exa", "exaApiKey"],
                  ["brave", "braveApiKey"],
                  ["parallel", "parallelApiKey"],
                  ["tavily", "tavilyApiKey"],
                  ["perplexity", "perplexityApiKey"],
                ] as const
              ).map(([provider, field]) => {
                const isOpen = searchExpanded === provider;
                return (
                  <div
                    key={provider}
                    className="rounded-xl border border-border-muted"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setSearchExpanded((c) =>
                          c === provider ? null : provider,
                        )
                      }
                      aria-expanded={isOpen}
                      aria-controls={`web-access-${provider}-settings`}
                      className="flex w-full items-center justify-between px-4 py-3 text-left"
                    >
                      <span className="flex items-center gap-2 text-sm font-medium text-text-primary">
                        <Search className="h-4 w-4 flex-shrink-0" />
                        {t(`webAccess.providers.${provider}`)}
                      </span>
                      {isOpen ? (
                        <ChevronDown className="h-4 w-4 text-text-muted" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-text-muted" />
                      )}
                    </button>
                    {isOpen && (
                      <div
                        id={`web-access-${provider}-settings`}
                        className="space-y-2 border-t border-border-muted px-4 py-3"
                      >
                        <label className="block space-y-1">
                          <span className="text-xs text-text-muted">
                            {t("webAccess.apiKey")}
                          </span>
                          <input
                            type="password"
                            autoComplete="new-password"
                            value={String(searchDraft[field])}
                            onChange={(event) => {
                              setSearchDraft({
                                ...searchDraft,
                                [field]: event.target.value,
                              });
                              setSearchMessage(null);
                            }}
                            className="w-full rounded-lg border border-border-muted bg-background px-3 py-2 text-sm"
                          />
                        </label>
                        {provider === "exa" && (
                          <p className="text-xs text-text-muted">
                            {t("webAccess.exaZeroConfig")}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={async () => {
                    if (!searchDraft || !window.electronAPI) return;
                    setIsSearchSaving(true);
                    setSearchMessage(null);
                    try {
                      const saved = await window.electronAPI.config.save({
                        webAccess: searchDraft,
                      });
                      applyConfig(saved.config);
                      setSearchDraft(searchAddInheritedDefaults(saved.config));
                      setSearchMessage("saved");
                    } catch {
                      setSearchMessage("error");
                    } finally {
                      setIsSearchSaving(false);
                    }
                  }}
                  disabled={isSearchSaving}
                  className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isSearchSaving ? t("common.saving") : t("common.save")}
                </button>
                {searchMessage && (
                  <span
                    className={`text-xs ${searchMessage === "saved" ? "text-success" : "text-error"}`}
                  >
                    {t(
                      searchMessage === "saved"
                        ? "webAccess.saveSuccess"
                        : "webAccess.saveError",
                    )}
                  </span>
                )}
              </div>
            </fieldset>
          </SettingsContentSection>
        </div>
      )}

      {/* ── Utility model tab ── */}
      {activeTab === "utility" && !embedded && (
        <div className="max-w-[720px] space-y-5">
          <SettingsContentSection
            title={t("api.utilityModelTitle")}
            description={t("api.utilityModelDesc")}
          >
            <fieldset
              disabled={isUtilitySaving}
              className="m-0 min-w-0 space-y-4 border-0 p-0"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-text-secondary">
                  {t("api.utilityInheritActive")}
                </span>
                <SettingsSwitch
                  checked={utilityDraft.inheritFromActive}
                  onChange={(next) => {
                    setUtilityDraft((prev) => ({
                      ...prev,
                      inheritFromActive: next,
                    }));
                    setUtilityMessage(null);
                  }}
                  label={t("api.utilityInheritActive")}
                  testId="utility-inherit-active"
                />
              </div>

              {!utilityDraft.inheritFromActive && (
                <>
                  <label className="block space-y-1.5">
                    <span className="text-xs font-medium text-text-secondary">
                      {t("api.utilityProvider")}
                    </span>
                    <select
                      value={utilityDraft.providerProfileKey || ""}
                      onChange={(e) => {
                        const key = e.target.value || undefined;
                        const profile = key
                          ? appConfig?.providers?.[key]
                          : undefined;
                        setUtilityDraft((prev) => ({
                          ...prev,
                          providerProfileKey: key,
                          model: profile?.defaultModel || "",
                        }));
                        setUtilityMessage(null);
                      }}
                      className="w-full rounded-lg border border-border-muted bg-background px-3 py-2 text-sm text-text-primary"
                    >
                      <option value="">
                        {t("api.utilityProviderPlaceholder")}
                      </option>
                      {Object.entries(appConfig?.providers || {}).map(
                        ([key, cfg]) =>
                          cfg ? (
                            <option key={key} value={key}>
                              {resolveProviderDisplayName(key, cfg.name, t) ||
                                key}
                            </option>
                          ) : null,
                      )}
                    </select>
                  </label>

                  <label className="block space-y-1.5">
                    <span className="text-xs font-medium text-text-secondary">
                      {t("api.utilityModel")}
                    </span>
                    <select
                      value={utilityDraft.model || ""}
                      onChange={(e) => {
                        setUtilityDraft((prev) => ({
                          ...prev,
                          model: e.target.value,
                        }));
                        setUtilityMessage(null);
                      }}
                      className="w-full rounded-lg border border-border-muted bg-background px-3 py-2 text-sm text-text-primary"
                    >
                      <option value="">
                        {t("api.utilityModelPlaceholder")}
                      </option>
                      {(
                        appConfig?.providers?.[
                          utilityDraft.providerProfileKey || ""
                        ]?.models || []
                      ).map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label || m.id}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}

              <button
                type="button"
                onClick={async () => {
                  if (!window.electronAPI) return;
                  setIsUtilitySaving(true);
                  setUtilityMessage(null);
                  try {
                    const saved = await window.electronAPI.config.save({
                      utilityRuntime: utilityDraft,
                    });
                    applyConfig(saved.config);
                    setUtilityMessage("saved");
                  } catch {
                    setUtilityMessage("error");
                  } finally {
                    setIsUtilitySaving(false);
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-accent-foreground hover:bg-accent-hover"
              >
                {t("api.saveUtilityModel")}
              </button>
              {utilityMessage === "saved" && (
                <p className="text-xs text-success">{t("common.saved")}</p>
              )}
              {utilityMessage === "error" && (
                <p className="text-xs text-error">{t("api.saveFailed")}</p>
              )}
            </fieldset>
          </SettingsContentSection>
        </div>
      )}

      {/* ── Vision model editor modal ── */}
      {visionEditorOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 max-h-[88vh] w-full max-w-[560px] overflow-hidden rounded-2xl border border-border-muted bg-background">
            <div className="flex items-center justify-between border-b border-border-muted px-5 py-4">
              <h3 className="text-sm font-medium text-text-primary">
                {t("api.visionModelEditTitle")}
              </h3>
              <button
                type="button"
                onClick={closeVisionEditor}
                className="rounded-lg p-2 hover:bg-surface-hover"
              >
                <X className="h-4 w-4 text-text-secondary" />
              </button>
            </div>
            <div className="max-h-[calc(88vh-64px)] overflow-y-auto p-5">
              <div className="space-y-5">
                {/* Enable toggle */}
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-text-primary">
                    {t("api.visionModelEnable")}
                  </span>
                  <SettingsSwitch
                    checked={visionDraft.enabled}
                    onChange={(next) => {
                      setVisionDraft((prev) => ({ ...prev, enabled: next }));
                    }}
                    label={t("api.visionModelEnable")}
                    testId="vision-model-enabled-in-modal"
                  />
                </div>

                {/* Provider selection */}
                <div className="space-y-3 border-b border-border-muted pb-5">
                  <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
                    <Server className="h-4 w-4" />
                    {t("api.provider")}
                  </label>
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                    {VISION_PROVIDER_ORDER.map((provider) => (
                      <button
                        key={provider}
                        type="button"
                        onClick={() => {
                          const preset = (
                            presets as unknown as Record<string, ProviderPreset>
                          )[provider];
                          setVisionDraft((prev) => ({
                            ...prev,
                            provider,
                            baseUrl:
                              provider !== "custom"
                                ? preset?.baseUrl || ""
                                : prev.baseUrl,
                            model:
                              provider === "zhipu"
                                ? "glm-4.6v-flash"
                                : prev.model,
                          }));
                        }}
                        className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                          visionDraft.provider === provider
                            ? "border-accent bg-accent/10 font-medium text-accent"
                            : "border-border-muted text-text-secondary hover:border-border hover:text-text-primary"
                        }`}
                      >
                        <ProviderBrandIcon
                          brand={provider}
                          className="h-4 w-4 flex-shrink-0"
                        />
                        {providerOptionLabel(provider, presets, t)}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Custom protocol selector */}
                {visionDraft.provider === "custom" && (
                  <div className="space-y-3 border-b border-border-muted pb-5">
                    <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
                      <Server className="h-4 w-4" />
                      {t("api.protocol")}
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {(["anthropic", "openai", "gemini"] as const).map(
                        (protocol) => (
                          <button
                            key={protocol}
                            type="button"
                            onClick={() => {
                              const preset =
                                protocol === "anthropic"
                                  ? presets.custom
                                  : protocol === "openai"
                                    ? presets.openai
                                    : presets.gemini;
                              setVisionDraft((prev) => ({
                                ...prev,
                                customProtocol: protocol,
                                baseUrl: preset.baseUrl,
                              }));
                            }}
                            className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                              visionDraft.customProtocol === protocol
                                ? "border-accent bg-accent/10 font-medium text-accent"
                                : "border-border-muted text-text-secondary hover:border-border hover:text-text-primary"
                            }`}
                          >
                            {protocol}
                          </button>
                        ),
                      )}
                    </div>
                  </div>
                )}

                {/* Zhipu region selector */}
                {visionDraft.provider === "zhipu" && (
                  <div className="space-y-3 border-b border-border-muted pb-5">
                    <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
                      <Globe2 className="h-4 w-4" />
                      {t("api.region")}
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {ZHIPU_REGIONS.map((region) => (
                        <button
                          key={region.id}
                          type="button"
                          onClick={() =>
                            setVisionDraft((prev) => ({
                              ...prev,
                              baseUrl: region.baseUrl,
                            }))
                          }
                          className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                            visionDraft.baseUrl === region.baseUrl
                              ? "border-accent bg-accent/10 font-medium text-accent"
                              : "border-border-muted text-text-secondary hover:border-border hover:text-text-primary"
                          }`}
                        >
                          {t(region.labelKey)}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-text-muted">
                      {t("api.zhipuRegionHint")}
                    </p>
                  </div>
                )}

                {/* API Key */}
                <div className="space-y-3 border-b border-border-muted pb-5">
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
                      <Key className="h-4 w-4" />
                      {t("api.apiKey")}
                    </label>
                    {appConfig?.activeProviderKey &&
                      appConfig?.providers?.[appConfig.activeProviderKey]
                        ?.apiKey && (
                        <button
                          type="button"
                          onClick={reuseActiveProviderApiKey}
                          className="text-xs text-accent hover:underline"
                        >
                          {t("api.reuseMainModelKey")}
                        </button>
                      )}
                  </div>
                  <input
                    type="password"
                    value={visionDraft.apiKey}
                    onChange={(event) =>
                      setVisionDraft((prev) => ({
                        ...prev,
                        apiKey: event.target.value,
                      }))
                    }
                    placeholder={t("api.enterApiKey")}
                    className="w-full rounded-lg border border-border bg-background px-4 py-3 text-text-primary placeholder-text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
                  />
                </div>

                {/* Base URL (custom provider or Ollama only) */}
                {(visionDraft.provider === "custom" ||
                  visionDraft.provider === "ollama") && (
                  <div className="space-y-3 border-b border-border-muted pb-5">
                    <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
                      <Server className="h-4 w-4" />
                      {t("api.baseUrl")}
                    </label>
                    <input
                      type="text"
                      value={visionDraft.baseUrl || ""}
                      onChange={(event) =>
                        setVisionDraft((prev) => ({
                          ...prev,
                          baseUrl: event.target.value,
                        }))
                      }
                      placeholder={t("api.enterBaseUrl")}
                      className="w-full rounded-lg border border-border bg-background px-4 py-3 text-text-primary placeholder-text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
                    />
                  </div>
                )}

                {/* Model */}
                <div className="space-y-3 border-b border-border-muted pb-5">
                  <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
                    <Eye className="h-4 w-4" />
                    {t("api.model")}
                  </label>
                  <input
                    type="text"
                    value={visionDraft.model}
                    onChange={(event) =>
                      setVisionDraft((prev) => ({
                        ...prev,
                        model: event.target.value,
                      }))
                    }
                    placeholder={t("api.visionModelPlaceholder")}
                    className="w-full rounded-lg border border-border bg-background px-4 py-3 text-text-primary placeholder-text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
                  />
                  {/* Model suggestions based on provider */}
                  {visionDraft.provider !== "custom" && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {(() => {
                        const preset = (
                          presets as unknown as Record<string, ProviderPreset>
                        )[visionDraft.provider];
                        if (!preset?.models) return null;
                        return preset.models.slice(0, 5).map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() =>
                              setVisionDraft((prev) => ({
                                ...prev,
                                model: m.id,
                              }))
                            }
                            className={`rounded-md border px-2 py-1 text-xs transition-colors ${
                              visionDraft.model === m.id
                                ? "border-accent bg-accent/10 text-accent"
                                : "border-border-muted text-text-muted hover:border-border hover:text-text-secondary"
                            }`}
                          >
                            {m.name || m.id}
                          </button>
                        ));
                      })()}
                    </div>
                  )}
                </div>

                {/* Error / Success */}
                {visionError && (
                  <div className="flex items-center gap-2 rounded-lg bg-error/10 px-4 py-3 text-sm text-error">
                    <AlertCircle className="h-4 w-4 flex-shrink-0" />
                    {visionError}
                  </div>
                )}
                {visionSuccess && (
                  <div className="flex items-center gap-2 rounded-lg bg-success/10 px-4 py-3 text-sm text-success">
                    <CheckCircle className="h-4 w-4 flex-shrink-0" />
                    {visionSuccess}
                  </div>
                )}

                {/* Buttons */}
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={closeVisionEditor}
                    className="rounded-lg border border-border-muted px-4 py-2.5 text-sm text-text-secondary hover:bg-surface-hover hover:text-text-primary"
                  >
                    {t("common.cancel")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void handleVisionSave();
                    }}
                    disabled={isVisionSaving}
                    className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isVisionSaving ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {t("common.saving")}
                      </>
                    ) : (
                      <>
                        <CheckCircle className="h-4 w-4" />
                        {t("api.saveSettings")}
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {pendingOAuthLogoutProviderId &&
        (() => {
          const pid = pendingOAuthLogoutProviderId;
          const p = OAUTH_PROVIDERS.find((pp) => pp.id === pid);
          return (
            <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
              <div className="mx-4 w-full max-w-md rounded-2xl border border-border-muted bg-background shadow-xl">
                <div className="border-b border-border-muted px-5 py-4">
                  <h3 className="text-sm font-medium text-text-primary">
                    {t("api.oauthDisconnect")}
                  </h3>
                </div>
                <div className="space-y-4 px-5 py-4">
                  <p className="text-sm text-text-secondary">
                    {t("api.oauthDisconnectConfirm", {
                      name: p?.name || pid,
                    })}
                  </p>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={closeOAuthDisconnectDialog}
                      className="rounded-lg border border-border-muted px-4 py-2 text-sm text-text-secondary hover:bg-surface-hover hover:text-text-primary"
                    >
                      {t("common.cancel")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void confirmDisconnectOAuth(pid);
                      }}
                      className="rounded-lg bg-error px-4 py-2 text-sm font-medium text-white hover:bg-error/90"
                    >
                      {t("api.oauthDisconnect")}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

      {pendingDeleteProfileKey && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
          <div className="mx-4 w-full max-w-md rounded-2xl border border-border-muted bg-background shadow-xl">
            <div className="border-b border-border-muted px-5 py-4">
              <h3 className="text-sm font-medium text-text-primary">
                {t("api.deleteApi")}
              </h3>
            </div>
            <div className="space-y-4 px-5 py-4">
              <p className="text-sm text-text-secondary">
                {t("api.deleteApiConfirm", {
                  name:
                    appConfig?.providers?.[pendingDeleteProfileKey]?.name ||
                    providerLabel(pendingDeleteProfileKey, presets, t),
                })}
              </p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={closeDeleteDialog}
                  disabled={isDeleting}
                  className="rounded-lg border border-border-muted px-4 py-2 text-sm text-text-secondary hover:bg-surface-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void confirmDelete();
                  }}
                  disabled={isDeleting}
                  className="inline-flex items-center gap-2 rounded-lg bg-error px-4 py-2 text-sm font-medium text-white hover:bg-error/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isDeleting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                  {t("api.deleteApi")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {planDialogOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
          <div className="mx-4 w-full max-w-2xl rounded-2xl border border-border-muted bg-background shadow-xl">
            <div className="border-b border-border-muted px-5 py-4">
              <h3 className="text-sm font-medium text-text-primary">
                {t("api.planDialogTitle")}
              </h3>
            </div>
            <div className="space-y-3 px-5 py-4">
              <CodingSubscriptionCards
                profiles={appConfig?.providers || {}}
                onSave={handleSubscriptionSave}
                onDelete={handleSubscriptionDelete}
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setPlanDialogOpen(false)}
                  className="rounded-lg border border-border-muted px-4 py-2 text-sm text-text-secondary hover:bg-surface-hover hover:text-text-primary"
                >
                  {t("api.done")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {editorOpen && draft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 max-h-[88vh] w-full max-w-[900px] overflow-hidden rounded-2xl border border-border-muted bg-background">
            <div className="flex items-center justify-between border-b border-border-muted px-5 py-4">
              <h3 className="text-sm font-medium text-text-primary">
                {isCreating ? t("api.addApi") : t("api.editApi")}
              </h3>
              <button
                type="button"
                onClick={closeEditor}
                className="rounded-lg p-2 hover:bg-surface-hover"
              >
                <X className="h-4 w-4 text-text-secondary" />
              </button>
            </div>
            <div className="max-h-[calc(88vh-64px)] overflow-y-auto p-5">
              <div className="space-y-5">
                <div className="space-y-3 border-b border-border-muted py-5">
                  <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
                    <Server className="h-4 w-4" />
                    {t("api.provider")}
                  </label>
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-4">
                    {PROVIDER_ORDER.map((provider) => (
                      <button
                        key={provider}
                        type="button"
                        onClick={() => selectProvider(provider)}
                        className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                          draft.provider === provider
                            ? "border-accent bg-accent/10 font-medium text-accent"
                            : "border-border-muted text-text-secondary hover:border-border hover:text-text-primary"
                        }`}
                      >
                        <ProviderBrandIcon
                          brand={provider}
                          className="h-4 w-4 flex-shrink-0"
                        />
                        {providerOptionLabel(provider, presets, t)}
                      </button>
                    ))}
                  </div>
                </div>

                {(draft.provider === "opencode" ||
                  draft.provider === "opencode-go") && (
                  <div className="space-y-3 border-b border-border-muted py-5">
                    <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
                      <Globe2 className="h-4 w-4" />
                      {t("api.opencodePlan")}
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {OPENCODE_PLANS.map((plan) => (
                        <button
                          key={plan.id}
                          type="button"
                          onClick={() => selectProvider(plan.provider)}
                          className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                            draft.provider === plan.provider
                              ? "border-accent bg-accent/10 font-medium text-accent"
                              : "border-border-muted text-text-secondary hover:border-border hover:text-text-primary"
                          }`}
                        >
                          {t(plan.labelKey)}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-text-muted">
                      {t("api.opencodePlanHint")}
                    </p>
                  </div>
                )}

                {isCustomDraft && (
                  <div className="space-y-3 border-b border-border-muted py-5">
                    <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
                      <Server className="h-4 w-4" />
                      {t("api.protocol")}
                    </label>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      {(["anthropic", "openai", "gemini"] as const).map(
                        (protocol) => (
                          <button
                            key={protocol}
                            type="button"
                            onClick={() => selectCustomProtocol(protocol)}
                            className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                              draft.customProtocol === protocol
                                ? "border-accent bg-accent/10 font-medium text-accent"
                                : "border-border-muted text-text-secondary hover:border-border hover:text-text-primary"
                            }`}
                          >
                            {protocol}
                          </button>
                        ),
                      )}
                    </div>
                  </div>
                )}

                {modelRows.length === 0 && !isCustomDraft && (
                  <div className="space-y-3 border-b border-border-muted py-5">
                    <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
                      <PlugZap className="h-4 w-4" />
                      {t("api.modelsSection")}
                    </label>
                    <p className="text-xs text-text-muted">
                      {t("api.modelsConnectHint")}
                    </p>
                  </div>
                )}

                <div className="space-y-3 border-b border-border-muted py-5">
                  <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
                    <Pencil className="h-4 w-4" />
                    {t("api.customName")}
                  </label>
                  <input
                    type="text"
                    value={draft.name}
                    onChange={(event) =>
                      updateDraft({ name: event.target.value })
                    }
                    placeholder={t("api.customNamePlaceholder")}
                    className="w-full rounded-lg border border-border bg-background px-4 py-3 text-text-primary placeholder-text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
                  />
                </div>

                <div className="space-y-3 border-b border-border-muted py-5">
                  <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
                    <Key className="h-4 w-4" />
                    {t("api.apiKey")}
                  </label>
                  <input
                    type="password"
                    value={draft.apiKey}
                    onChange={(event) =>
                      updateDraft({ apiKey: event.target.value })
                    }
                    placeholder={
                      modelsPresetForDraft(
                        draft.provider,
                        draft.customProtocol,
                        presets,
                      ).keyPlaceholder || t("api.enterApiKey")
                    }
                    className="w-full rounded-lg border border-border bg-background px-4 py-3 text-text-primary placeholder-text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
                  />
                </div>

                {isCustomDraft && (
                  <>
                    <div className="space-y-3 border-b border-border-muted py-5">
                      <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
                        <Server className="h-4 w-4" />
                        {t("api.baseUrl")}
                      </label>
                      <input
                        type="text"
                        value={draft.baseUrl}
                        onChange={(event) =>
                          updateDraft({ baseUrl: event.target.value })
                        }
                        placeholder={
                          modelsPresetForDraft(
                            draft.provider,
                            draft.customProtocol,
                            presets,
                          ).baseUrl
                        }
                        className="w-full rounded-lg border border-border bg-background px-4 py-3 text-text-primary placeholder-text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
                      />
                    </div>

                    <div className="space-y-4 border-b border-border-muted py-5">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-text-primary">
                          {modelRows.length > 0
                            ? t("api.customModelsManual")
                            : t("api.models")}
                        </label>
                        <button
                          type="button"
                          onClick={addModel}
                          className="inline-flex items-center gap-1 rounded-lg border border-border-muted px-2.5 py-1.5 text-xs text-text-secondary hover:bg-surface-hover hover:text-text-primary"
                        >
                          <Plus className="h-3 w-3" />
                          {t("api.addCustomModel")}
                        </button>
                      </div>

                      {draft.models.length === 0 && (
                        <p className="text-xs text-text-muted">
                          {t("api.selectPresetModelsHint")}
                        </p>
                      )}

                      <div className="space-y-2">
                        {draft.models.map((item, index) => (
                          <div
                            key={`model-${index}`}
                            className="flex items-center gap-2"
                          >
                            <input
                              type="text"
                              value={item.id}
                              onChange={(event) =>
                                updateModel(index, {
                                  id: event.target.value,
                                  label: event.target.value,
                                })
                              }
                              placeholder={t("api.modelId")}
                              className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
                            />
                            <input
                              type="number"
                              value={item.contextWindow ?? ""}
                              onChange={(event) =>
                                updateModel(index, {
                                  contextWindow:
                                    event.target.value &&
                                    Number(event.target.value) > 0
                                      ? Math.round(Number(event.target.value))
                                      : undefined,
                                })
                              }
                              placeholder={t("api.contextWindowPlaceholder")}
                              title={t("api.contextWindowHint")}
                              className="w-36 rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                            />
                            <label className="flex items-center gap-1.5 text-sm text-text-secondary flex-shrink-0">
                              <input
                                type="checkbox"
                                checked={item.input?.includes("image") ?? false}
                                onChange={(e) =>
                                  updateModel(index, {
                                    input: e.target.checked
                                      ? ["text", "image"]
                                      : ["text"],
                                  })
                                }
                                className="rounded"
                              />
                              {t("api.supportsImage")}
                            </label>
                            <button
                              type="button"
                              onClick={() => removeModel(index)}
                              className="rounded-lg p-2 text-text-muted hover:bg-error/10 hover:text-error"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                {connectState === "failed" && diagResult && (
                  <div className="border-b border-border-muted py-5">
                    <ApiDiagnosticsPanel
                      result={diagResult}
                      isRunning={false}
                      onRunDiagnostics={handleConnect}
                      showActions={false}
                    />
                  </div>
                )}

                {modelRows.length > 0 && (
                  <div className="space-y-3 border-b border-border-muted py-5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label className="text-sm font-medium text-text-primary">
                        {t("api.modelsSection")}
                      </label>
                      <span className="text-xs text-text-muted">
                        {t("api.modelsEnabledCount", {
                          enabled: modelRows.filter((row) => row.enabled)
                            .length,
                          total: modelRows.length,
                        })}
                      </span>
                    </div>

                    <input
                      type="text"
                      value={modelFilter}
                      onChange={(event) => setModelFilter(event.target.value)}
                      placeholder={t("api.modelsSearch")}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
                    />

                    <div className="max-h-72 space-y-1 overflow-y-auto">
                      {modelRows
                        .filter((row) => {
                          const needle = modelFilter.trim().toLowerCase();
                          if (!needle) return true;
                          return (
                            row.id.toLowerCase().includes(needle) ||
                            row.label.toLowerCase().includes(needle)
                          );
                        })
                        .map((row) => (
                          <div
                            key={row.id}
                            className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-hover"
                          >
                            <input
                              type="checkbox"
                              data-testid={`model-row-${row.id}`}
                              checked={row.enabled}
                              onChange={() => toggleModel(row.id)}
                              className="rounded"
                            />
                            <span className="min-w-0 flex-1 truncate text-sm text-text-primary">
                              {row.label}
                              {row.label !== row.id && (
                                <span className="ml-2 text-xs text-text-muted">
                                  {row.id}
                                </span>
                              )}
                            </span>
                            {row.isNew && (
                              <span className="rounded-md border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">
                                {t("api.modelsNew")}
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => setDefaultModelRow(row.id)}
                              disabled={!row.enabled}
                              className={`rounded-md border px-1.5 py-0.5 text-[10px] transition-colors ${
                                row.isDefault
                                  ? "border-accent bg-accent/10 text-accent"
                                  : "border-border-muted text-text-muted hover:border-border hover:text-text-secondary"
                              } disabled:opacity-40`}
                            >
                              {t("api.modelsDefault")}
                            </button>
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                {error && (
                  <div className="flex items-center gap-2 rounded-lg bg-error/10 px-4 py-3 text-sm text-error">
                    <AlertCircle className="h-4 w-4 flex-shrink-0" />
                    {error}
                  </div>
                )}
                {successMessage && (
                  <div className="flex items-center gap-2 rounded-lg bg-success/10 px-4 py-3 text-sm text-success">
                    <CheckCircle className="h-4 w-4 flex-shrink-0" />
                    {successMessage}
                  </div>
                )}

                {connectMessage && (
                  <p
                    className={`text-xs ${
                      connectState === "failed"
                        ? "text-error"
                        : "text-text-secondary"
                    }`}
                  >
                    {connectMessage}
                  </p>
                )}

                <div className="flex items-center justify-end gap-2">
                  {isOpencodeDraft ? (
                    <button
                      type="button"
                      onClick={() => {
                        void handleSave();
                      }}
                      disabled={isSaving}
                      className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-3 font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isSaving ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          {t("common.saving")}
                        </>
                      ) : (
                        <>
                          <CheckCircle className="h-4 w-4" />
                          {t("api.saveSettings")}
                        </>
                      )}
                    </button>
                  ) : connectState === "connected" ? (
                    <>
                      <button
                        type="button"
                        onClick={handleConnect}
                        className="rounded-lg border border-border-muted px-4 py-3 text-sm text-text-secondary hover:bg-surface-hover hover:text-text-primary"
                      >
                        {t("api.reconnect")}
                      </button>
                      <button
                        type="button"
                        onClick={closeEditor}
                        className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-3 font-medium text-accent-foreground hover:bg-accent-hover"
                      >
                        <CheckCircle className="h-4 w-4" />
                        {t("api.done")}
                      </button>
                    </>
                  ) : connectState === "failed" ? (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          void handleSaveDraft();
                        }}
                        className="inline-flex items-center gap-2 rounded-lg border border-border-muted px-4 py-3 text-sm text-text-secondary hover:bg-surface-hover hover:text-text-primary"
                      >
                        {t("common.save")}
                      </button>
                      <button
                        type="button"
                        onClick={handleConnect}
                        className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-3 font-medium text-accent-foreground hover:bg-accent-hover"
                      >
                        {t("api.retryConnect")}
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={closeEditor}
                        className="rounded-lg border border-border-muted px-4 py-3 text-sm text-text-secondary hover:bg-surface-hover hover:text-text-primary"
                      >
                        {t("common.cancel")}
                      </button>
                      <button
                        type="button"
                        onClick={handleConnect}
                        disabled={connectState === "connecting"}
                        className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-3 font-medium text-accent-foreground hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {connectState === "connecting" ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            {t("api.connecting")}
                          </>
                        ) : (
                          <>
                            <PlugZap className="h-4 w-4" />
                            {t("api.connect")}
                          </>
                        )}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
