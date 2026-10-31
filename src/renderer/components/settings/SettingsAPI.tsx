import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Bot,
  ChevronDown,
  ChevronRight,
  Eye,
  Globe2,
  Key,
  Loader2,
  Search,
  Server,
  Trash2,
  Zap,
} from "lucide-react";
import { connectAndPersistProvider } from "../../services/provider-connect";
import type {
  MergeProviderModelsResult,
  ProviderModelRow,
} from "../../utils/merge-provider-models";
import { useAppStore } from "../../store";
import {
  FALLBACK_PROVIDER_PRESETS,
  profileKeyFromProvider,
  profileKeyToProvider,
} from "../../hooks/useApiConfigState";
import { oauthProfileKey } from "../../../shared/oauth-utils";
import { getCodingSubscription } from "../../../shared/coding-subscriptions";
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
  ProviderDraft,
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
import { ProviderBrandIcon } from "./provider-icons";
import { resolveProviderDisplayName } from "../../utils/model-label";
import {
  SettingsContentSection,
  SettingsFormSelect,
  SettingsSection,
  SettingsSwitch,
} from "./shared";
import { OAUTH_PROVIDERS, type ProviderCatalogEntry } from "./provider-catalog";
import ApiDiagnosticsPanel from "../ApiDiagnosticsPanel";
import { ProviderCatalogPage } from "./api/provider-catalog-page";
import { ProviderCredentialForm } from "./api/provider-credential-form";
import { ProviderDetailPage } from "./api/provider-detail-page";
import {
  API_VIEW_LIST,
  backFrom,
  openCatalog,
  openDetail,
  pickCatalogEntry,
  type ApiView,
} from "./api/api-view";
import { maskSecret, ProviderListPage } from "./api/provider-list-page";
import { Input } from "../ui/input";
import { Button } from "../app-button";
import {
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { OccludingAlertDialog } from "../ui/occluding-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";

type ProviderChoice = ProviderType;

interface SettingsAPIProps {
  embedded?: boolean;
  onSaved?: () => void;
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
  const oauthDisconnectReturnFocus = useReturnFocus(rootRef);
  const deleteDialogReturnFocus = useReturnFocus(rootRef);
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
  const [diagResultView, setDiagResult] = useState<DiagnosticResult | null>(
    null,
  );
  const [modelRows, setModelRows] = useState<ProviderModelRow[]>([]);
  const [, setModelFilter] = useState("");
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
  const [, setError] = useState("");
  const [, setSuccessMessage] = useState("");
  const [, setEditorOpen] = useState(false);
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

  // ── 视图状态机：列表 → 目录 → 添加 / 详情 ──
  const [view, setView] = useState<ApiView>(API_VIEW_LIST);
  // 引导页「更多供应商…」带着意图进来，直接落到目录页
  const apiConfigIntent = useAppStore((state) => state.apiConfigIntent);
  const setApiConfigIntent = useAppStore((state) => state.setApiConfigIntent);
  useEffect(() => {
    if (!apiConfigIntent) return;
    if (apiConfigIntent === "catalog") setView(openCatalog("main"));
    setApiConfigIntent(null);
  }, [apiConfigIntent, setApiConfigIntent]);

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
  /** 视觉模型来源：off / profile:<profileKey> / manual */
  const [visionSource, setVisionSource] = useState<string>("off");
  /**
   * 「单独配置」的手填字段默认收起：这段字段就是旧的供应商配置表单，
   * 一进页面就铺开会让视觉页看起来还是老页面。
   */
  const [visionManualOpen, setVisionManualOpen] = useState(false);
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
        setVisionSource(
          nextConfig.visionModel.providerProfileKey
            ? `profile:${nextConfig.visionModel.providerProfileKey}`
            : nextConfig.visionModel.enabled
              ? "manual"
              : "off",
        );
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
  const configuredProfileKeys = useMemo(
    () => new Set(configuredProviders.map((row) => row.profileKey as string)),
    [configuredProviders],
  );

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

  /**
   * 能当视觉来源的供应商：OAuth 的 provider 是合成值、没有 baseUrl/key，
   * 引用了只会写出坏配置；零模型的供应商则在来源里选了也没模型可选。
   */
  const visionSourceCandidates = useMemo(
    () =>
      configuredProviders.filter(
        (row) =>
          row.config.provider !== "oauth" &&
          row.config.models.some(
            (model) => !(row.config.disabledModels ?? []).includes(model.id),
          ),
      ),
    [configuredProviders],
  );

  const isCustomDraft = draft?.provider === "custom";
  // 保留原始下标：行编辑按 index 定位（手工行的 id 可以是空串，不能用 id 做 key）

  /** 订阅套餐也是一条独立条目：进它自己的凭证页，不共享一个「套餐弹窗」。 */
  const openPlanDraft = (entry: ProviderCatalogEntry) => {
    const plan = getCodingSubscription(entry.id);
    const existing = appConfig?.providers?.[entry.id as ProviderProfileKey];
    startConnectRequest();
    setOriginalProfileKey(existing ? (entry.id as ProviderProfileKey) : null);
    setDraft({
      profileKey: entry.id as ProviderProfileKey,
      provider: "custom",
      customProtocol: "openai",
      name: plan?.name ?? existing?.name ?? "",
      apiKey: existing?.apiKey ?? "",
      baseUrl: plan?.baseUrl ?? existing?.baseUrl ?? "",
      defaultModel: plan?.defaultModel ?? "",
      models: [],
    });
    setError("");
    setSuccessMessage("");
    resetConnectState();
  };

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
  /**
   * 连接 = 服务层同一条判断链（services/provider-connect.ts），这里只接状态。
   * 欢迎屏的「粘贴 API Key」走的是同一个函数，所以两处口径不会漂。
   */
  const runConnect = async (
    draftValue: ProviderDraft,
    silent = false,
  ): Promise<boolean> => {
    const requestId = startConnectRequest();
    const sanitized = sanitizeDraft(draftValue, presets);
    const ok = await connectAndPersistProvider(
      {
        draft: sanitized,
        presets,
        catalog: catalogForDraft(draftValue),
      },
      {
        t,
        silent,
        isSaved: (profileKey) =>
          Boolean(appConfig?.providers?.[profileKey as ProviderProfileKey]),
        isStale: () => connectRequestRef.current !== requestId,
        persist: async (draftToSave, models, defaultModel, disabled) =>
          persistModels(draftToSave, models, defaultModel, disabled),
        onMerge: (merge) => applyMergeToDraft(merge),
        onDiagnostic: (result) => {
          if (result) setDiagResult(result);
        },
        onState: (state) => setConnectState(state),
        onMessage: (message) => setConnectMessage(message),
        onError: (message) => setError(message),
      },
    );
    return ok;
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
        // 一键连上就回列表，不把用户留在表单里
        if (await runConnect(nextDraft)) {
          startConnectRequest();
          resetConnectState();
          setView(API_VIEW_LIST);
        }
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
      // 「仍然保存」不要求模型：连不上端点时也要能先把凭证留下，
      // 模型列表留空，列表页会标「未获取模型」。
      const sanitized = sanitizeDraft(draft, presets);
      const ok = await persistModels(
        sanitized,
        sanitized.models,
        sanitized.defaultModel,
        sanitized.disabledModels ?? [],
      );
      if (ok) {
        startConnectRequest();
        resetConnectState();
        setView(API_VIEW_LIST);
      }
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

  /** 图片能力：改完立即落盘（与勾选一致），并钉住，避免端点元数据把它改回去 */

  // ── Vision model save (from modal) ──
  const handleVisionSave = async () => {
    if (!window.electronAPI) return;
    // 开关在界面上由「来源」表达，校验也必须按来源判，不看草稿里的 enabled
    const willEnable = visionSource !== "off";
    if (willEnable && !visionDraft.model.trim()) {
      setVisionError(t("api.modelRequired"));
      return;
    }
    if (
      willEnable &&
      visionSource === "manual" &&
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
      const config: VisionModelConfig =
        visionSource === "off"
          ? {
              enabled: false,
              provider: visionDraft.provider,
              apiKey: visionDraft.apiKey,
              baseUrl: visionDraft.baseUrl || undefined,
              model: visionDraft.model,
            }
          : visionSource.startsWith("profile:")
            ? {
                enabled: true,
                provider: visionDraft.provider,
                apiKey: visionDraft.apiKey,
                baseUrl: visionDraft.baseUrl || undefined,
                model: visionDraft.model,
                providerProfileKey: visionSource.slice("profile:".length),
              }
            : {
                enabled: true,
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

  // ── Close vision editor, resetting draft to saved state ──

  // ── Vision model helper: reuse active provider's API key ──
  const reuseActiveProviderApiKey = () => {
    const activeKey = appConfig?.activeProviderKey;
    if (!activeKey) return;
    const provider = appConfig?.providers?.[activeKey];
    if (!provider?.apiKey) return;
    setVisionDraft((prev) => ({ ...prev, apiKey: provider.apiKey }));
  };

  /** 设为当前：只改 activeProviderKey，不动供应商本身。 */
  const handleSetActive = async (profileKey: ProviderProfileKey) => {
    if (!window.electronAPI) return;
    try {
      const saved = await window.electronAPI.config.save({
        activeProviderKey: profileKey,
        activeProfileKey: profileKey,
      });
      applyConfig(saved.config);
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : String(saveError),
      );
    }
  };

  /** 详情页就地改名：空值不覆盖已有名称。 */
  const handleRename = async (profileKey: ProviderProfileKey, name: string) => {
    const provider = appConfig?.providers?.[profileKey];
    if (!provider || !name.trim() || !window.electronAPI) return;
    try {
      const saved = await window.electronAPI.config.saveProvider({
        profileKey,
        config: { ...provider, name: name.trim() },
      });
      applyConfig(saved.config);
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : String(saveError),
      );
    }
  };

  /** 添加流程：连接成功后回列表；失败留在当前页。 */
  const runConnectAndClose = async (next: ProviderDraft) => {
    const ok = await runConnect(next);
    if (!ok) return;
    startConnectRequest();
    resetConnectState();
    setView(API_VIEW_LIST);
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
              {view.kind === "list" && (
                <>
                  {!embedded && (
                    <SettingsSection
                      title={t("api.configuredListTitle")}
                      description={t("api.configuredListDesc")}
                    >
                      <ProviderListPage
                        rows={configuredProviders}
                        activeProfileKey={
                          appConfig?.activeProviderKey ?? "openrouter"
                        }
                        presets={presets}
                        oauthStatuses={oauthStatuses}
                        onOpen={(profileKey) => {
                          openEdit(profileKey);
                          setView(openDetail(profileKey, "main"));
                        }}
                        onAdd={() => setView(openCatalog("main"))}
                        onSetActive={(profileKey) =>
                          void handleSetActive(profileKey)
                        }
                        onDelete={requestDelete}
                        onDisconnect={(providerId) =>
                          setPendingOAuthLogoutProviderId(providerId)
                        }
                      />
                    </SettingsSection>
                  )}
                  {embedded && (
                    <ProviderListPage
                      rows={configuredProviders}
                      activeProfileKey={
                        appConfig?.activeProviderKey ?? "openrouter"
                      }
                      presets={presets}
                      oauthStatuses={oauthStatuses}
                      onOpen={(profileKey) => {
                        openEdit(profileKey);
                        setView(openDetail(profileKey, "main"));
                      }}
                      onAdd={() => setView(openCatalog("main"))}
                      onSetActive={(profileKey) =>
                        void handleSetActive(profileKey)
                      }
                      onDelete={requestDelete}
                      onDisconnect={(providerId) =>
                        setPendingOAuthLogoutProviderId(providerId)
                      }
                    />
                  )}
                </>
              )}

              {view.kind === "catalog" && (
                <ProviderCatalogPage
                  presets={presets}
                  configuredProfileKeys={configuredProfileKeys}
                  oauthStatuses={oauthStatuses}
                  oauthLoading={oauthLoading}
                  oauthErrors={oauthErrors}
                  configuredLocalGateways={configuredLocalGateways}
                  localGatewayStatus={localGatewayStatus}
                  onBack={() => setView(backFrom(view))}
                  onPickEntry={(entry) => {
                    if (entry.kind === "plan") {
                      openPlanDraft(entry);
                      setView(pickCatalogEntry(view, entry));
                      return;
                    }
                    if (entry.kind === "cloud") {
                      openCreate("openrouter");
                      setView(pickCatalogEntry(view, entry));
                      return;
                    }
                    if (entry.id === "custom") {
                      openCreate("custom");
                      setView(pickCatalogEntry(view, entry));
                      return;
                    }
                    openCreate(entry.id as ProviderType);
                    setView(pickCatalogEntry(view, entry));
                  }}
                  onOAuthLogin={(providerId) =>
                    void handleOAuthLogin(providerId)
                  }
                  onOAuthDisconnect={(providerId) =>
                    setPendingOAuthLogoutProviderId(providerId)
                  }
                  onOpenLocalGateway={(id) => {
                    // 已配过就走详情（改凭证 / 看模型），否则进添加页
                    const existing = Object.keys(
                      appConfig?.providers ?? {},
                    ).find(
                      (key) => appConfig?.providers?.[key]?.localGateway === id,
                    );
                    if (existing) {
                      openEdit(existing as ProviderProfileKey);
                      setView(
                        openDetail(existing as ProviderProfileKey, "main"),
                      );
                    } else {
                      setView(pickCatalogEntry(view, { kind: "local", id }));
                    }
                    void openLocalGateway(id);
                  }}
                  onOpenConfigured={(profileKey) => {
                    openEdit(profileKey);
                    setView(openDetail(profileKey, "main"));
                  }}
                />
              )}

              {view.kind === "add" && draft && (
                <ProviderCredentialForm
                  entry={view.entry}
                  presets={presets}
                  initial={{
                    name: draft.name,
                    apiKey: draft.apiKey,
                    baseUrl: draft.baseUrl,
                    customProtocol: draft.customProtocol,
                  }}
                  submitLabel={t("api.addProviderSubmit")}
                  busy={connectState === "connecting"}
                  errorText={
                    connectState === "failed" ? connectMessage : undefined
                  }
                  onSubmit={(values) => {
                    if (view.entry.kind === "plan") {
                      void handleSubscriptionSave(view.entry.id, values.apiKey)
                        .then(() => setView(API_VIEW_LIST))
                        .catch((cause: unknown) =>
                          setError(
                            cause instanceof Error
                              ? cause.message
                              : String(cause),
                          ),
                        );
                      return;
                    }
                    const next = {
                      ...draft,
                      name: values.name,
                      apiKey: values.apiKey,
                      baseUrl: values.baseUrl,
                      customProtocol: values.customProtocol,
                    };
                    setDraft(next);
                    void runConnectAndClose(next);
                  }}
                  onCancel={() => setView(backFrom(view))}
                  notice={
                    draft.localGateway ? (
                      <div
                        data-testid="local-gateway-notice"
                        className="space-y-1.5 rounded-lg border border-border/60 bg-background px-3 py-2.5"
                      >
                        <p className="text-xs text-muted-foreground">
                          {t(
                            getLocalGatewayPreset(draft.localGateway)
                              ?.keyHintKey ?? "api.localGatewayKeyHint",
                          )}
                        </p>
                        {localGatewayStatus[draft.localGateway]?.state ===
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
                              getLocalGatewayPreset(draft.localGateway!)
                                ?.docsUrl ?? "",
                            )
                          }
                          className="h-auto px-0 text-xs text-primary-text hover:underline"
                        >
                          {t("api.localGatewayDocs")}
                        </Button>
                      </div>
                    ) : null
                  }
                  diagnostics={
                    connectState === "failed" && diagResultView ? (
                      <ApiDiagnosticsPanel
                        result={diagResultView}
                        isRunning={false}
                        onRunDiagnostics={() => void handleConnect()}
                        showActions={false}
                      />
                    ) : null
                  }
                  secondaryAction={
                    connectState === "failed"
                      ? {
                          label: t("api.saveAnyway"),
                          onClick: () => void handleSaveDraft(),
                        }
                      : undefined
                  }
                />
              )}

              {view.kind === "detail" &&
                appConfig?.providers?.[view.profileKey] && (
                  <ProviderDetailPage
                    profileKey={view.profileKey}
                    config={appConfig.providers[view.profileKey]!}
                    presets={presets}
                    modelRows={modelRows}
                    connectState={connectState}
                    connectMessage={connectMessage}
                    onBack={() => setView(backFrom(view))}
                    onRename={(name) =>
                      void handleRename(view.profileKey, name)
                    }
                    onSaveCredentials={(values) => {
                      if (!draft) return;
                      const next = {
                        ...draft,
                        apiKey: values.apiKey,
                        baseUrl: values.baseUrl,
                        customProtocol: values.customProtocol,
                      };
                      setDraft(next);
                      void handleSave();
                    }}
                    onTest={() => void handleConnect()}
                    onModelsChange={setModelRows}
                    onModelsCommit={(rows) => commitRows(rows)}
                    onDelete={() => requestDelete(view.profileKey)}
                    allowManualModels={
                      appConfig.providers[view.profileKey]?.provider ===
                      "custom"
                    }
                  />
                )}
            </>
          )}
        </TabsContent>

        {/* 面板内容仍按原值条件渲染：Radix 把非当前值面板留在 DOM 里（hidden 空壳），
            不补这层守卫的话四个子视图会同时挂载并各自拉数据 —— 迁移前是切到才挂载。
            面板壳保留，只为 a11y（role=tabpanel + aria 关联）；非当前值面板不保留状态。 */}
        <TabsContent value="vision" className="max-w-[720px] space-y-5">
          {activeTab === "vision" && !embedded && (
            <SettingsContentSection
              title={t("api.visionModelTitle")}
              description={t("api.visionModelDesc")}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">
                  {t("api.visionModelEnable")}
                </span>
                <SettingsSwitch
                  checked={visionSource !== "off"}
                  onChange={(next) => {
                    const source = next
                      ? visionSourceCandidates.length > 0
                        ? `profile:${visionSourceCandidates[0].profileKey}`
                        : "manual"
                      : "off";
                    setVisionSource(source);
                    if (source !== "off" && !visionDraft.model.trim()) {
                      const profile = source.startsWith("profile:")
                        ? appConfig?.providers?.[
                            source.slice(
                              "profile:".length,
                            ) as ProviderProfileKey
                          ]
                        : undefined;
                      const firstModel = profile?.models?.find(
                        (model) =>
                          !(profile.disabledModels ?? []).includes(model.id),
                      );
                      if (firstModel) {
                        setVisionDraft((prev) => ({
                          ...prev,
                          provider: profile!.provider,
                          model: firstModel.id,
                        }));
                      }
                    }
                  }}
                  label={t("api.visionModelEnable")}
                  testId="vision-model-enabled"
                />
              </div>

              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-foreground">
                  {t("api.visionSource")}
                </span>
                <SettingsFormSelect
                  value={visionSource}
                  testId="vision-source"
                  label={t("api.visionSource")}
                  onChange={(next) => {
                    setVisionSource(next);
                    if (!next.startsWith("profile:")) return;
                    const profile =
                      appConfig?.providers?.[
                        next.slice("profile:".length) as ProviderProfileKey
                      ];
                    if (!profile) return;
                    const firstModel = profile.models?.find(
                      (model) =>
                        !(profile.disabledModels ?? []).includes(model.id),
                    );
                    setVisionDraft((prev) => ({
                      ...prev,
                      provider: profile.provider,
                      customProtocol: profile.customProtocol,
                      baseUrl: profile.baseUrl ?? "",
                      model: firstModel?.id ?? prev.model,
                    }));
                  }}
                  options={[
                    { value: "off", label: t("api.sourceOff") },
                    ...visionSourceCandidates.map((row) => ({
                      value: `profile:${row.profileKey}`,
                      label:
                        row.config.name ||
                        providerLabel(row.profileKey, presets, t),
                    })),
                    { value: "manual", label: t("api.sourceCustom") },
                  ]}
                />
              </label>

              {visionSource.startsWith("profile:") && (
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-foreground">
                    {t("api.visionModelLabel")}
                  </span>
                  <SettingsFormSelect
                    value={visionDraft.model}
                    testId="vision-model"
                    label={t("api.visionModelLabel")}
                    onChange={(next) =>
                      setVisionDraft((prev) => ({ ...prev, model: next }))
                    }
                    options={(
                      appConfig?.providers?.[
                        visionSource.slice(
                          "profile:".length,
                        ) as ProviderProfileKey
                      ]?.models ?? []
                    )
                      .filter(
                        (model) =>
                          !(
                            appConfig?.providers?.[
                              visionSource.slice(
                                "profile:".length,
                              ) as ProviderProfileKey
                            ]?.disabledModels ?? []
                          ).includes(model.id),
                      )
                      .map((model) => ({
                        value: model.id,
                        label: model.label,
                      }))}
                  />
                </label>
              )}

              {visionSource === "manual" && (
                <div className="space-y-3 rounded-xl border border-border/60 px-3 py-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div
                      className="min-w-0"
                      data-testid="vision-manual-summary"
                    >
                      <p className="truncate text-xs font-medium text-foreground">
                        {providerOptionLabel(visionDraft.provider, presets, t)}{" "}
                        / {visionDraft.model || "—"}
                      </p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {visionDraft.apiKey
                          ? `${t("api.apiKey")}: ${maskSecret(visionDraft.apiKey)}`
                          : t("api.enterApiKey")}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      type="button"
                      data-testid="vision-manual-toggle"
                      aria-expanded={visionManualOpen}
                      onClick={() => setVisionManualOpen((open) => !open)}
                      className="h-auto flex-none rounded-lg border border-border/60 px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-hover-surface hover:text-foreground"
                    >
                      {visionManualOpen ? t("api.collapse") : t("api.editApi")}
                    </Button>
                  </div>

                  {visionManualOpen && (
                    <div className="space-y-4 rounded-xl border border-border/60 px-3 py-3">
                      <div className="space-y-2">
                        <span className="flex items-center gap-2 text-xs font-medium text-foreground">
                          <Server className="h-3.5 w-3.5" />
                          {t("api.provider")}
                        </span>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                          {VISION_PROVIDER_ORDER.map((provider) => (
                            <Button
                              variant="ghost"
                              key={provider}
                              type="button"
                              data-testid={`vision-provider-${provider}`}
                              onClick={() => {
                                const preset = (
                                  presets as unknown as Record<
                                    string,
                                    ProviderPreset
                                  >
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
                              className={`inline-flex h-auto items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                                visionDraft.provider === provider
                                  ? "border-primary bg-primary/10 font-medium text-primary-text"
                                  : "border-border/60 text-muted-foreground hover:border-border hover:text-foreground"
                              }`}
                            >
                              <ProviderBrandIcon
                                brand={provider}
                                className="h-3.5 w-3.5 flex-shrink-0"
                              />
                              {providerOptionLabel(provider, presets, t)}
                            </Button>
                          ))}
                        </div>
                      </div>

                      {visionDraft.provider === "custom" && (
                        <div className="space-y-2">
                          <span className="flex items-center gap-2 text-xs font-medium text-foreground">
                            <Server className="h-3.5 w-3.5" />
                            {t("api.protocol")}
                          </span>
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
                                  className={`h-auto rounded-lg border px-3 py-1.5 text-xs transition-colors ${
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

                      {visionDraft.provider === "zhipu" && (
                        <div className="space-y-2">
                          <span className="flex items-center gap-2 text-xs font-medium text-foreground">
                            <Globe2 className="h-3.5 w-3.5" />
                            {t("api.region")}
                          </span>
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
                                className={`h-auto rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                                  visionDraft.baseUrl === region.baseUrl
                                    ? "border-primary bg-primary/10 font-medium text-primary-text"
                                    : "border-border/60 text-muted-foreground hover:border-border hover:text-foreground"
                                }`}
                              >
                                {t(region.labelKey)}
                              </Button>
                            ))}
                          </div>
                          <p className="text-[11px] text-muted-foreground">
                            {t("api.zhipuRegionHint")}
                          </p>
                        </div>
                      )}

                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="flex items-center gap-2 text-xs font-medium text-foreground">
                            <Key className="h-3.5 w-3.5" />
                            {t("api.apiKey")}
                          </span>
                          {appConfig?.activeProviderKey &&
                            appConfig?.providers?.[appConfig.activeProviderKey]
                              ?.apiKey && (
                              <Button
                                variant="ghost"
                                type="button"
                                size="xs"
                                onClick={reuseActiveProviderApiKey}
                                className="h-auto text-[11px] text-primary-text hover:underline"
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
                          className="h-auto w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground shadow-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/30"
                        />
                      </div>

                      {(visionDraft.provider === "custom" ||
                        visionDraft.provider === "ollama") && (
                        <div className="space-y-1.5">
                          <span className="flex items-center gap-2 text-xs font-medium text-foreground">
                            <Server className="h-3.5 w-3.5" />
                            {t("api.baseUrl")}
                          </span>
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
                            className="h-auto w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground shadow-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/30"
                          />
                        </div>
                      )}

                      <div className="space-y-1.5">
                        <span className="flex items-center gap-2 text-xs font-medium text-foreground">
                          <Eye className="h-3.5 w-3.5" />
                          {t("api.model")}
                        </span>
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
                          className="h-auto w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground shadow-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/30"
                        />
                        {visionDraft.provider !== "custom" && (
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            {(() => {
                              const preset = (
                                presets as unknown as Record<
                                  string,
                                  ProviderPreset
                                >
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
                                  className={`h-auto rounded-md border px-2 py-0.5 text-[11px] transition-colors ${
                                    visionDraft.model === m.id
                                      ? "border-primary bg-primary/10 text-primary-text"
                                      : "border-border/60 text-muted-foreground hover:border-border"
                                  }`}
                                >
                                  {m.name || m.id}
                                </Button>
                              ));
                            })()}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 border-t border-border/60 pt-3">
                <Button
                  variant="ghost"
                  type="button"
                  data-testid="vision-save"
                  disabled={isVisionSaving}
                  onClick={() => void handleVisionSave()}
                  className="h-auto rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {isVisionSaving ? t("common.saving") : t("common.save")}
                </Button>
              </div>
              {visionError && (
                <p role="alert" className="text-xs text-destructive">
                  {visionError}
                </p>
              )}
              {visionSuccess && (
                <p className="text-xs text-success">{visionSuccess}</p>
              )}
            </SettingsContentSection>
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
    </div>
  );
}
