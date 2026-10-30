import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  getLocalGatewayPreset,
  type LocalGatewayId,
  type LocalGatewayPreset,
  type LocalGatewayProbeState,
} from "../../../shared/local-gateways";
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
import { isFreeModel } from "../../utils/free-model";
import {
  SettingsCard,
  SettingsContentSection,
  SettingsFormSelect,
  SettingsRow,
  SettingsSection,
  SettingsSwitch,
} from "./shared";
import { CodingSubscriptionCards } from "./coding-subscription-cards";
import { OAUTH_PROVIDERS } from "./provider-catalog";
import { ConfiguredProviderList } from "./configured-provider-list";
import { ProviderCatalogGrid } from "./provider-catalog-grid";
import { Input } from "../ui/input";
import { Button } from "../app-button";
import { DialogClose, DialogContent, DialogTitle } from "../ui/dialog";
import {
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { OccludingAlertDialog, OccludingDialog } from "../ui/occluding-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";

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
  /** 本机网关预设；目前只有 magpie */
  localGateway?: LocalGatewayId;
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

/** OpenCode 计划：Zen（按量付费）与 Go / Go Plus（订阅，含用量限额，Go Plus 额度更高），同一账号同一 API Key */
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

function createLocalGatewayDraft(preset: LocalGatewayPreset): ProviderDraft {
  return {
    profileKey: `custom:${crypto.randomUUID()}`,
    provider: "custom",
    customProtocol: preset.protocol,
    name: preset.name,
    apiKey: preset.defaultApiKey,
    baseUrl: preset.baseUrl,
    defaultModel: "",
    localGateway: preset.id,
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
    localGateway: config.localGateway,
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
    const keepsContextWindow =
      item.source === "custom" || item.contextWindowPinned === true;
    const keepsInput = item.source === "custom" || item.inputPinned === true;
    const contextWindow =
      keepsContextWindow &&
      typeof item.contextWindow === "number" &&
      item.contextWindow > 0
        ? Math.round(item.contextWindow)
        : undefined;
    const input =
      keepsInput && Array.isArray(item.input) && item.input.length > 0
        ? item.input
        : undefined;
    deduped.set(id, {
      id,
      label: item.label.trim() || id,
      source: item.source,
      contextWindow,
      maxTokens:
        keepsContextWindow &&
        typeof item.maxTokens === "number" &&
        item.maxTokens > 0
          ? Math.round(item.maxTokens)
          : undefined,
      input,
      ...(contextWindow && item.contextWindowPinned
        ? { contextWindowPinned: true }
        : {}),
      ...(input && item.inputPinned ? { inputPinned: true } : {}),
    });
  }
  const models = Array.from(deduped.values());
  return {
    ...draft,
    name: draft.name.trim(),
    apiKey: draft.apiKey.trim(),
    baseUrl: draft.baseUrl.trim(),
    // 保留用户选的默认模型；它已被删掉时才退回首行（以前无条件写成首行，
    // 「保存」会静默把默认模型改掉）。
    defaultModel: models.some((model) => model.id === draft.defaultModel)
      ? draft.defaultModel
      : models[0]?.id || "",
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

/**
 * Occluding 弹窗的回焦配方：打开时记住来源，关闭时还原（API 编辑外壳同款配方）。
 *
 * 必须是 per-dialog 的：叠层时若两层共用一份 returnFocusRef，打开顶层会覆写
 * 底层记住的 opener，关闭底层时目标已卸载 → 丢掉原 opener。五个弹窗各调一次。
 * rootRef 在还原失败（目标卸载 / disabled / focus 不生效）时兜底。
 */
function useReturnFocus(root: { readonly current: HTMLElement | null }): {
  returnFocusRef: { readonly current: HTMLElement | null };
  focusHandlers: {
    onOpenAutoFocus: () => void;
    onCloseAutoFocus: (event: Event) => void;
  };
} {
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const focusHandlers = useMemo(
    () => ({
      onOpenAutoFocus: () => {
        const active = document.activeElement;
        returnFocusRef.current =
          active instanceof HTMLElement && active !== document.body
            ? active
            : null;
      },
      onCloseAutoFocus: (event: Event) => {
        event.preventDefault();
        const target = returnFocusRef.current;
        if (target?.isConnected && !target.matches(":disabled")) {
          target.focus({ preventScroll: true });
          if (document.activeElement !== target) {
            root.current?.focus({ preventScroll: true });
          }
        } else {
          root.current?.focus({ preventScroll: true });
        }
      },
    }),
    [root],
  );
  return { returnFocusRef, focusHandlers };
}

/**
 * 页签条的皮肤（原手绘 Button 的等效类：ghost 底 + 下划线选中态）。
 * ui/tabs.tsx 只给结构与焦点环，选中/未选中样式由调用点用 `data-[state=*]` 表达 ——
 * 这样页签的视觉仍由本文件掌握，不再靠 `activeTab === x` 拼条件类。
 */
// 页签皮肤由 ui/tabs.tsx（shadcn 默认）提供，调用点只补图标与文字的间距 ——
// 不再手写 border-b-2 / data-[state=active]:border-primary 那套下划线指示条。
const TAB_TRIGGER_CLASS = "gap-1.5";

export function SettingsAPI({
  embedded = false,
  onSaved,
}: SettingsAPIProps = {}) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement | null>(null);
  // 五个弹窗各自一份回焦状态：共用一份会在叠层时覆写 opener（Task 3 review）。
  const visionDialogReturnFocus = useReturnFocus(rootRef);
  const oauthDisconnectReturnFocus = useReturnFocus(rootRef);
  const deleteDialogReturnFocus = useReturnFocus(rootRef);
  const planDialogReturnFocus = useReturnFocus(rootRef);
  const editorDialogReturnFocus = useReturnFocus(rootRef);
  const setAppConfig = useAppStore((state) => state.setAppConfig);
  const setIsConfigured = useAppStore((state) => state.setIsConfigured);
  const [presets, setPresets] = useState<ProviderPresets>(
    FALLBACK_PROVIDER_PRESETS,
  );
  const [appConfig, setLocalConfig] = useState(
    useAppStore.getState().appConfig,
  );
  const [isLoadingConfig, setIsLoadingConfig] = useState(true);

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

  /**
   * 连接/刷新请求的序号。每次打开弹窗、切换计划或关闭弹窗都自增，
   * 在途请求回来时序号已变就丢弃结果 —— 否则静默刷新会把旧计划的
   * 模型列表写进刚切到的计划（或被关掉的弹窗）。
   */
  const connectRequestRef = useRef(0);
  /**
   * 本弹窗内已经成功落过盘的 profileKey。
   * 行编辑只在「已落盘」后才即时写回：新开的自定义供应商还没填 Key/Base URL，
   * 不能让手填一个模型 ID 就凭空多出一个供应商条目。不查 appConfig 是因为
   * 「连接」刚写回时 config 可能还没同步到 store（保存返回的配置以它为准）。
   */
  const persistedProfilesRef = useRef<Set<string>>(new Set());
  const startConnectRequest = () => {
    connectRequestRef.current += 1;
    return connectRequestRef.current;
  };

  const closeEditor = () => {
    startConnectRequest();
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
  const [localGatewayStatus, setLocalGatewayStatus] = useState<
    Partial<Record<LocalGatewayId, LocalGatewayProbeState>>
  >({});
  const localGatewayOpeningRef = useRef(false);

  const runLocalGatewayProbe = useCallback(
    async (
      id: LocalGatewayId,
      input: { baseUrl?: string; apiKey?: string },
    ) => {
      if (!window.electronAPI?.config.probeLocalGateway) return undefined;
      setLocalGatewayStatus((prev) => ({
        ...prev,
        [id]: { state: "probing" },
      }));
      try {
        const result = await window.electronAPI.config.probeLocalGateway(input);
        setLocalGatewayStatus((prev) => ({
          ...prev,
          [id]: result.available
            ? { state: "available", modelCount: result.modelCount }
            : { state: "unavailable" },
        }));
        return result;
      } catch {
        setLocalGatewayStatus((prev) => ({
          ...prev,
          [id]: { state: "unavailable" },
        }));
        return undefined;
      }
    },
    [],
  );

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
      const existingLocalGatewayKey = Object.keys(nextConfig.providers ?? {})
        .filter((key) => nextConfig.providers?.[key]?.localGateway === "magpie")
        .sort()[0];
      const existingLocalGateway = existingLocalGatewayKey
        ? nextConfig.providers[existingLocalGatewayKey]
        : undefined;
      void runLocalGatewayProbe("magpie", {
        baseUrl: existingLocalGateway?.baseUrl,
        apiKey: existingLocalGateway?.apiKey,
      });
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
  }, [setAppConfig, setIsConfigured, runLocalGatewayProbe]);

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

  const configuredLocalGateways = useMemo(() => {
    const ids = new Set<LocalGatewayId>();
    for (const [key, config] of Object.entries(appConfig?.providers ?? {})) {
      if (!config?.localGateway) continue;
      if (hasUsableCredentials(key as ProviderProfileKey, config)) {
        ids.add(config.localGateway);
      }
    }
    return ids;
  }, [appConfig]);

  const isCreating = originalProfileKey === null;
  const isCustomDraft = draft?.provider === "custom";
  const modelFilterNeedle = modelFilter.trim().toLowerCase();
  // 保留原始下标：行编辑按 index 定位（手工行的 id 可以是空串，不能用 id 做 key）
  const visibleModelRows = modelRows
    .map((row, index) => ({ row, index }))
    .filter(
      ({ row }) =>
        !modelFilterNeedle ||
        row.id.toLowerCase().includes(modelFilterNeedle) ||
        row.label.toLowerCase().includes(modelFilterNeedle),
    );
  const localGatewayPreset = draft?.localGateway
    ? getLocalGatewayPreset(draft.localGateway)
    : undefined;

  const openCreate = (provider: ProviderType = "openrouter") => {
    startConnectRequest();
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
    startConnectRequest();
    setOriginalProfileKey(profileKey);
    const nextDraft = createDraftFromProvider(profileKey, provider, presets);
    setDraft(nextDraft);
    setError("");
    setSuccessMessage("");
    resetConnectState();
    setEditorOpen(true);

    // 先把本地已有列表显示出来（断网也能看到当前启用集）
    setModelRows(
      provider.models.map((model) => ({
        id: model.id,
        label: model.label,
        isNew: false,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        input: model.input,
        contextWindowPinned: model.contextWindowPinned,
        inputPinned: model.inputPinned,
        enabled: !(provider.disabledModels ?? []).includes(model.id),
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
          ...(sanitized.localGateway
            ? { localGateway: sanitized.localGateway }
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
      persistedProfilesRef.current.add(sanitized.profileKey);
      setSuccessMessage(t("common.saved"));
      setEditorOpen(false);
      onSaved?.();
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : String(saveError),
      );
    }
  };

  // ── 连接：落盘 → 诊断拉模型 → 合并 → 写回 ──

  /** 目录（预设供应商才有；自定义与 oauth 传空数组） */
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
      ...(sanitized.localGateway
        ? { localGateway: sanitized.localGateway }
        : {}),
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
      persistedProfilesRef.current.add(sanitized.profileKey);
      return true;
    } catch (saveError) {
      setConnectMessage(
        saveError instanceof Error ? saveError.message : String(saveError),
      );
      return false;
    }
  };

  /** 勾选行 → 持久化模型（保留端点提供的元数据与用户的钉住标记） */
  const rowsToModels = (
    rows: ProviderModelRow[],
    source: ApiProviderModel["source"],
  ): ApiProviderModel[] =>
    rows.map((row) => {
      const hasContextWindow =
        typeof row.contextWindow === "number" && row.contextWindow > 0;
      const hasInput = Array.isArray(row.input) && row.input.length > 0;
      return {
        id: row.id,
        label: row.label,
        source,
        ...(hasContextWindow
          ? { contextWindow: Math.round(row.contextWindow as number) }
          : {}),
        ...(hasContextWindow && row.contextWindowPinned
          ? { contextWindowPinned: true }
          : {}),
        ...(typeof row.maxTokens === "number" && row.maxTokens > 0
          ? { maxTokens: Math.round(row.maxTokens) }
          : {}),
        ...(hasInput ? { input: row.input } : {}),
        ...(hasInput && row.inputPinned ? { inputPinned: true } : {}),
      };
    });

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
    const requestId = startConnectRequest();
    const isStale = () => connectRequestRef.current !== requestId;
    const sanitized = sanitizeDraft(draftValue, presets);
    const isCustom = sanitized.provider === "custom";
    // 从配置里判定是否已落过盘（不能读 originalProfileKey：openEdit 会
    // 同步调它，那时 state 还是上一轮的值）
    const alreadySaved = Boolean(appConfig?.providers?.[sanitized.profileKey]);

    const fail = (message?: string) => {
      if (isStale()) return;
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
      const savedFirst = await persistModels(
        sanitized,
        [],
        sanitized.defaultModel,
        sanitized.disabledModels ?? [],
      );
      if (isStale()) return;
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

    if (isStale()) return;
    setDiagResult(result);

    if (result.skippedReason) {
      fail(t("api.modelsBusy"));
      return;
    }
    if (!result.overallOk) {
      fail(
        Boolean(draftValue.localGateway) && result.failedAt === "auth"
          ? t("api.localGatewayAuthFailed")
          : undefined,
      );
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
      fail(
        draftValue.localGateway && live
          ? t("api.localGatewayNoModels")
          : t("api.modelsManualHint"),
      );
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

  const openLocalGateway = async (id: LocalGatewayId) => {
    // 双击瓦片会在弹窗挂载前触发两次 click；第二次直接丢弃，避免并发探测与
    // 「正在检测中」的误导提示。
    if (localGatewayOpeningRef.current) return;
    localGatewayOpeningRef.current = true;
    try {
      const preset = getLocalGatewayPreset(id);
      if (!preset) return;

      const existingKey = Object.keys(appConfig?.providers ?? {})
        .filter((key) => appConfig?.providers?.[key]?.localGateway === id)
        .sort()[0];
      if (existingKey) {
        openEdit(existingKey as ProviderProfileKey);
        const existing = appConfig?.providers?.[existingKey];
        void runLocalGatewayProbe(id, {
          baseUrl: existing?.baseUrl,
          apiKey: existing?.apiKey,
        });
        return;
      }

      const nextDraft = createLocalGatewayDraft(preset);
      startConnectRequest();
      setOriginalProfileKey(null);
      setDraft(nextDraft);
      setModelRows([]);
      setError("");
      setSuccessMessage("");
      resetConnectState();
      setEditorOpen(true);

      const probe = await runLocalGatewayProbe(id, {
        baseUrl: nextDraft.baseUrl,
        apiKey: nextDraft.apiKey,
      });
      if (probe?.available) {
        await runConnect(nextDraft);
      }
    } finally {
      localGatewayOpeningRef.current = false;
    }
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
    const enabled = rows.filter((row) => row.enabled && row.id.trim());
    if (enabled.length === 0) return false;
    const sanitized = sanitizeDraft(draft, presets);
    const ok = await persistModels(
      sanitized,
      rowsToModels(enabled, isCustomDraft ? "custom" : "preset"),
      defaultModel,
      disabled,
    );
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

  /**
   * 行的唯一写入口：同时更新 modelRows / draft.models / disabledModels，再按需落盘。
   *
   * 以前带选框的列表和手工编辑器各存一份模型（modelRows 与 draft.models），
   * 在手工栏里改了上下文、随后再点一次勾选，`persistCurrentModels` 会用
   * modelRows 的旧值把改动写回去 —— 用户填的数值就这样静默丢了。
   */
  const commitRows = (
    nextRows: ProviderModelRow[],
    options: { persist?: boolean } = {},
  ): void => {
    const enabledRows = nextRows.filter((row) => row.enabled && row.id.trim());
    const defaultModel =
      enabledRows.find((row) => row.isDefault)?.id ?? enabledRows[0]?.id ?? "";
    const normalized = nextRows.map((row) => ({
      ...row,
      isDefault: row.id === defaultModel && Boolean(row.id),
    }));
    const disabled = normalized
      .filter((row) => !row.enabled && row.id.trim())
      .map((row) => row.id);
    const snapshot = { rows: modelRows, draft };
    setModelRows(normalized);
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            defaultModel,
            disabledModels: disabled,
            models: rowsToModels(
              enabledRows,
              prev.provider === "custom" ? "custom" : "preset",
            ),
          }
        : prev,
    );
    if (options.persist === false || enabledRows.length === 0) return;
    // 还没落过盘的新配置不在这里写：manual 行属于草稿，等「连接」或「保存」再去落盘，
    // 否则刚填一个模型 ID 就会凭空多出一个供应商条目。
    const savedOnce =
      Boolean(draft) &&
      (persistedProfilesRef.current.has(draft!.profileKey) ||
        Boolean(appConfig?.providers?.[draft!.profileKey]));
    if (!savedOnce) return;
    void persistCurrentModels(normalized, defaultModel, disabled).then((ok) => {
      if (!ok) restoreSnapshot(snapshot);
    });
  };

  /** 只改本地行（输入过程中的每个字符），落盘交给 commitRow */
  const patchRow = (index: number, patch: Partial<ProviderModelRow>) => {
    setModelRows((prev) =>
      prev.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...patch } : row,
      ),
    );
  };

  const commitRow = (index: number) => {
    const row = modelRows[index];
    if (!row) return;
    commitRows(modelRows);
  };

  const addModelRow = () => {
    setModelRows((prev) => [
      ...prev,
      {
        id: "",
        label: "",
        isNew: true,
        enabled: true,
        isDefault: false,
        manual: true,
      },
    ]);
  };

  const removeModelRow = (index: number) => {
    commitRows(modelRows.filter((_, rowIndex) => rowIndex !== index));
  };

  const toggleModel = (index: number) => {
    const target = modelRows[index];
    if (!target) return;
    const enabledNow = modelRows.filter(
      (row) => row.enabled && row.id.trim(),
    ).length;
    if (target.enabled && enabledNow <= 1) {
      setConnectMessage(t("api.atLeastOneModel"));
      return;
    }
    setConnectMessage("");
    commitRows(
      modelRows.map((row, rowIndex) =>
        rowIndex === index ? { ...row, enabled: !row.enabled } : row,
      ),
    );
  };

  const setDefaultModelRow = (id: string) => {
    if (!modelRows.some((row) => row.id === id && row.enabled)) return;
    commitRows(modelRows.map((row) => ({ ...row, isDefault: row.id === id })));
  };

  /** 图片能力：改完立即落盘（与勾选一致），并钉住，避免端点元数据把它改回去 */
  const toggleRowImage = (index: number) => {
    const row = modelRows[index];
    if (!row) return;
    const supportsImage = row.input?.includes("image") ?? false;
    commitRows(
      modelRows.map((current, rowIndex) =>
        rowIndex === index
          ? {
              ...current,
              input: supportsImage ? ["text"] : ["text", "image"],
              inputPinned: true,
            }
          : current,
      ),
    );
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
    startConnectRequest();
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
    // 改连接参数后「已连接」不再成立：否则底部只剩「重新连接 / 完成」，
    // 「完成」会把刚改的 Key、名称或端点静默丢掉。
    if ("apiKey" in patch || "name" in patch || "baseUrl" in patch) {
      setConnectState((current) =>
        current === "connected" ? "idle" : current,
      );
    }
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
        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
          DeskWand
        </p>
        <div className="flex items-center gap-2">
          <Loader2 className="h-5 w-5 animate-spin text-primary-text" />
          <span className="text-sm text-muted-foreground">
            {t("common.loading")}
          </span>
        </div>
      </div>
    );
  }

  // 页签切换回调：Radix 只回 string，显式列合法值才算写回（未知值/空串一律忽略，
  // 不用 unchecked cast）—— activeTab 是四个子视图的挂载开关，写错值只会静默渲染空白。
  const handleTabChange = (value: string) => {
    if (
      value === "main" ||
      value === "vision" ||
      value === "search" ||
      value === "utility"
    ) {
      setActiveTab(value);
    }
  };

  return (
    <div ref={rootRef} tabIndex={-1}>
      {/* 受控 Tabs 包住页签条与全部面板。embedded 时不渲染页签条，但内容照常显示：
          旧代码是「embedded ⇒ 恒显示 main 面板」，所以这里把值也钉到 main，
          而不是让嵌人态跟着残留的 activeTab 走。 */}
      <Tabs
        value={embedded ? "main" : activeTab}
        activationMode="manual"
        onValueChange={handleTabChange}
      >
        {!embedded && (
          <TabsList className="flex-none self-start">
            {/* Radix 的 TabsTrigger 只在 mousedown 上激活；这里补一条 onClick，
                让不带 mousedown 的合成 click（程序化 .click() 与既有用例）也能切换。
                真实浏览器里 mousedown 先切同一个值，重复写 state 会被 React 拒收。 */}
            <TabsTrigger
              value="main"
              className={TAB_TRIGGER_CLASS}
              onClick={() => handleTabChange("main")}
            >
              <Bot className="h-3.5 w-3.5" />
              {t("api.mainModelTab")}
            </TabsTrigger>
            <TabsTrigger
              value="vision"
              className={TAB_TRIGGER_CLASS}
              onClick={() => handleTabChange("vision")}
            >
              <Eye className="h-3.5 w-3.5" />
              {t("api.visionModelTab")}
            </TabsTrigger>
            <TabsTrigger
              value="search"
              className={TAB_TRIGGER_CLASS}
              onClick={() => handleTabChange("search")}
            >
              <Globe2 className="h-3.5 w-3.5" />
              {t("api.searchModelTab")}
            </TabsTrigger>
            <TabsTrigger
              value="utility"
              className={TAB_TRIGGER_CLASS}
              onClick={() => handleTabChange("utility")}
            >
              <Zap className="h-3.5 w-3.5" />
              {t("api.utilityModelTab")}
            </TabsTrigger>
          </TabsList>
        )}

        {/* 面板内容仍按原值条件渲染：Radix 把非当前值面板留在 DOM 里（hidden 空壳），
            不补这层守卫的话四个子视图会同时挂载并各自拉数据 —— 迁移前是切到才挂载。
            面板壳保留，只为 a11y（role=tabpanel + aria 关联）；非当前值面板不保留状态。 */}
        <TabsContent value="main" className="max-w-[1080px] space-y-5">
          {(activeTab === "main" || embedded) && (
            <>
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
                <Button
                  variant="ghost"
                  type="button"
                  onClick={() => openCreate()}
                  className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 h-auto"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t("api.addApi")}
                </Button>
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
                  configuredLocalGateways={configuredLocalGateways}
                  localGatewayStatus={localGatewayStatus}
                  onOpenLocalGateway={(id) => void openLocalGateway(id)}
                />
              </SettingsSection>
            </>
          )}
        </TabsContent>

        {/* 面板内容仍按原值条件渲染：Radix 把非当前值面板留在 DOM 里（hidden 空壳），
            不补这层守卫的话四个子视图会同时挂载并各自拉数据 —— 迁移前是切到才挂载。
            面板壳保留，只为 a11y（role=tabpanel + aria 关联）；非当前值面板不保留状态。 */}
        <TabsContent value="vision" className="max-w-[720px] space-y-5">
          {activeTab === "vision" && !embedded && (
            <>
              {!isVisionConfigured ? (
                /* ── Empty state ── */
                <div className="rounded-2xl border border-dashed border-border/60 px-6 py-10 text-center">
                  <div className="text-3xl mb-3">🔮</div>
                  <h3 className="text-sm font-medium text-foreground">
                    {t("api.visionModelNotConfigured")}
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground max-w-xs mx-auto">
                    {t("api.visionModelNotConfiguredDesc")}
                  </p>
                  <Button
                    variant="ghost"
                    type="button"
                    onClick={openVisionEditor}
                    className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 h-auto"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {t("api.visionModelConfigureButton")}
                  </Button>
                </div>
              ) : (
                /* ── Configured card ── */
                <div
                  className={`rounded-2xl border border-border/60 bg-background px-4 py-3 shadow-card ${
                    !visionDraft.enabled ? "opacity-60" : ""
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground">
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
                      <p className="mt-1 truncate text-xs text-muted-foreground">
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
                      <Button
                        variant="ghost"
                        type="button"
                        onClick={openVisionEditor}
                        className="inline-flex items-center gap-1 rounded-lg border border-border/60 px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-hover-surface hover:text-foreground h-auto"
                      >
                        <Pencil className="h-3 w-3" />
                        {t("api.editApi")}
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </TabsContent>

        {/* ── Search tab ── */}
        {/* 面板内容仍按原值条件渲染：Radix 把非当前值面板留在 DOM 里（hidden 空壳），
            不补这层守卫的话四个子视图会同时挂载并各自拉数据 —— 迁移前是切到才挂载。
            面板壳保留，只为 a11y（role=tabpanel + aria 关联）；非当前值面板不保留状态。 */}
        <TabsContent value="search" className="max-w-[720px] space-y-5">
          {activeTab === "search" && !embedded && searchDraft && (
            <SettingsContentSection
              title={t("webAccess.groupTitle")}
              description={t("webAccess.groupDescription")}
            >
              <fieldset
                disabled={isSearchSaving}
                className="m-0 min-w-0 space-y-3 border-0 p-0"
              >
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">
                    {t("webAccess.defaultProvider")}
                  </span>
                  <SettingsFormSelect
                    value={searchDraft.defaultProvider}
                    onChange={(next) => {
                      setSearchDraft({
                        ...searchDraft,
                        defaultProvider: next,
                      });
                      setSearchMessage(null);
                    }}
                    label={t("webAccess.defaultProvider")}
                    testId="web-access-default-provider"
                    options={WEB_SEARCH_PROVIDERS.map((provider) => ({
                      value: provider,
                      label: t(`webAccess.providers.${provider}`),
                    }))}
                  />
                </label>

                {(["openai", "gemini", "deepseek"] as const).map((provider) => {
                  const credential = searchDraft[provider];
                  const isOpen = searchExpanded === provider;
                  return (
                    <div
                      key={provider}
                      className="rounded-xl border border-border/60"
                    >
                      <Button
                        variant="ghost"
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
                        <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                          <ProviderBrandIcon
                            brand={provider}
                            className="h-4 w-4 flex-shrink-0"
                          />
                          {t(`webAccess.providers.${provider}`)}
                        </span>
                        {isOpen ? (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        )}
                      </Button>
                      {isOpen && (
                        <div
                          id={`web-access-${provider}-settings`}
                          className="space-y-3 border-t border-border/60 px-4 py-3"
                        >
                          <label className="block space-y-1">
                            <span className="text-xs text-muted-foreground">
                              {t("webAccess.credentialSource")}
                            </span>
                            <SettingsFormSelect
                              value={credential.source}
                              onChange={(next) => {
                                setSearchDraft((c) =>
                                  c
                                    ? {
                                        ...c,
                                        [provider]: {
                                          ...c[provider],
                                          source: next as
                                            | "inherit"
                                            | "dedicated",
                                        },
                                      }
                                    : c,
                                );
                                setSearchMessage(null);
                              }}
                              label={t("webAccess.credentialSource")}
                              testId={`web-access-${provider}-source`}
                              options={[
                                {
                                  value: "inherit",
                                  label: t("webAccess.inherit"),
                                },
                                {
                                  value: "dedicated",
                                  label: t("webAccess.dedicated"),
                                },
                              ]}
                            />
                          </label>
                          {credential.source === "inherit" ? (
                            <label className="block space-y-1">
                              <span className="text-xs text-muted-foreground">
                                {t("webAccess.profile")}
                              </span>
                              <SettingsFormSelect
                                value={credential.profileKey}
                                onChange={(next) => {
                                  setSearchDraft((c) =>
                                    c
                                      ? {
                                          ...c,
                                          [provider]: {
                                            ...c[provider],
                                            profileKey: next,
                                          },
                                        }
                                      : c,
                                  );
                                }}
                                label={t("webAccess.profile")}
                                testId={`web-access-${provider}-profile`}
                                options={[
                                  {
                                    value: "",
                                    label: t("webAccess.unavailable"),
                                  },
                                  ...searchMatchingProfiles(
                                    appConfig ||
                                      ({ providers: {} } as AppConfig),
                                    provider,
                                  ).map((profile) => ({
                                    value: profile.key,
                                    label:
                                      resolveProviderDisplayName(
                                        profile.key,
                                        profile.name,
                                        t,
                                      ) || profile.key,
                                  })),
                                ]}
                              />
                            </label>
                          ) : (
                            <>
                              <label className="block space-y-1">
                                <span className="text-xs text-muted-foreground">
                                  {t("webAccess.apiKey")}
                                </span>
                                <Input
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
                                  className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm h-auto shadow-none"
                                />
                              </label>
                              <label className="block space-y-1">
                                <span className="text-xs text-muted-foreground">
                                  {t("webAccess.baseUrl")}
                                </span>
                                <Input
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
                                  className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm h-auto shadow-none"
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
                      className="rounded-xl border border-border/60"
                    >
                      <Button
                        variant="ghost"
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
                        <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                          <Search className="h-4 w-4 flex-shrink-0" />
                          {t(`webAccess.providers.${provider}`)}
                        </span>
                        {isOpen ? (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        )}
                      </Button>
                      {isOpen && (
                        <div
                          id={`web-access-${provider}-settings`}
                          className="space-y-2 border-t border-border/60 px-4 py-3"
                        >
                          <label className="block space-y-1">
                            <span className="text-xs text-muted-foreground">
                              {t("webAccess.apiKey")}
                            </span>
                            <Input
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
                              className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm h-auto shadow-none"
                            />
                          </label>
                          {provider === "exa" && (
                            <p className="text-xs text-muted-foreground">
                              {t("webAccess.exaZeroConfig")}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

                <div className="flex items-center gap-3 pt-2">
                  <Button
                    variant="ghost"
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
                        setSearchDraft(
                          searchAddInheritedDefaults(saved.config),
                        );
                        setSearchMessage("saved");
                      } catch {
                        setSearchMessage("error");
                      } finally {
                        setIsSearchSaving(false);
                      }
                    }}
                    disabled={isSearchSaving}
                    className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 h-auto"
                  >
                    {isSearchSaving ? t("common.saving") : t("common.save")}
                  </Button>
                  {searchMessage && (
                    <span
                      className={`text-xs ${searchMessage === "saved" ? "text-success" : "text-destructive"}`}
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
          )}
        </TabsContent>

        {/* ── Utility model tab ── */}
        {/* 面板内容仍按原值条件渲染：Radix 把非当前值面板留在 DOM 里（hidden 空壳），
            不补这层守卫的话四个子视图会同时挂载并各自拉数据 —— 迁移前是切到才挂载。
            面板壳保留，只为 a11y（role=tabpanel + aria 关联）；非当前值面板不保留状态。 */}
        <TabsContent value="utility" className="max-w-[720px] space-y-5">
          {activeTab === "utility" && !embedded && (
            <>
              <SettingsContentSection
                title={t("api.utilityModelTitle")}
                description={t("api.utilityModelDesc")}
              >
                <fieldset
                  disabled={isUtilitySaving}
                  className="m-0 min-w-0 space-y-4 border-0 p-0"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">
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
                        <span className="text-xs font-medium text-muted-foreground">
                          {t("api.utilityProvider")}
                        </span>
                        <SettingsFormSelect
                          value={utilityDraft.providerProfileKey || ""}
                          onChange={(key) => {
                            const profileKey = key || undefined;
                            const profile = profileKey
                              ? appConfig?.providers?.[profileKey]
                              : undefined;
                            setUtilityDraft((prev) => ({
                              ...prev,
                              providerProfileKey: profileKey,
                              model: profile?.defaultModel || "",
                            }));
                            setUtilityMessage(null);
                          }}
                          label={t("api.utilityProvider")}
                          testId="utility-provider"
                          options={[
                            {
                              value: "",
                              label: t("api.utilityProviderPlaceholder"),
                            },
                            ...Object.entries(
                              appConfig?.providers || {},
                            ).flatMap(([key, cfg]) =>
                              cfg
                                ? [
                                    {
                                      value: key,
                                      label:
                                        resolveProviderDisplayName(
                                          key,
                                          cfg.name,
                                          t,
                                        ) || key,
                                    },
                                  ]
                                : [],
                            ),
                          ]}
                        />
                      </label>

                      <label className="block space-y-1.5">
                        <span className="text-xs font-medium text-muted-foreground">
                          {t("api.utilityModel")}
                        </span>
                        <SettingsFormSelect
                          value={utilityDraft.model || ""}
                          onChange={(next) => {
                            setUtilityDraft((prev) => ({
                              ...prev,
                              model: next,
                            }));
                            setUtilityMessage(null);
                          }}
                          label={t("api.utilityModel")}
                          testId="utility-model"
                          options={[
                            {
                              value: "",
                              label: t("api.utilityModelPlaceholder"),
                            },
                            ...(
                              appConfig?.providers?.[
                                utilityDraft.providerProfileKey || ""
                              ]?.models || []
                            ).map((m) => ({
                              value: m.id,
                              label: m.label || m.id,
                            })),
                          ]}
                        />
                      </label>
                    </>
                  )}

                  <Button
                    variant="ghost"
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
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 h-auto"
                  >
                    {t("api.saveUtilityModel")}
                  </Button>
                  {utilityMessage === "saved" && (
                    <p className="text-xs text-success">{t("common.saved")}</p>
                  )}
                  {utilityMessage === "error" && (
                    <p className="text-xs text-destructive">
                      {t("api.saveFailed")}
                    </p>
                  )}
                </fieldset>
              </SettingsContentSection>
            </>
          )}
        </TabsContent>
      </Tabs>

      {/* ── Vision model editor modal ── */}
      {visionEditorOpen && (
        <OccludingDialog
          open={visionEditorOpen}
          onOpenChange={(open) => {
            if (!open) closeVisionEditor();
          }}
        >
          <DialogContent
            className="mx-4 max-h-[88vh] w-full max-w-[560px] gap-0 overflow-hidden rounded-2xl border border-border/60 bg-background p-0 [&>button]:hidden"
            aria-describedby={undefined}
            onInteractOutside={(event) => event.preventDefault()}
            onEscapeKeyDown={(event) => event.preventDefault()}
            {...visionDialogReturnFocus.focusHandlers}
          >
            <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
              <DialogTitle className="text-sm font-medium text-foreground">
                {t("api.visionModelEditTitle")}
              </DialogTitle>
              <DialogClose asChild>
                <Button
                  variant="ghost"
                  type="button"
                  aria-label={t("common.close")}
                  className="rounded-lg p-2 hover:bg-hover-surface h-auto"
                >
                  <X className="h-4 w-4 text-muted-foreground" />
                </Button>
              </DialogClose>
            </div>
            <div className="max-h-[calc(88vh-64px)] overflow-y-auto p-5">
              <div className="space-y-5">
                {/* Enable toggle */}
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground">
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
                <div className="space-y-3 border-b border-border/60 pb-5">
                  <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <Server className="h-4 w-4" />
                    {t("api.provider")}
                  </label>
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                    {VISION_PROVIDER_ORDER.map((provider) => (
                      <Button
                        variant="ghost"
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
                            ? "border-primary bg-primary/10 font-medium text-primary-text"
                            : "border-border/60 text-muted-foreground hover:border-border hover:text-foreground"
                        }`}
                      >
                        <ProviderBrandIcon
                          brand={provider}
                          className="h-4 w-4 flex-shrink-0"
                        />
                        {providerOptionLabel(provider, presets, t)}
                      </Button>
                    ))}
                  </div>
                </div>

                {/* Custom protocol selector */}
                {visionDraft.provider === "custom" && (
                  <div className="space-y-3 border-b border-border/60 pb-5">
                    <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <Server className="h-4 w-4" />
                      {t("api.protocol")}
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {(["anthropic", "openai", "gemini"] as const).map(
                        (protocol) => (
                          <Button
                            variant="ghost"
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
                                ? "border-primary bg-primary/10 font-medium text-primary-text"
                                : "border-border/60 text-muted-foreground hover:border-border hover:text-foreground"
                            }`}
                          >
                            {protocol}
                          </Button>
                        ),
                      )}
                    </div>
                  </div>
                )}

                {/* Zhipu region selector */}
                {visionDraft.provider === "zhipu" && (
                  <div className="space-y-3 border-b border-border/60 pb-5">
                    <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <Globe2 className="h-4 w-4" />
                      {t("api.region")}
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {ZHIPU_REGIONS.map((region) => (
                        <Button
                          variant="ghost"
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
                              ? "border-primary bg-primary/10 font-medium text-primary-text"
                              : "border-border/60 text-muted-foreground hover:border-border hover:text-foreground"
                          }`}
                        >
                          {t(region.labelKey)}
                        </Button>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t("api.zhipuRegionHint")}
                    </p>
                  </div>
                )}

                {/* API Key */}
                <div className="space-y-3 border-b border-border/60 pb-5">
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <Key className="h-4 w-4" />
                      {t("api.apiKey")}
                    </label>
                    {appConfig?.activeProviderKey &&
                      appConfig?.providers?.[appConfig.activeProviderKey]
                        ?.apiKey && (
                        <Button
                          variant="ghost"
                          type="button"
                          size="xs"
                          onClick={reuseActiveProviderApiKey}
                          className="text-xs text-primary-text hover:underline"
                        >
                          {t("api.reuseMainModelKey")}
                        </Button>
                      )}
                  </div>
                  <Input
                    type="password"
                    value={visionDraft.apiKey}
                    onChange={(event) =>
                      setVisionDraft((prev) => ({
                        ...prev,
                        apiKey: event.target.value,
                      }))
                    }
                    placeholder={t("api.enterApiKey")}
                    className="w-full rounded-lg border border-border bg-background px-4 py-3 text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 h-auto shadow-none"
                  />
                </div>

                {/* Base URL (custom provider or Ollama only) */}
                {(visionDraft.provider === "custom" ||
                  visionDraft.provider === "ollama") && (
                  <div className="space-y-3 border-b border-border/60 pb-5">
                    <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <Server className="h-4 w-4" />
                      {t("api.baseUrl")}
                    </label>
                    <Input
                      type="text"
                      value={visionDraft.baseUrl || ""}
                      onChange={(event) =>
                        setVisionDraft((prev) => ({
                          ...prev,
                          baseUrl: event.target.value,
                        }))
                      }
                      placeholder={t("api.enterBaseUrl")}
                      className="w-full rounded-lg border border-border bg-background px-4 py-3 text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 h-auto shadow-none"
                    />
                  </div>
                )}

                {/* Model */}
                <div className="space-y-3 border-b border-border/60 pb-5">
                  <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <Eye className="h-4 w-4" />
                    {t("api.model")}
                  </label>
                  <Input
                    type="text"
                    value={visionDraft.model}
                    onChange={(event) =>
                      setVisionDraft((prev) => ({
                        ...prev,
                        model: event.target.value,
                      }))
                    }
                    placeholder={t("api.visionModelPlaceholder")}
                    className="w-full rounded-lg border border-border bg-background px-4 py-3 text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 h-auto shadow-none"
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
                          <Button
                            variant="ghost"
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
                                ? "border-primary bg-primary/10 text-primary-text"
                                : "border-border/60 text-muted-foreground hover:border-border hover:text-muted-foreground"
                            }`}
                          >
                            {m.name || m.id}
                          </Button>
                        ));
                      })()}
                    </div>
                  )}
                </div>

                {/* Error / Success */}
                {visionError && (
                  <div className="flex items-center gap-2 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
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
                  <Button
                    variant="ghost"
                    type="button"
                    onClick={closeVisionEditor}
                    className="rounded-lg border border-border/60 px-4 py-2.5 text-sm text-muted-foreground hover:bg-hover-surface hover:text-foreground h-auto"
                  >
                    {t("common.cancel")}
                  </Button>
                  <Button
                    variant="ghost"
                    type="button"
                    onClick={() => {
                      void handleVisionSave();
                    }}
                    disabled={isVisionSaving}
                    className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 h-auto"
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
                  </Button>
                </div>
              </div>
            </div>
          </DialogContent>
        </OccludingDialog>
      )}

      {pendingOAuthLogoutProviderId &&
        (() => {
          const pid = pendingOAuthLogoutProviderId;
          const p = OAUTH_PROVIDERS.find((pp) => pp.id === pid);
          return (
            <OccludingAlertDialog
              open
              onOpenChange={(open) => {
                if (!open) closeOAuthDisconnectDialog();
              }}
            >
              <AlertDialogContent
                className="mx-4 w-full max-w-md gap-0 overflow-hidden rounded-2xl border border-border/60 bg-background p-0 shadow-xl"
                // AlertDialog 原语不接受 onInteractOutside：遮罩点击本就不触发关闭。
                onEscapeKeyDown={(event) => event.preventDefault()}
                {...oauthDisconnectReturnFocus.focusHandlers}
              >
                <AlertDialogHeader className="border-b border-border/60 px-5 py-4 text-left">
                  <AlertDialogTitle className="text-sm font-medium text-foreground">
                    {t("api.oauthDisconnect")}
                  </AlertDialogTitle>
                </AlertDialogHeader>
                <div className="space-y-4 px-5 py-4">
                  <AlertDialogDescription className="text-sm text-muted-foreground">
                    {t("api.oauthDisconnectConfirm", {
                      name: p?.name || pid,
                    })}
                  </AlertDialogDescription>
                  <AlertDialogFooter className="flex justify-end gap-2">
                    <AlertDialogCancel
                      onClick={closeOAuthDisconnectDialog}
                      className="rounded-lg border border-border/60 px-4 py-2 text-sm text-muted-foreground hover:bg-hover-surface hover:text-foreground h-auto"
                    >
                      {t("common.cancel")}
                    </AlertDialogCancel>
                    <AlertDialogAction
                      onClick={(event) => {
                        event.preventDefault();
                        void confirmDisconnectOAuth(pid);
                      }}
                      className="rounded-lg bg-destructive px-4 py-2 text-sm font-medium text-white hover:bg-destructive/90 h-auto"
                    >
                      {t("api.oauthDisconnect")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </div>
              </AlertDialogContent>
            </OccludingAlertDialog>
          );
        })()}

      {pendingDeleteProfileKey && (
        <OccludingAlertDialog
          open
          onOpenChange={(open) => {
            if (!open) closeDeleteDialog();
          }}
        >
          <AlertDialogContent
            className="mx-4 w-full max-w-md gap-0 overflow-hidden rounded-2xl border border-border/60 bg-background p-0 shadow-xl"
            // AlertDialog 原语不接受 onInteractOutside：遮罩点击本就不触发关闭。
            onEscapeKeyDown={(event) => event.preventDefault()}
            {...deleteDialogReturnFocus.focusHandlers}
          >
            <AlertDialogHeader className="border-b border-border/60 px-5 py-4 text-left">
              <AlertDialogTitle className="text-sm font-medium text-foreground">
                {t("api.deleteApi")}
              </AlertDialogTitle>
            </AlertDialogHeader>
            <div className="space-y-4 px-5 py-4">
              <AlertDialogDescription className="text-sm text-muted-foreground">
                {t("api.deleteApiConfirm", {
                  name:
                    appConfig?.providers?.[pendingDeleteProfileKey]?.name ||
                    providerLabel(pendingDeleteProfileKey, presets, t),
                })}
              </AlertDialogDescription>
              <AlertDialogFooter className="flex justify-end gap-2">
                <AlertDialogCancel
                  onClick={closeDeleteDialog}
                  disabled={isDeleting}
                  className="rounded-lg border border-border/60 px-4 py-2 text-sm text-muted-foreground hover:bg-hover-surface hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 h-auto"
                >
                  {t("common.cancel")}
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={(event) => {
                    event.preventDefault();
                    void confirmDelete();
                  }}
                  disabled={isDeleting}
                  className="inline-flex items-center gap-2 rounded-lg bg-destructive px-4 py-2 text-sm font-medium text-white hover:bg-destructive/90 disabled:cursor-not-allowed disabled:opacity-50 h-auto"
                >
                  {isDeleting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                  {t("api.deleteApi")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </div>
          </AlertDialogContent>
        </OccludingAlertDialog>
      )}

      {planDialogOpen && (
        <OccludingDialog
          open={planDialogOpen}
          onOpenChange={(open) => {
            if (!open) setPlanDialogOpen(false);
          }}
        >
          <DialogContent
            className="mx-4 w-full max-w-2xl gap-0 overflow-hidden rounded-2xl border border-border/60 bg-background p-0 [&>button]:hidden"
            aria-describedby={undefined}
            onInteractOutside={(event) => event.preventDefault()}
            onEscapeKeyDown={(event) => event.preventDefault()}
            {...planDialogReturnFocus.focusHandlers}
          >
            <div className="border-b border-border/60 px-5 py-4">
              <DialogTitle className="text-sm font-medium text-foreground">
                {t("api.planDialogTitle")}
              </DialogTitle>
            </div>
            <div className="space-y-3 px-5 py-4">
              <CodingSubscriptionCards
                profiles={appConfig?.providers || {}}
                onSave={handleSubscriptionSave}
                onDelete={handleSubscriptionDelete}
              />
              <div className="flex justify-end">
                <Button
                  variant="ghost"
                  type="button"
                  onClick={() => setPlanDialogOpen(false)}
                  className="rounded-lg border border-border/60 px-4 py-2 text-sm text-muted-foreground hover:bg-hover-surface hover:text-foreground h-auto"
                >
                  {t("api.done")}
                </Button>
              </div>
            </div>
          </DialogContent>
        </OccludingDialog>
      )}

      {draft && (
        <OccludingDialog
          open={editorOpen && !!draft}
          onOpenChange={(open) => {
            if (!open) closeEditor();
          }}
        >
          <DialogContent
            className="mx-4 max-h-[88vh] w-full max-w-[900px] overflow-hidden rounded-2xl border border-border/60 bg-background p-0 gap-0 [&>button]:hidden"
            aria-describedby={undefined}
            onInteractOutside={(event) => event.preventDefault()}
            onEscapeKeyDown={(event) => event.preventDefault()}
            {...editorDialogReturnFocus.focusHandlers}
          >
            <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
              <DialogTitle className="text-sm font-medium text-foreground">
                {localGatewayPreset?.name ??
                  (isCreating ? t("api.addApi") : t("api.editApi"))}
              </DialogTitle>
              <DialogClose asChild>
                <Button
                  variant="ghost"
                  type="button"
                  aria-label={t("common.close")}
                  className="rounded-lg p-2 hover:bg-hover-surface h-auto"
                >
                  <X className="h-4 w-4 text-muted-foreground" />
                </Button>
              </DialogClose>
            </div>
            <div className="max-h-[calc(88vh-64px)] overflow-y-auto p-5">
              <div className="space-y-5">
                {localGatewayPreset && (
                  <div className="space-y-2 border-b border-border/60 py-5">
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <Server className="h-4 w-4" />
                      {localGatewayPreset.name}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t(localGatewayPreset.keyHintKey)}
                    </p>
                    {localGatewayStatus[localGatewayPreset.id]?.state ===
                      "unavailable" && (
                      <p className="text-xs text-destructive">
                        {t("api.localGatewayUnavailableHint")}
                      </p>
                    )}
                    <Button
                      variant="ghost"
                      type="button"
                      onClick={() =>
                        void window.electronAPI?.openExternal(
                          localGatewayPreset.docsUrl,
                        )
                      }
                      className="h-auto px-0 text-xs text-primary-text underline underline-offset-2"
                    >
                      {t("api.localGatewayDocs")}
                    </Button>
                  </div>
                )}

                {/* 本机网关草稿锁定供应商；协议随 /v1 固定为 OpenAI。 */}
                {!draft.localGateway && (
                  <div className="space-y-3 border-b border-border/60 py-5">
                    <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <Server className="h-4 w-4" />
                      {t("api.provider")}
                    </label>
                    <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-4">
                      {PROVIDER_ORDER.map((provider) => (
                        <Button
                          variant="ghost"
                          key={provider}
                          type="button"
                          onClick={() => selectProvider(provider)}
                          className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                            draft.provider === provider
                              ? "border-primary bg-primary/10 font-medium text-primary-text"
                              : "border-border/60 text-muted-foreground hover:border-border hover:text-foreground"
                          }`}
                        >
                          <ProviderBrandIcon
                            brand={provider}
                            className="h-4 w-4 flex-shrink-0"
                          />
                          {providerOptionLabel(provider, presets, t)}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}

                {(draft.provider === "opencode" ||
                  draft.provider === "opencode-go") && (
                  <div className="space-y-3 border-b border-border/60 py-5">
                    <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <Globe2 className="h-4 w-4" />
                      {t("api.opencodePlan")}
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {OPENCODE_PLANS.map((plan) => (
                        <Button
                          variant="ghost"
                          key={plan.id}
                          type="button"
                          onClick={() => selectProvider(plan.provider)}
                          className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                            draft.provider === plan.provider
                              ? "border-primary bg-primary/10 font-medium text-primary-text"
                              : "border-border/60 text-muted-foreground hover:border-border hover:text-foreground"
                          }`}
                        >
                          {t(plan.labelKey)}
                        </Button>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t("api.opencodePlanHint")}
                    </p>
                  </div>
                )}

                {isCustomDraft && !draft.localGateway && (
                  <div className="space-y-3 border-b border-border/60 py-5">
                    <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <Server className="h-4 w-4" />
                      {t("api.protocol")}
                    </label>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      {(["anthropic", "openai", "gemini"] as const).map(
                        (protocol) => (
                          <Button
                            variant="ghost"
                            key={protocol}
                            type="button"
                            onClick={() => selectCustomProtocol(protocol)}
                            className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                              draft.customProtocol === protocol
                                ? "border-primary bg-primary/10 font-medium text-primary-text"
                                : "border-border/60 text-muted-foreground hover:border-border hover:text-foreground"
                            }`}
                          >
                            {protocol}
                          </Button>
                        ),
                      )}
                    </div>
                  </div>
                )}

                {modelRows.length === 0 && !isCustomDraft && (
                  <div className="space-y-3 border-b border-border/60 py-5">
                    <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <PlugZap className="h-4 w-4" />
                      {t("api.modelsSection")}
                    </label>
                    <p className="text-xs text-muted-foreground">
                      {t("api.modelsConnectHint")}
                    </p>
                  </div>
                )}

                <div className="space-y-3 border-b border-border/60 py-5">
                  <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <Pencil className="h-4 w-4" />
                    {t("api.customName")}
                  </label>
                  <Input
                    type="text"
                    value={draft.name}
                    onChange={(event) =>
                      updateDraft({ name: event.target.value })
                    }
                    placeholder={t("api.customNamePlaceholder")}
                    className="w-full rounded-lg border border-border bg-background px-4 py-3 text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 h-auto shadow-none"
                  />
                </div>

                <div className="space-y-3 border-b border-border/60 py-5">
                  <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <Key className="h-4 w-4" />
                    {t("api.apiKey")}
                  </label>
                  <Input
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
                    className="w-full rounded-lg border border-border bg-background px-4 py-3 text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 h-auto shadow-none"
                  />
                </div>

                {isCustomDraft && (
                  <div className="space-y-3 border-b border-border/60 py-5">
                    <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <Server className="h-4 w-4" />
                      {t("api.baseUrl")}
                    </label>
                    <Input
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
                      className="w-full rounded-lg border border-border bg-background px-4 py-3 text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 h-auto shadow-none"
                    />
                  </div>
                )}

                {connectState === "failed" && diagResult && (
                  <div className="border-b border-border/60 py-5">
                    <ApiDiagnosticsPanel
                      result={diagResult}
                      isRunning={false}
                      onRunDiagnostics={handleConnect}
                      showActions={false}
                    />
                  </div>
                )}

                {(modelRows.length > 0 || isCustomDraft) && (
                  <div className="space-y-3 border-b border-border/60 py-5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label className="text-sm font-medium text-foreground">
                        {t("api.modelsSection")}
                      </label>
                      <span className="text-xs text-muted-foreground">
                        {t("api.modelsEnabledCount", {
                          enabled: modelRows.filter(
                            (row) => row.enabled && row.id.trim(),
                          ).length,
                          total: modelRows.filter((row) => row.id.trim())
                            .length,
                        })}
                      </span>
                    </div>

                    <Input
                      type="text"
                      value={modelFilter}
                      onChange={(event) => setModelFilter(event.target.value)}
                      placeholder={t("api.modelsSearch")}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />

                    {modelRows.length === 0 && (
                      <p className="text-xs text-muted-foreground">
                        {t("api.selectPresetModelsHint")}
                      </p>
                    )}

                    <div
                      data-testid="model-rows"
                      className="max-h-80 space-y-1 overflow-y-auto"
                    >
                      {visibleModelRows.map(({ row, index }) => {
                        const rowKey = row.id || `manual-${index}`;
                        const supportsImage =
                          row.input?.includes("image") ?? false;
                        return (
                          <div
                            key={`${rowKey}-${index}`}
                            className="rounded-lg px-2 py-1.5 hover:bg-hover-surface"
                          >
                            <div className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                data-testid={`model-row-${row.id}`}
                                checked={row.enabled}
                                onChange={() => toggleModel(index)}
                                className="rounded"
                              />
                              {row.manual || !row.id ? (
                                <Input
                                  type="text"
                                  value={row.id}
                                  placeholder={t("api.modelId")}
                                  data-testid={`model-id-${index}`}
                                  onChange={(event) =>
                                    patchRow(index, {
                                      id: event.target.value,
                                      label: event.target.value,
                                    })
                                  }
                                  onBlur={() => commitRow(index)}
                                  className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 h-auto shadow-none"
                                />
                              ) : (
                                <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                                  {row.label}
                                  {row.label !== row.id && (
                                    <span className="ml-2 text-xs text-muted-foreground">
                                      {row.id}
                                    </span>
                                  )}
                                </span>
                              )}
                              {row.isNew && (
                                <span className="shrink-0 rounded-md border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary-text">
                                  {t("api.modelsNew")}
                                </span>
                              )}
                              {isFreeModel({
                                id: row.id,
                                label: row.label,
                              }) && (
                                <span className="shrink-0 rounded-md border border-success/40 bg-success/10 px-1.5 py-0.5 text-[10px] text-success">
                                  {t("common.free")}
                                </span>
                              )}
                              <Button
                                variant="ghost"
                                type="button"
                                onClick={() => setDefaultModelRow(row.id)}
                                disabled={!row.enabled || !row.id.trim()}
                                className={`rounded-md border px-1.5 py-0.5 text-[10px] transition-colors ${
                                  row.isDefault
                                    ? "border-primary bg-primary/10 text-primary-text"
                                    : "border-border/60 text-muted-foreground hover:border-border hover:text-muted-foreground"
                                } disabled:opacity-40`}
                              >
                                {t("api.modelsDefault")}
                              </Button>
                              {isCustomDraft && (
                                <Button
                                  variant="ghost"
                                  type="button"
                                  onClick={() => removeModelRow(index)}
                                  aria-label={t("common.delete")}
                                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive h-auto"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </div>
                            <div className="mt-1 flex items-center gap-2 pl-6">
                              <Input
                                type="number"
                                value={row.contextWindow ?? ""}
                                data-testid={`model-context-${row.id}`}
                                placeholder={t("api.contextWindowPlaceholder")}
                                title={t("api.contextWindowHint")}
                                onChange={(event) => {
                                  const parsed = Number(event.target.value);
                                  patchRow(index, {
                                    contextWindow:
                                      event.target.value && parsed > 0
                                        ? Math.round(parsed)
                                        : undefined,
                                    contextWindowPinned: Boolean(
                                      event.target.value && parsed > 0,
                                    ),
                                  });
                                }}
                                onBlur={() => commitRow(index)}
                                className="w-36 rounded-lg border border-border bg-background px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 h-auto shadow-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                              />
                              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                <input
                                  type="checkbox"
                                  data-testid={`model-image-${row.id}`}
                                  checked={supportsImage}
                                  onChange={() => toggleRowImage(index)}
                                  className="rounded"
                                />
                                {t("api.supportsImage")}
                              </label>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {isCustomDraft && (
                      <Button
                        variant="ghost"
                        type="button"
                        onClick={addModelRow}
                        className="inline-flex items-center gap-1 rounded-lg border border-border/60 px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-hover-surface hover:text-foreground h-auto"
                      >
                        <Plus className="h-3 w-3" />
                        {t("api.addCustomModel")}
                      </Button>
                    )}
                  </div>
                )}

                {error && (
                  <div className="flex items-center gap-2 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
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
                        ? "text-destructive"
                        : "text-muted-foreground"
                    }`}
                  >
                    {connectMessage}
                  </p>
                )}

                <div className="flex items-center justify-end gap-2">
                  {connectState === "connected" ? (
                    <>
                      <Button
                        variant="ghost"
                        type="button"
                        onClick={handleConnect}
                        className="rounded-lg border border-border/60 px-4 py-3 text-sm text-muted-foreground hover:bg-hover-surface hover:text-foreground h-auto"
                      >
                        {t("api.reconnect")}
                      </Button>
                      <Button
                        variant="ghost"
                        type="button"
                        onClick={closeEditor}
                        className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-3 font-medium text-primary-foreground hover:bg-primary/90 h-auto"
                      >
                        <CheckCircle className="h-4 w-4" />
                        {t("api.done")}
                      </Button>
                    </>
                  ) : connectState === "failed" ? (
                    <>
                      <Button
                        variant="ghost"
                        type="button"
                        onClick={() => {
                          void handleSaveDraft();
                        }}
                        className="inline-flex items-center gap-2 rounded-lg border border-border/60 px-4 py-3 text-sm text-muted-foreground hover:bg-hover-surface hover:text-foreground h-auto"
                      >
                        {t("common.save")}
                      </Button>
                      <Button
                        variant="ghost"
                        type="button"
                        onClick={handleConnect}
                        className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-3 font-medium text-primary-foreground hover:bg-primary/90 h-auto"
                      >
                        {t("api.retryConnect")}
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        variant="ghost"
                        type="button"
                        onClick={closeEditor}
                        className="rounded-lg border border-border/60 px-4 py-3 text-sm text-muted-foreground hover:bg-hover-surface hover:text-foreground h-auto"
                      >
                        {t("common.cancel")}
                      </Button>
                      <Button
                        variant="ghost"
                        type="button"
                        onClick={handleConnect}
                        disabled={connectState === "connecting"}
                        className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-3 font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 h-auto"
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
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </DialogContent>
        </OccludingDialog>
      )}
    </div>
  );
}
