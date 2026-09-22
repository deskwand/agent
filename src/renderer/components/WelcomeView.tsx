import { useState, useRef, useMemo, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../store";
import { useAppConfig } from "../store/selectors";
import { useIPC } from "../hooks/useIPC";
import { attachmentKeySet } from "../utils/attached-files";
import {
  WELCOME_QUICK_ENTRIES,
  visibleQuickEntries,
  type WelcomeQuickEntry,
} from "../welcome-quick-entries";
import { profileKeyToProvider } from "../hooks/useApiConfigState";
import type {
  ContentBlock,
  ThinkingLevel,
  ProviderProfileKey,
  ApiProviderConfig,
} from "../types";
import { getInitialSessionTitle } from "../../shared/session-title";
import { DEFAULT_WORKDIR_DIRNAME } from "../../shared/workspace-path";
import { ArrowRight, Eye, Globe, Sparkles } from "lucide-react";
import { API_PROVIDER_PRESETS } from "../../shared/api-model-presets";
import { resolveProviderDisplayName } from "../utils/model-label";
import {
  ChatInput,
  type ChatInputAttachedFile,
  type ChatInputHandle,
  type ChatInputSubmitData,
} from "./ChatInput";
import { NEW_SESSION_DRAFT_KEY, removeDraft } from "../utils/chat-draft-store";
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
  const [hasInputContent, setHasInputContent] = useState(false);
  const { startSession } = useIPC();
  const isConfigured = useAppStore((state) => state.isConfigured);
  const workingDir = useAppStore((state) => state.workingDir);
  const setShowSettings = useAppStore((state) => state.setShowSettings);
  const setSettingsTab = useAppStore((state) => state.setSettingsTab);
  const appConfig = useAppConfig();
  const projectName = (() => {
    if (!workingDir) return "";
    return workingDir.split(/[\\/]/).filter(Boolean).pop() || "";
  })();
  const showProjectTitle =
    !!projectName && projectName !== DEFAULT_WORKDIR_DIRNAME;
  const chatInputRef = useRef<ChatInputHandle>(null);
  const [attachedKeys, setAttachedKeys] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );

  // 快捷入口只列已启用的技能：禁用后仍显示会插进一个 pi 不展开的 /skill:x，
  // 而输入框把它渲染成「技能已生效」的令牌，等于骗用户。
  //
  // 初值取「全部可用」而不是空集：技能表要等一次 IPC 往返，若初值为空，首屏会
  // 先只画出 2 个工具 chip，数据回来再补上 8 个技能 chip —— 而欢迎页是垂直居中
  // （justify-center），整块高度一变，输入框就跟着上下跳。乐观默认下，常见情况
  // （没禁用任何技能）首屏与加载后逐字一致，位移为零。
  // 代价：真被禁用的技能，它的 chip 会在 IPC 回来后才消失 —— 那点窗口短到无法
  // 点击，换到的是每次打开欢迎页都不抖动。
  const [enabledSkills, setEnabledSkills] = useState<ReadonlySet<string>>(
    () =>
      new Set(
        WELCOME_QUICK_ENTRIES.filter((e) => e.kind === "skill").map(
          (e) => e.skill,
        ),
      ),
  );
  useEffect(() => {
    if (!window.electronAPI?.skills) return;
    window.electronAPI.skills
      .getAll()
      .then((list) =>
        setEnabledSkills(
          new Set(list.filter((s) => s.enabled).map((s) => s.name)),
        ),
      )
      .catch(() => setEnabledSkills(new Set<string>()));
  }, []);

  // 「看图」依赖主进程注册 vision_describe，而它只在配了视觉模型（或登录云、
  // 由服务端兜底）时才注册。这里刻意镜像主进程的判定条件（agent-runner.ts:3247
  // 与 :3266 的两个分支），而不是读云端的登录状态 —— 后者在本组件被
  // tests/model-menu-source.test.ts 逐字禁止，因为它曾经被用来按云模式
  // 锁死思考档（那条守卫是源码文本匹配，连注释里出现该标识符都会触雷）。用
  // appConfig 既避开那条回归路径，也与主进程条件同源。
  const visionAvailable =
    Boolean(
      appConfig?.visionModel?.enabled && appConfig?.visionModel?.model?.trim(),
    ) || Boolean(appConfig?.providers?.["custom:deskwand"]?.apiKey?.trim());

  const visibleEntries = visibleQuickEntries(
    WELCOME_QUICK_ENTRIES,
    enabledSkills,
    visionAvailable,
  );

  const handleQuickEntry = (entry: WelcomeQuickEntry) => {
    if (entry.kind === "skill") {
      chatInputRef.current?.insertSkillChip(entry.skill);
      return;
    }
    // 示例正文由 ChatInput 追加（草稿非空时追加而非覆盖），父组件不读草稿。
    chatInputRef.current?.appendPromptExample(t(entry.promptKey));
  };

  // 稳定引用：它作为 ChatInput 里 effect 的依赖，每次渲染换新会导致死循环。
  const handleAttachmentsChange = useCallback(
    (files: ChatInputAttachedFile[]) =>
      setAttachedKeys((prev) => attachmentKeySet(files, prev)),
    [],
  );

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
        resolveProviderDisplayName(typedKey, providerConfig.name, t) ||
        (meta.provider === "custom"
          ? `${t("api.moreModels")} / ${providerConfig.customProtocol}`
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
  }, [appConfig?.providers, t]);

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
        data.elSelections,
      );
      if (session) {
        chatInputRef.current?.clear(NEW_SESSION_DRAFT_KEY);
        // 兜底：startSession 里 setActiveSession 会让 App 把 WelcomeView 换掉，
        // 若卸载发生在这一行之前，clear() 因 ref 为 null 没跑，卸载 flush 会把
        // 刚发出去的文本写回 __new__ 槽位 —— 下次进欢迎页它就“复活”了。
        // removeDraft 不依赖组件还活着，所以这行能把保证从"靠时序"变成"结构性"。
        removeDraft(NEW_SESSION_DRAFT_KEY);
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
            {showProjectTitle
              ? t("welcome.titleWithProject", { projectName })
              : t("welcome.title")}
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

        {/* 快捷入口 —— 能力发现，不分组、不隐藏 */}
        {visibleEntries.length > 0 && (
          <div className="flex flex-wrap justify-center gap-2">
            {visibleEntries.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => handleQuickEntry(entry)}
                className="inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-surface px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
              >
                {entry.kind === "skill" ? (
                  <Sparkles className="w-3.5 h-3.5 flex-shrink-0" />
                ) : entry.icon === "eye" ? (
                  <Eye className="w-3.5 h-3.5 flex-shrink-0" />
                ) : (
                  <Globe className="w-3.5 h-3.5 flex-shrink-0" />
                )}
                {t(entry.labelKey)}
              </button>
            ))}
          </div>
        )}

        {/* Chat Input — same as ChatView */}
        <ChatInput
          ref={chatInputRef}
          draftKey={NEW_SESSION_DRAFT_KEY}
          onSubmit={handleSubmit}
          disabled={isSubmitting}
          isExpanded={isInputExpanded}
          onToggleExpand={() => setIsInputExpanded((v) => !v)}
          onContentChange={setHasInputContent}
          onAttachmentsChange={handleAttachmentsChange}
          slashMenuDirection="down"
          placeholder={t("welcome.placeholder")}
          cardClassName="rounded-6xl bg-background/60 shadow-elevated px-5 py-5 space-y-4"
          textareaClassName="w-full resize-none bg-transparent border-none outline-none focus:ring-0 text-text-primary placeholder:text-text-muted text-sm leading-relaxed overflow-hidden"
          bottomSlot={
            <ChatInputBottomBar
              onAttach={() => chatInputRef.current?.selectFiles()}
              onAddFiles={(files) => chatInputRef.current?.addFiles(files)}
              attachedKeys={attachedKeys}
              onAttachMenuDismiss={() => chatInputRef.current?.focus()}
              onInsertPromptCommand={(name) =>
                chatInputRef.current?.insertCommandChip(name)
              }
              attachMenuDirection="down"
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
              contextStatusDetails={{
                usedLabel: "0",
                totalLabel: contextWindowTotal,
                cacheHitRate: "--",
              }}
              canStop={false}
              onStop={() => {}}
              isSubmitting={isSubmitting}
              isExpanded={isInputExpanded}
              onToggleExpand={() => setIsInputExpanded((v) => !v)}
              hasInputContent={hasInputContent}
            />
          }
        />
      </div>
    </div>
  );
}
