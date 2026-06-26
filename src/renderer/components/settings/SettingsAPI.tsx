import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  CheckCircle,
  Eye,
  Key,
  Loader2,
  Pencil,
  Plus,
  Server,
  Trash2,
  X,
} from "lucide-react";
import { useAppStore } from "../../store";
import {
  FALLBACK_PROVIDER_PRESETS,
  profileKeyFromProvider,
  profileKeyToProvider,
} from "../../hooks/useApiConfigState";
import type {
  ApiProviderConfig,
  ApiProviderModel,
  CustomProtocolType,
  ProviderPreset,
  ProviderPresets,
  ProviderProfileKey,
  ProviderType,
  VisionModelConfig,
} from "../../types";

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
}

const PROVIDER_ORDER: ProviderChoice[] = [
  "openrouter",
  "anthropic",
  "deepseek",
  "openai",
  "gemini",
  "custom",
];

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
  return (presets as unknown as Record<string, ProviderPreset>)[provider];
}

function requiresApiKey(): boolean {
  return true;
}

function hasUsableCredentials(
  _profileKey: ProviderProfileKey,
  config: ApiProviderConfig,
): boolean {
  if (!config.defaultModel.trim()) return false;
  const apiKey = config.apiKey.trim();
  return Boolean(apiKey);
}

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
    defaultModel: defaultPresetModel?.id || "",
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

  if (draft.provider !== "custom") {
    return {
      ...draft,
      name: draft.name.trim(),
      apiKey: draft.apiKey.trim(),
      baseUrl: preset.baseUrl,
      defaultModel: presetModels[0]?.id || "",
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

function isCustomProfileKey(profileKey: ProviderProfileKey): boolean {
  return profileKey.startsWith("custom:");
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
  const [activeTab, setActiveTab] = useState<"main" | "vision">("main");

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

  const isVisionConfigured = !!(appConfig?.visionModel?.model?.trim());

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
      setIsLoadingConfig(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [setAppConfig, setIsConfigured]);

  const configuredProviders = useMemo(() => {
    const providers = appConfig?.providers || {};
    return (
      Object.entries(providers)
        .filter(([profileKey, config]) =>
          config &&
          hasUsableCredentials(profileKey as ProviderProfileKey, config),
        ) as Array<
        [string, ApiProviderConfig]
      >
    ).map(([profileKey, config]) => ({
      profileKey: profileKey as ProviderProfileKey,
      config,
    }));
  }, [appConfig]);

  const isCreating = originalProfileKey === null;
  const isCustomDraft = draft?.provider === "custom";

  const openCreate = () => {
    setOriginalProfileKey(null);
    setDraft(createEmptyDraft("openrouter", presets));
    setError("");
    setSuccessMessage("");
    setEditorOpen(true);
  };

  const openEdit = (profileKey: ProviderProfileKey) => {
    const provider = appConfig?.providers?.[profileKey];
    if (!provider) return;
    setOriginalProfileKey(profileKey);
    setDraft(createDraftFromProvider(profileKey, provider, presets));
    setError("");
    setSuccessMessage("");
    setEditorOpen(true);
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
    if (requiresApiKey() && !sanitized.apiKey) {
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

  // ── Vision model save (from modal) ──
  const handleVisionSave = async () => {
    if (!window.electronAPI) return;
    if (visionDraft.enabled && !visionDraft.model.trim()) {
      setVisionError(t("api.modelRequired"));
      return;
    }
    if (visionDraft.enabled && !visionDraft.apiKey.trim() && visionDraft.provider !== "ollama") {
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
        customProtocol: visionDraft.provider === "custom" ? visionDraft.customProtocol : undefined,
        apiKey: visionDraft.apiKey,
        baseUrl: visionDraft.baseUrl || undefined,
        model: visionDraft.model,
      };
      const saved = await window.electronAPI.config.save({ visionModel: config });
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
      customProtocol: saved.provider === "custom" ? saved.customProtocol : undefined,
      apiKey: saved.apiKey,
      baseUrl: saved.baseUrl || undefined,
      model: saved.model,
    };
    setIsVisionSaving(true);
    try {
      const savedConfig = await window.electronAPI.config.save({ visionModel: config });
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
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === "main"
                ? "border-accent text-accent"
                : "border-transparent text-text-muted hover:text-text-secondary"
            }`}
          >
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
        </div>
      )}

      {(activeTab === "main" || embedded) && (
        <div className="space-y-5">
          {!embedded && (
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium text-text-primary">
                  {t("api.configuredListTitle")}
                </h3>
                <p className="mt-1 text-xs text-text-muted">
                  {t("api.configuredListDesc")}
                </p>
              </div>
              <button
                type="button"
                onClick={openCreate}
                className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-accent-foreground hover:bg-accent-hover"
              >
                <Plus className="h-3.5 w-3.5" />
                {t("api.addApi")}
              </button>
            </div>
          )}

          {configuredProviders.length === 0 ? (
            <div className="rounded-2xl border border-border-muted px-4 py-5 text-sm text-text-muted">
              {t("api.configuredListEmpty")}
            </div>
          ) : (
            <div className="space-y-2">
              {configuredProviders.map(({ profileKey, config }) => {
                const isCustomProvider = isCustomProfileKey(profileKey);
                return (
                  <div
                    key={profileKey}
                    className="rounded-2xl border border-border-muted bg-background px-4 py-3 shadow-card"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-text-primary">
                          {config.name || providerLabel(profileKey, presets, t, config)}
                        </p>
                        {isCustomProvider && (
                          <p className="mt-1 truncate text-xs text-text-muted">
                            {config.baseUrl}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => openEdit(profileKey)}
                          className="inline-flex items-center gap-1 rounded-lg border border-border-muted px-2.5 py-1.5 text-xs text-text-secondary hover:bg-surface-hover hover:text-text-primary"
                        >
                          <Pencil className="h-3 w-3" />
                          {t("api.editApi")}
                        </button>
                        <button
                          type="button"
                          onClick={() => requestDelete(profileKey)}
                          className="inline-flex items-center gap-1 rounded-lg border border-border-muted px-2.5 py-1.5 text-xs text-text-secondary hover:bg-error/10 hover:text-error"
                        >
                          <Trash2 className="h-3 w-3" />
                          {t("api.deleteApi")}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {embedded && (
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-accent-foreground hover:bg-accent-hover"
            >
              <Plus className="h-3.5 w-3.5" />
              {t("api.addApi")}
            </button>
          )}
        </div>
      )}

      {activeTab === "vision" && !embedded && (
        <div className="space-y-5">
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
                  <p className="truncate text-sm font-medium text-text-primary">
                    🔮{" "}
                    {providerOptionLabel(visionDraft.provider, presets, t)}
                    {" / "}
                    {visionDraft.model}
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
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={visionDraft.enabled}
                      onChange={(e) => {
                        void handleVisionToggle(e.target.checked);
                      }}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-surface-hover rounded-full peer peer-checked:bg-accent peer-focus:ring-2 peer-focus:ring-accent/30 transition-colors after:content-[''] after:absolute after:top-0.5 after:start-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full"></div>
                  </label>
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
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={visionDraft.enabled}
                      onChange={(e) =>
                        setVisionDraft((prev) => ({ ...prev, enabled: e.target.checked }))
                      }
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-surface-hover rounded-full peer peer-checked:bg-accent peer-focus:ring-2 peer-focus:ring-accent/30 transition-colors after:content-[''] after:absolute after:top-0.5 after:start-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full"></div>
                  </label>
                </div>

                {/* Provider selection */}
                <div className="space-y-3 border-b border-border-muted pb-5">
                  <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
                    <Server className="h-4 w-4" />
                    {t("api.provider")}
                  </label>
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                    {PROVIDER_ORDER.map((provider) => (
                      <button
                        key={provider}
                        type="button"
                        onClick={() => {
                          const preset = (presets as unknown as Record<string, ProviderPreset>)[provider];
                          setVisionDraft((prev) => ({
                            ...prev,
                            provider,
                            baseUrl: provider !== "custom" ? (preset?.baseUrl || "") : prev.baseUrl,
                          }));
                        }}
                        className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                          visionDraft.provider === provider
                            ? "border-accent bg-accent/10 font-medium text-accent"
                            : "border-border-muted text-text-secondary hover:border-border hover:text-text-primary"
                        }`}
                      >
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
                              const preset = protocol === "anthropic" ? presets.custom : protocol === "openai" ? presets.openai : presets.gemini;
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

                {/* API Key */}
                <div className="space-y-3 border-b border-border-muted pb-5">
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
                      <Key className="h-4 w-4" />
                      {t("api.apiKey")}
                    </label>
                    {appConfig?.activeProviderKey && appConfig?.providers?.[appConfig.activeProviderKey]?.apiKey && (
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
                      setVisionDraft((prev) => ({ ...prev, apiKey: event.target.value }))
                    }
                    placeholder={t("api.enterApiKey")}
                    className="w-full rounded-lg border border-border bg-background px-4 py-3 text-text-primary placeholder-text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
                  />
                </div>

                {/* Base URL (custom provider or Ollama only) */}
                {(visionDraft.provider === "custom" || visionDraft.provider === "ollama") && (
                  <div className="space-y-3 border-b border-border-muted pb-5">
                    <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
                      <Server className="h-4 w-4" />
                      {t("api.baseUrl")}
                    </label>
                    <input
                      type="text"
                      value={visionDraft.baseUrl || ""}
                      onChange={(event) =>
                        setVisionDraft((prev) => ({ ...prev, baseUrl: event.target.value }))
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
                      setVisionDraft((prev) => ({ ...prev, model: event.target.value }))
                    }
                    placeholder={t("api.visionModelPlaceholder")}
                    className="w-full rounded-lg border border-border bg-background px-4 py-3 text-text-primary placeholder-text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
                  />
                  {/* Model suggestions based on provider */}
                  {visionDraft.provider !== "custom" && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {(() => {
                        const preset = (presets as unknown as Record<string, ProviderPreset>)[visionDraft.provider];
                        if (!preset?.models) return null;
                        return preset.models.slice(0, 5).map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => setVisionDraft((prev) => ({ ...prev, model: m.id }))}
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
                    providerLabel(
                      pendingDeleteProfileKey,
                      presets,
                      t,
                    ),
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

      {editorOpen && draft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 max-h-[88vh] w-full max-w-[900px] overflow-hidden rounded-2xl border border-border-muted bg-background">
            <div className="flex items-center justify-between border-b border-border-muted px-5 py-4">
              <h3 className="text-sm font-medium text-text-primary">
                {isCreating ? t("api.addApi") : t("api.editApi")}
              </h3>
              <button
                type="button"
                onClick={() => setEditorOpen(false)}
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
                        className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                          draft.provider === provider
                            ? "border-accent bg-accent/10 font-medium text-accent"
                            : "border-border-muted text-text-secondary hover:border-border hover:text-text-primary"
                        }`}
                      >
                        {providerOptionLabel(provider, presets, t)}
                      </button>
                    ))}
                  </div>
                </div>

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
                          {t("api.models")}
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
                                      ? Math.round(
                                          Number(event.target.value),
                                        )
                                      : undefined,
                                })
                              }
                              placeholder={t("api.contextWindowPlaceholder")}
                              title={t("api.contextWindowHint")}
                              className="w-36 rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                            />
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

                <button
                  type="button"
                  onClick={() => {
                    void handleSave();
                  }}
                  disabled={isSaving}
                  className="inline-flex items-center gap-2 self-end rounded-lg bg-accent px-4 py-3 font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
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
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
