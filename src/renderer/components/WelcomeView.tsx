import { useState, useRef, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../store";
import { useAppConfig } from "../store/selectors";
import { useIPC } from "../hooks/useIPC";
import { profileKeyToProvider } from "../hooks/useApiConfigState";
import type {
  ContentBlock,
  ThinkingLevel,
  ProviderProfileKey,
  ApiProviderConfig,
} from "../types";
import { getInitialSessionTitle } from "../../shared/session-title";
import { ArrowRight } from "lucide-react";
import { API_PROVIDER_PRESETS } from "../../shared/api-model-presets";
import {
  ChatInput,
  type ChatInputHandle,
  type ChatInputSubmitData,
} from "./ChatInput";
import { ChatInputBottomBar } from "./ChatInputBottomBar";

function hasUsableProviderConfig(
  profileKey: ProviderProfileKey,
  config: ApiProviderConfig,
): boolean {
  if (!config.defaultModel.trim()) return false;
  const { provider } = profileKeyToProvider(profileKey);
  if (provider === "oauth") return true;
  if (provider === "ollama") {
    return Boolean(config.baseUrl?.trim());
  }
  return Boolean(config.apiKey.trim());
}

export function WelcomeView() {
  const { t } = useTranslation();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isInputExpanded, setIsInputExpanded] = useState(false);
  const { startSession } = useIPC();
  const isConfigured = useAppStore((state) => state.isConfigured);
  const workingDir = useAppStore((state) => state.workingDir);
  const setShowSettings = useAppStore((state) => state.setShowSettings);
  const setSettingsTab = useAppStore((state) => state.setSettingsTab);
  const appConfig = useAppConfig();
  const chatInputRef = useRef<ChatInputHandle>(null);

  // Model & thinking level — initialised from first available model, same source as ChatView
  const [initialized, setInitialized] = useState(false);
  const [selectedModel, setSelectedModel] = useState("");
  const [selectedProviderProfileKey, setSelectedProviderProfileKey] =
    useState<ProviderProfileKey>("openrouter" as ProviderProfileKey);
  const [selectedThinkingLevel, setSelectedThinkingLevel] =
    useState<ThinkingLevel>("medium");
  const thinkingLevelOptions: ThinkingLevel[] = [
    "off",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
  ];

  const contextWindowTotal = useMemo(() => {
    const models = appConfig?.providers?.[selectedProviderProfileKey]?.models;
    if (!models) return "--";
    const model = models.find((m) => m.id === selectedModel);
    const cw = model?.contextWindow;
    if (!cw || cw <= 0) return "--";
    if (cw >= 1_000_000) return `${(cw / 1_000_000).toFixed(1)}M`;
    if (cw >= 1_000) return `${(cw / 1_000).toFixed(1)}k`;
    return String(cw);
  }, [appConfig?.providers, selectedProviderProfileKey, selectedModel]);

  const modelOptions = useMemo(() => {
    const grouped = new Map<
      ProviderProfileKey,
      { groupLabel: string; items: Array<{ id: string; name: string }> }
    >();
    const providers = appConfig?.providers || {};

    for (const [profileKey, providerConfig] of Object.entries(providers)) {
      if (!providerConfig) continue;
      const typedKey = profileKey as ProviderProfileKey;
      if (!hasUsableProviderConfig(typedKey, providerConfig)) continue;
      const meta = profileKeyToProvider(typedKey);
      const presetLabel =
        providerConfig.name ||
        (meta.provider === "custom"
          ? `${API_PROVIDER_PRESETS.custom.name} / ${providerConfig.customProtocol}`
          : (
              API_PROVIDER_PRESETS as unknown as Record<
                string,
                typeof API_PROVIDER_PRESETS.custom
              >
            )[meta.provider]?.name || meta.provider);
      grouped.set(typedKey, {
        groupLabel: presetLabel,
        items: providerConfig.models.map((item) => ({
          id: item.id,
          name: item.label || item.id,
        })),
      });
    }

    return Array.from(grouped.entries()).map(([profileKey, group]) => ({
      profileKey,
      groupLabel: group.groupLabel,
      items: group.items,
    }));
  }, [appConfig?.providers]);

  useEffect(() => {
    if (
      initialized ||
      modelOptions.length === 0 ||
      modelOptions[0].items.length === 0
    )
      return;

    // ponytail: project-level model default, fallback to global
    let lastModel = appConfig?.model;
    let lastProvider = appConfig?.activeProviderKey;
    let lastThinkingLevel = appConfig?.thinkingLevel;
    if (workingDir) {
      try {
        const raw = localStorage.getItem(
          "deskwand.pm." + encodeURIComponent(workingDir),
        );
        if (raw) {
          const pd = JSON.parse(raw);
          lastModel = pd.m || lastModel;
          lastProvider = pd.p || lastProvider;
          lastThinkingLevel = pd.t || lastThinkingLevel;
        }
      } catch {
        /* ignore */
      }
    }

    const providerGroup = modelOptions.find(
      (g) => g.profileKey === lastProvider,
    );
    const modelExists = !!(
      providerGroup &&
      lastModel &&
      providerGroup.items.some((i) => i.id === lastModel)
    );

    if (modelExists) {
      setSelectedModel(lastModel!);
      setSelectedProviderProfileKey(lastProvider as ProviderProfileKey);
    } else {
      setSelectedModel(modelOptions[0].items[0].id);
      setSelectedProviderProfileKey(modelOptions[0].profileKey);
    }

    if (
      lastThinkingLevel &&
      thinkingLevelOptions.includes(lastThinkingLevel as ThinkingLevel)
    ) {
      setSelectedThinkingLevel(lastThinkingLevel as ThinkingLevel);
    }
    setInitialized(true);
  }, [modelOptions, initialized, appConfig]);

  const handleSubmit = async (data: ChatInputSubmitData) => {
    if (isSubmitting) return;

    const contentBlocks: ContentBlock[] = [];

    data.images.forEach((img) => {
      contentBlocks.push({
        type: "image",
        source: {
          type: "base64",
          media_type: img.mediaType as
            | "image/jpeg"
            | "image/png"
            | "image/gif"
            | "image/webp",
          data: img.base64,
        },
      });
    });

    data.files.forEach((file) => {
      contentBlocks.push({
        type: "file_attachment",
        filename: file.name,
        relativePath: file.path,
        size: file.size,
        mimeType: file.type,
        inlineDataBase64: file.inlineDataBase64,
      });
    });

    if (data.text) {
      contentBlocks.push({ type: "text", text: data.text });
    }

    setIsSubmitting(true);
    try {
      const sessionTitle = getInitialSessionTitle(
        data.text,
        data.files[0]?.name,
      );
      const session = await startSession(
        sessionTitle,
        contentBlocks,
        workingDir || undefined,
        selectedThinkingLevel,
        selectedProviderProfileKey,
        selectedModel,
      );
      if (session) {
        chatInputRef.current?.clear();
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-5 py-10 md:px-8 md:py-14">
      <div className="max-w-[840px] w-full space-y-7 animate-fade-in">
        <div className="space-y-4 text-center">
          <p className="text-base font-medium tracking-[-0.02em] text-text-secondary text-center">
            {t("welcome.title")}
          </p>
        </div>

        {/* API Not Configured Hint */}
        {!isConfigured && (
          <p className="text-sm text-text-muted text-center">
            {t("welcome.apiNotConfigured")}{" "}
            <button
              type="button"
              onClick={() => {
                setSettingsTab("api");
                setShowSettings(true);
              }}
              className="inline-flex items-center gap-1 text-accent hover:text-accent-hover transition-colors"
            >
              {t("welcome.goToSettings")}
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </p>
        )}

        {/* Chat Input — same as ChatView */}
        <ChatInput
          ref={chatInputRef}
          onSubmit={handleSubmit}
          disabled={isSubmitting}
          isExpanded={isInputExpanded}
          onToggleExpand={() => setIsInputExpanded((v) => !v)}
          slashMenuDirection="down"
          placeholder={t("welcome.placeholder")}
          cardClassName="rounded-6xl bg-background/60 shadow-elevated px-5 py-5 space-y-4"
          textareaClassName="w-full resize-none bg-transparent border-none outline-none text-text-primary placeholder:text-text-muted text-sm leading-relaxed overflow-hidden"
          bottomSlot={
            <ChatInputBottomBar
              onAttach={() => chatInputRef.current?.selectFiles()}
              model={selectedModel}
              modelOptions={modelOptions}
              activeProviderProfileKey={selectedProviderProfileKey}
              onSelectModel={(profileKey, modelId) => {
                // Validate modelId exists in modelOptions before applying
                const group = modelOptions.find(
                  (g) => g.profileKey === profileKey,
                );
                if (!group?.items.some((i) => i.id === modelId)) return;
                setSelectedModel(modelId);
                setSelectedProviderProfileKey(profileKey);
                // ponytail: project → localStorage only, global → electron-store
                if (workingDir) {
                  try {
                    localStorage.setItem(
                      "deskwand.pm." + encodeURIComponent(workingDir),
                      JSON.stringify({
                        p: profileKey,
                        m: modelId,
                        t: selectedThinkingLevel,
                      }),
                    );
                  } catch {
                    /* ignore */
                  }
                } else {
                  window.electronAPI.config.setActiveProvider({
                    profileKey,
                    defaultModel: modelId,
                  });
                }
              }}
              thinkingLevel={selectedThinkingLevel}
              thinkingLevelOptions={thinkingLevelOptions}
              onSelectThinkingLevel={(level) => {
                setSelectedThinkingLevel(level);
                // ponytail: project → localStorage only, global → electron-store
                if (workingDir) {
                  try {
                    localStorage.setItem(
                      "deskwand.pm." + encodeURIComponent(workingDir),
                      JSON.stringify({
                        p: selectedProviderProfileKey,
                        m: selectedModel,
                        t: level,
                      }),
                    );
                  } catch {
                    /* ignore */
                  }
                } else {
                  window.electronAPI.config.save({ thinkingLevel: level });
                }
              }}
              contextUsagePercentage={0}
              contextRingColorClass="text-accent"
              contextUsageTooltip={t("chat.contextUsageTooltip", {
                percentage: 0,
                used: "0",
                total: contextWindowTotal,
                promptNonCache: "--",
                output: "--",
                cacheRead: "--",
                cacheHitRate: "--",
              })}
              canStop={false}
              onStop={() => {}}
              isSubmitting={isSubmitting}
              isExpanded={isInputExpanded}
              onToggleExpand={() => setIsInputExpanded((v) => !v)}
            />
          }
        />
      </div>
    </div>
  );
}
