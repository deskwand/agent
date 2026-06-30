import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { List, useDynamicRowHeight } from "react-window";
import {
  useActiveSessionId,
  useCurrentSession,
  useActiveSessionMessages,
  useActivePartialContent,
  useActiveTurn,
  usePendingTurns,
  useAppConfig,
} from "../store/selectors";
import { useAppStore } from "../store";
import { useIPC } from "../hooks/useIPC";
import { profileKeyToProvider } from "../hooks/useApiConfigState";
import { MessageCard } from "./MessageCard";
import type {
  Message,
  ContentBlock,
  ThinkingLevel,
  ProviderProfileKey,
  ApiProviderConfig,
} from "../types";
import { Plug, ChevronsDown } from "lucide-react";
import { API_PROVIDER_PRESETS } from "../../shared/api-model-presets";
import {
  ChatInput,
  type ChatInputHandle,
  type ChatInputSubmitData,
} from "./ChatInput";
import { ChatInputBottomBar } from "./ChatInputBottomBar";
import { ChatInputStatusBar, resolveInputStatus } from "./ChatInputStatusBar";

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

function isTraceBlock(block: ContentBlock): boolean {
  return (
    block.type === "thinking" ||
    block.type === "tool_use" ||
    block.type === "tool_result"
  );
}

function appendMergedLiveBlock(
  target: ContentBlock[],
  block: ContentBlock,
): void {
  const lastBlock = target[target.length - 1];

  if (block.type === "text") {
    const text = (block as { type: "text"; text: string }).text || "";
    if (!text) return;
    if (lastBlock?.type === "text") {
      (lastBlock as { type: "text"; text: string }).text += text;
      return;
    }
    target.push({ ...block, text });
    return;
  }

  if (block.type === "thinking") {
    const thinking =
      (block as { type: "thinking"; thinking: string }).thinking || "";
    if (!thinking) return;
    if (lastBlock?.type === "thinking") {
      (lastBlock as { type: "thinking"; thinking: string }).thinking +=
        thinking;
      return;
    }
    target.push({ ...block, thinking });
    return;
  }

  target.push(block);
}

export function ChatView() {
  const { t } = useTranslation();
  // Scoped selectors — each subscription only re-renders when its slice changes
  const activeSessionId = useActiveSessionId();
  const activeSession = useCurrentSession();
  const messages = useActiveSessionMessages();
  const { partialMessage, partialThinking } = useActivePartialContent();
  const activeTurn = useActiveTurn();
  const pendingTurns = usePendingTurns();
  const [steeringEvent, setSteeringEvent] = useState<{ turnId: string; text: string } | null>(null);
  const [compactionResult, setCompactionResult] = useState<
    "success" | "failed" | null
  >(null);

  // Clear steering event when active turn changes
  useEffect(() => {
    setSteeringEvent((prev) =>
      prev && activeTurn && prev.turnId === activeTurn.turnId ? prev : null,
    );
  }, [activeTurn?.turnId]);

  // Auto-dismiss compaction result after timeout
  useEffect(() => {
    if (!compactionResult) return;
    const timeoutMs = compactionResult === "success" ? 3000 : 5000;
    const id = setTimeout(() => setCompactionResult(null), timeoutMs);
    return () => clearTimeout(id);
  }, [compactionResult]);

  const appConfig = useAppConfig();
  const contextWindow = useAppStore((s) =>
    activeSessionId
      ? s.sessionStates[activeSessionId]?.contextWindow
      : undefined,
  );
  const sessionState = useAppStore((s) =>
    activeSessionId ? s.sessionStates[activeSessionId] : undefined,
  );
  const setTraceExpandedOverride = useAppStore(
    (s) => s.setTraceExpandedOverride,
  );
  const setGlobalNotice = useAppStore((s) => s.setGlobalNotice);
  const updateSession = useAppStore((s) => s.updateSession);
  const clearActiveTurn = useAppStore((s) => s.clearActiveTurn);
  const {
    continueSession,
    stopSession,
    setSessionThinkingLevel,
    setSessionProviderModel,
    isElectron,
  } = useIPC();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isInputExpanded, setIsInputExpanded] = useState(false);
  const [hasInput, setHasInput] = useState(false);
  const isSteerRef = useRef(false);
  const [isCompacting, setIsCompacting] = useState(false);
  const setGitChangeCount = useAppStore((s) => s.setGitChangeCount);

  // Active session cwd for git diff detection
  const activeSessionCwd = useAppStore((s) => {
    if (!activeSessionId) return undefined;
    const session = (s.sessions as { id: string; cwd?: string | null }[]).find(
      (ses) => ses.id === activeSessionId,
    );
    return session?.cwd || undefined;
  });

  // Check git changes for code review button (refresh on session switch + window focus)
  const checkGitChanges = useCallback(() => {
    if (isElectron && activeSessionCwd && window.electronAPI?.git) {
      window.electronAPI.git.hasChanges(activeSessionCwd).then((info) => {
        setGitChangeCount(info.isRepo ? info.changeCount : 0);
      });
    } else {
      setGitChangeCount(0);
    }
  }, [activeSessionCwd, isElectron]);

  useEffect(() => {
    checkGitChanges();
    window.addEventListener("focus", checkGitChanges);
    return () => window.removeEventListener("focus", checkGitChanges);
  }, [checkGitChanges]);

  const [activeConnectors, setActiveConnectors] = useState<
    { id: string; name: string; connected: boolean; toolCount: number }[]
  >([]);
  const [showConnectorLabel, setShowConnectorLabel] = useState(true);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  const headerRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const connectorMeasureRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const listRef = useRef<{ element: HTMLDivElement; scrollToRow(config: { index: number; align?: string; behavior?: string }): void } | null>(null);
  const dynamicRowHeight = useDynamicRowHeight({
    defaultRowHeight: 200,
    key: activeSessionId ?? undefined,
  });
  const isUserAtBottomRef = useRef(true);
  const autoFollowRef = useRef(true);
  const prevMessageCountRef = useRef(0);
  const prevPartialLengthRef = useRef(0);
  const isSmoothScrollingRef = useRef(false);
  const chatInputRef = useRef<ChatInputHandle>(null);

  const hasActiveTurn = Boolean(activeTurn);

  // Trace expand/collapse: default from project mode, user override wins
  const defaultTraceExpanded = activeSession?.isProjectMode ?? false;
  const effectiveTraceExpanded =
    sessionState?.traceExpandedOverride ?? defaultTraceExpanded;

  const hasTraceContent = useMemo(() => {
    return messages.some(
      (m) =>
        m.role === "assistant" &&
        Array.isArray(m.content) &&
        m.content.some((b) => isTraceBlock(b)),
    );
  }, [messages]);

  const handleToggleTraceExpanded = useCallback(() => {
    if (!activeSessionId) return;
    setTraceExpandedOverride(activeSessionId, !effectiveTraceExpanded);
  }, [activeSessionId, effectiveTraceExpanded, setTraceExpandedOverride]);
  const goalStatus = useAppStore((s) =>
    activeSessionId
      ? s.sessionStates[activeSessionId]?.goalStatus
      : undefined,
  );

  const pendingCount = pendingTurns.length;
  const isSessionRunning = activeSession?.status === "running";
  const canStop = isSessionRunning || hasActiveTurn || pendingCount > 0;

  const inputStatus = useMemo(() => {
    const steeringText =
      steeringEvent && activeTurn && steeringEvent.turnId === activeTurn.turnId
        ? steeringEvent.text.trim().replace(/\s+/g, " ").slice(0, 120)
        : "";
    // Mirror the stop button: whenever canStop is true the status bar
    // must show a non-null indicator so the user never sees a blank bar
    // while the session is running / a turn is active or pending.
    const hasStreamingText = !!partialMessage?.trim();
    return resolveInputStatus({
      isSending: isSubmitting && !canStop,
      isCompacting,
      compactionResult,
      steeringText,
      // Guard with hasActiveTurn: once the turn ends we don't show
      // "thinking" during the brief idle-window before session settles.
      shouldShowThinkingIndicator: canStop && hasActiveTurn && !hasStreamingText,
      isResponding: canStop && hasStreamingText,
      goalStatus,
    });
  }, [
    isCompacting,
    compactionResult,
    canStop,
    hasActiveTurn,
    partialMessage,
    steeringEvent,
    activeTurn?.turnId,
    goalStatus,
  ]);

  const lastInputTokens = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const value = messages[i].tokenUsage?.totalPromptInput;
      if (value && value > 0) return value;
    }
    return 0;
  }, [messages]);
  const latestAssistantUsage = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role !== "assistant") continue;
      if (!msg.tokenUsage?.totalPromptInput) continue;
      return msg.tokenUsage;
    }
    return undefined;
  }, [messages]);
  const contextUsagePercentage =
    contextWindow && contextWindow > 0
      ? Math.min((lastInputTokens / contextWindow) * 100, 100)
      : 0;
  const contextRingColorClass =
    contextUsagePercentage > 95
      ? "text-error"
      : contextUsagePercentage > 80
        ? "text-warning"
        : "text-accent";
  const cacheHitRate =
    typeof latestAssistantUsage?.cacheRead === "number" &&
    typeof latestAssistantUsage?.totalPromptInput === "number" &&
    latestAssistantUsage.totalPromptInput > 0
      ? `${((latestAssistantUsage.cacheRead / latestAssistantUsage.totalPromptInput) * 100).toFixed(1)}%`
      : "--";
  const contextUsageTooltip = t("chat.contextUsageTooltip", {
    percentage: Math.round(contextUsagePercentage),
    used: formatTokenCount(lastInputTokens),
    total: formatTokenCount(contextWindow || 0),
    input:
      typeof latestAssistantUsage?.totalPromptInput === "number"
        ? formatTokenCount(latestAssistantUsage.totalPromptInput)
        : "--",
    output:
      typeof latestAssistantUsage?.output === "number"
        ? formatTokenCount(latestAssistantUsage.output)
        : "--",
    cacheRead:
      typeof latestAssistantUsage?.cacheRead === "number"
        ? formatTokenCount(latestAssistantUsage.cacheRead)
        : "--",
    promptNonCache:
      typeof latestAssistantUsage?.input === "number"
        ? formatTokenCount(latestAssistantUsage.input)
        : "--",
    cacheHitRate,
  });
  const thinkingLevel = (activeSession?.thinkingLevel ||
    "medium") as ThinkingLevel;
  const thinkingLevelOptions: ThinkingLevel[] = [
    "off",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
  ];
  const activeProviderProfileKey = (activeSession?.providerProfileKey ||
    appConfig?.activeProviderKey ||
    "openrouter") as ProviderProfileKey;
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
  const activeModel = activeSession?.model || appConfig?.model || "";

  const displayedMessages = useMemo(() => {
    if (!activeSessionId || !activeTurn?.userMessageId || !activeTurn.turnId)
      return messages;

    const anchorIndex = messages.findIndex(
      (message) => message.id === activeTurn.userMessageId,
    );
    if (anchorIndex === -1) return messages;

    let rangeEnd = anchorIndex + 1;
    while (rangeEnd < messages.length) {
      if (messages[rangeEnd].role === "user") break;
      rangeEnd += 1;
    }

    const aggregatedBlocks: ContentBlock[] = [];
    let hasActiveTurnAssistantMessage = false;
    let executionTimeMs: number | undefined;

    for (let i = anchorIndex + 1; i < rangeEnd; i += 1) {
      const message = messages[i];
      if (
        message.role !== "assistant" ||
        message.turnId !== activeTurn.turnId ||
        !Array.isArray(message.content)
      ) {
        continue;
      }
      hasActiveTurnAssistantMessage = true;
      for (const block of message.content) {
        appendMergedLiveBlock(aggregatedBlocks, block);
      }
      if (
        typeof message.executionTimeMs === "number" &&
        Number.isFinite(message.executionTimeMs)
      ) {
        executionTimeMs = Math.max(
          executionTimeMs ?? 0,
          Math.max(0, message.executionTimeMs),
        );
      }
    }

    if (partialThinking) {
      appendMergedLiveBlock(aggregatedBlocks, {
        type: "thinking",
        thinking: partialThinking,
      });
    }
    if (partialMessage) {
      appendMergedLiveBlock(aggregatedBlocks, {
        type: "text",
        text: partialMessage,
      });
    }

    const hasStreamingContent = Boolean(partialThinking || partialMessage);
    if (!hasActiveTurnAssistantMessage && !hasStreamingContent) return messages;

    const streamingMessage: Message = {
      id: `partial-${activeSessionId}-${activeTurn.turnId}`,
      sessionId: activeSessionId,
      role: "assistant",
      content: aggregatedBlocks,
      timestamp: Date.now(),
      turnId: activeTurn.turnId,
      executionTimeMs,
    };

    const before = messages.slice(0, anchorIndex + 1);
    const after = messages.slice(rangeEnd);

    return [...before, streamingMessage, ...after];
  }, [
    activeSessionId,
    activeTurn?.turnId,
    activeTurn?.userMessageId,
    messages,
    partialMessage,
    partialThinking,
  ]);

  const turnEntries = useMemo(() => {
    return displayedMessages.map((message) => {
      const isStreaming =
        typeof message.id === "string" && message.id.startsWith("partial-");
      const turnId = message.turnId;
      return {
        message,
        isStreaming,
        hideTraceBlocks:
          message.role === "assistant" && Boolean(turnId) && !effectiveTraceExpanded,
      };
    });
  }, [displayedMessages, effectiveTraceExpanded]);

  const syncAutoFollowState = useCallback(() => {
    const container = listRef.current?.element;
    if (!container) return;
    const distanceToBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    const isAtBottom = distanceToBottom <= 80;
    isUserAtBottomRef.current = isAtBottom;
    autoFollowRef.current = isAtBottom;
    setShowScrollToBottom(!isAtBottom);
  }, []);

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = "auto") => {
      if (!autoFollowRef.current) return;
      const container = listRef.current?.element;
      if (!container) return;
      if (behavior === "smooth") {
        isSmoothScrollingRef.current = true;
        container.scrollTo({
          top: container.scrollHeight,
          behavior: "smooth",
        });
        setTimeout(() => { isSmoothScrollingRef.current = false; }, 350);
      } else {
        container.scrollTop = container.scrollHeight;
      }
    },
    [],
  );

  // Sync scroll state on manual scroll; pass onScroll/onWheel to List props below
  const handleVirtualScroll = useCallback(() => {
    syncAutoFollowState();
  }, [syncAutoFollowState]);

  const handleVirtualWheel = useCallback((e: React.WheelEvent) => {
    if (e.deltaY < 0) autoFollowRef.current = false;
  }, []);

  useEffect(() => {
    const container = listRef.current?.element;
    if (!container) return;
    syncAutoFollowState();
  }, [syncAutoFollowState, messages.length]);

  // Streaming scroll: keep following during token ticks unless user scrolled away
  useEffect(() => {
    const messageCount = messages.length;
    const partialLength = partialMessage.length + partialThinking.length;
    const hasNewMessage = messageCount !== prevMessageCountRef.current;
    const isStreamingTick =
      partialLength !== prevPartialLengthRef.current && !hasNewMessage;

    if (isStreamingTick && autoFollowRef.current && !isSmoothScrollingRef.current) {
      const container = listRef.current?.element;
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    }

    const isOwnNewMessage =
      hasNewMessage && messages[messages.length - 1]?.role === "user";
    if (isOwnNewMessage) {
      autoFollowRef.current = true;
      const container = listRef.current?.element;
      if (container) {
        container.scrollTo({
          top: container.scrollHeight,
          behavior: "smooth",
        });
      }
    }

    if (autoFollowRef.current && !isStreamingTick && !isOwnNewMessage && hasNewMessage) {
      scrollToBottom(hasNewMessage ? "smooth" : "auto");
    }

    prevMessageCountRef.current = messageCount;
    prevPartialLengthRef.current = partialLength;
  }, [
    messages.length,
    partialMessage.length,
    partialThinking.length,
    scrollToBottom,
  ]);

  // react-window's useDynamicRowHeight handles content height changes via ResizeObserver internally.
  // No separate ResizeObserver needed.

  // Cleanup scroll state on unmount
  useEffect(() => {
    return () => {
      prevMessageCountRef.current = 0;
      prevPartialLengthRef.current = 0;
    };
  }, []);

  useEffect(() => {
    chatInputRef.current?.focus();
    // 重置跟随状态，覆盖旧会话中用户手动上滚的残留
    autoFollowRef.current = true;
    setIsInputExpanded(false);
    const rafId = requestAnimationFrame(() => {
      scrollToBottom("auto");
    });
    return () => cancelAnimationFrame(rafId);
  }, [activeSessionId]);

  // Scroll to bottom when input expands, so messages area follows
  useEffect(() => {
    if (!isInputExpanded) return;
    const raf = requestAnimationFrame(() => {
      scrollToBottom("smooth");
    });
    return () => cancelAnimationFrame(raf);
  }, [isInputExpanded]);

  // Load active MCP connectors
  useEffect(() => {
    if (isElectron && typeof window !== "undefined" && window.electronAPI) {
      const loadConnectors = async () => {
        try {
          const statuses = await window.electronAPI.mcp.getServerStatus();
          const active =
            (
              statuses as Array<{
                id: string;
                name: string;
                connected: boolean;
                toolCount: number;
              }>
            )?.filter((s) => s.connected && s.toolCount > 0) || [];
          setActiveConnectors(active);
        } catch (err) {
          console.error("Failed to load MCP connectors:", err);
        }
      };
      loadConnectors();
      // Refresh every 5 seconds
      const interval = setInterval(loadConnectors, 5000);
      return () => clearInterval(interval);
    }
  }, [isElectron]);

  useEffect(() => {
    const titleEl = titleRef.current;
    const headerEl = headerRef.current;
    const measureEl = connectorMeasureRef.current;
    if (!titleEl || !headerEl || !measureEl) {
      setShowConnectorLabel(true);
      return;
    }
    const updateLabelVisibility = () => {
      const isTruncated = titleEl.scrollWidth > titleEl.clientWidth;
      const headerStyle = window.getComputedStyle(headerEl);
      const paddingLeft = Number.parseFloat(headerStyle.paddingLeft) || 0;
      const paddingRight = Number.parseFloat(headerStyle.paddingRight) || 0;
      const contentWidth = headerEl.clientWidth - paddingLeft - paddingRight;
      const titleWidth = titleEl.getBoundingClientRect().width;
      const rightColumnWidth = Math.max(0, (contentWidth - titleWidth) / 2);
      const connectorFullWidth = measureEl.getBoundingClientRect().width;
      setShowConnectorLabel(
        !isTruncated && rightColumnWidth >= connectorFullWidth,
      );
    };
    updateLabelVisibility();
    const observer = new ResizeObserver(() => {
      updateLabelVisibility();
    });
    observer.observe(titleEl);
    observer.observe(headerEl);
    return () => observer.disconnect();
  }, [activeSession?.title, activeConnectors.length]);

  const handleSubmit = async (data: ChatInputSubmitData) => {
    if (!activeSessionId || isSubmitting) return;

    const rawText = data.text.trim();
    if (!rawText && data.images.length === 0 && data.files.length === 0) return;

    // Steering path: ephemeral turn-level event (not a chat message)
    if (isSteerRef.current) {
      isSteerRef.current = false;
      if (isElectron) {
        window.electronAPI.send({
          type: "session.steer",
          payload: { sessionId: activeSessionId, prompt: rawText },
        });
      }
      if (activeTurn?.turnId) {
        setSteeringEvent({ turnId: activeTurn.turnId, text: rawText });
      }
      chatInputRef.current?.clear();
      setHasInput(false);
      setTimeout(() => chatInputRef.current?.focus(), 0);
      return;
    }

    // Normal send path
    setIsSubmitting(true);
    try {
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

      if (rawText) {
        contentBlocks.push({
          type: "text",
          text: rawText,
        });
      }

      await continueSession(
        activeSessionId,
        contentBlocks,
        activeSession?.providerProfileKey,
        activeSession?.model,
      );
      chatInputRef.current?.clear();
      setHasInput(false);
    } finally {
      setIsSubmitting(false);
      setTimeout(() => chatInputRef.current?.focus(), 0);
    }
  };

  const handleCompact = async (instructions?: string) => {
    if (!activeSessionId || isCompacting || hasActiveTurn || !isElectron) {
      return;
    }

    setCompactionResult(null);
    setIsCompacting(true);

    try {
      const res = await window.electronAPI!.invoke<{
        success: boolean;
        status?: string;
      }>({
        type: "session.compact",
        payload: { sessionId: activeSessionId, instructions },
      });
      if (!res?.success) {
        setCompactionResult("failed");
        setGlobalNotice({
          id: `compact-err-${Date.now()}`,
          type: "error",
          message: t("chat.compactFailed"),
        });
        return;
      }
      if (res?.status === "already-compacted") {
        setCompactionResult("success");
        return;
      }
      if (res?.status === "skipped") {
        return;
      }
    } catch {
      setCompactionResult("failed");
      setGlobalNotice({
        id: `compact-err-${Date.now()}`,
        type: "error",
        message: t("chat.compactFailed"),
      });
      return;
    } finally {
      setIsCompacting(false);
    }
    setCompactionResult("success");
  };

  const handleCommand = (action: string) => {
    if (action === "compact") handleCompact();
  };

  const handleStop = () => {
    if (canStop) {
      if (activeSessionId) {
        stopSession(activeSessionId);
        updateSession(activeSessionId, { status: "idle" });
        clearActiveTurn(activeSessionId);
      }
      return;
    }
    chatInputRef.current?.submit();
  };

  const handleSteer = useCallback(() => {
    isSteerRef.current = true;
    chatInputRef.current?.submit();
  }, []);

  if (!activeSession) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted">
        <span>{t("chat.loadingConversation")}</span>
      </div>
    );
  }

  const MessageRow = useCallback(
    ({
      index,
      style,
      turnEntries: entries,
    }: {
      index: number;
      style: React.CSSProperties;
      turnEntries: typeof turnEntries;
    }) => {
      const entry = entries[index];
      if (!entry) return null;
      return (
        <div style={style}>
          <div className="chat-message-item space-y-1.5 py-2.5">
            <MessageCard
              message={entry.message}
              isStreaming={entry.isStreaming}
              hideTraceBlocks={entry.hideTraceBlocks}
            />
          </div>
        </div>
      );
    },
    [],
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-background">
      <div ref={headerRef} className="hidden" />
      <h2 ref={titleRef} className="sr-only">
        {activeSession.title}
      </h2>
      <div ref={connectorMeasureRef} aria-hidden="true" className="hidden" />
      <div className="hidden" aria-hidden="true">
        {showConnectorLabel && activeConnectors.length >= 0 && (
          <Plug className="w-0 h-0" />
        )}
      </div>

      {/* Messages */}
      <div className="relative flex-1 min-h-0 min-w-0">
        {displayedMessages.length === 0 ? (
          <div className="h-full w-full max-w-[920px] mx-auto px-5 lg:px-8 flex items-center justify-center">
            <div className="flex flex-col items-center text-text-muted space-y-3 text-center">
              <p className="text-xs uppercase tracking-[0.16em] text-text-muted/80">
                DeskWand
              </p>
              <p className="text-base text-text-secondary">
                {t("chat.startConversation")}
              </p>
            </div>
          </div>
        ) : (
          <div className="h-full w-full max-w-[920px] mx-auto px-5 lg:px-8">
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            <List
              {...{
                listRef: listRef as any,
                rowComponent: MessageRow as any,
                rowProps: { turnEntries } as any,
                rowCount: turnEntries.length,
                rowHeight: dynamicRowHeight as any,
                className: "h-full min-h-0",
                style: { overflowAnchor: "none" },
                overscanCount: 3,
                onScroll: handleVirtualScroll as any,
                onWheel: handleVirtualWheel as any,
              }}
            />
          </div>
        )}

        {showScrollToBottom && (
          <button
            type="button"
            onClick={() => scrollToBottom("smooth")}
            aria-label="Scroll to bottom"
            className="absolute right-5 lg:right-8 bottom-6 z-20 w-10 h-10 rounded-full bg-surface text-text-secondary hover:bg-surface-hover hover:text-text-primary shadow-elevated transition-colors flex items-center justify-center"
          >
            <ChevronsDown className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Input */}
      <div className="bg-transparent">
        <div className="max-w-[920px] mx-auto px-5 lg:px-8 pt-1">
          <ChatInputStatusBar status={inputStatus} />
        </div>
        <div className="max-w-[920px] mx-auto px-5 lg:px-8 pt-0.5 pb-5">
          <ChatInput
            ref={chatInputRef}
            onSubmit={handleSubmit}
            onCompact={handleCompact}
            onCommand={handleCommand}
            onInputChange={setHasInput}
            disabled={isSubmitting || isCompacting}
            isExpanded={isInputExpanded}
            onToggleExpand={() => setIsInputExpanded((v) => !v)}
            placeholder={t("chat.typeMessage")}
            cardClassName="p-3.5 rounded-6xl bg-background/60 shadow-elevated"
            textareaClassName="w-full resize-none bg-transparent border-none outline-none text-text-primary placeholder:text-text-muted text-sm leading-relaxed py-2 overflow-hidden"
            bottomSlot={
              <ChatInputBottomBar
                onAttach={() => chatInputRef.current?.selectFiles()}
                attachTitle={t("welcome.attachFiles")}
                model={activeModel}
                modelOptions={modelOptions}
                activeProviderProfileKey={activeProviderProfileKey}
                onSelectModel={(profileKey, modelId) => {
                  if (!activeSession) return;
                  // Validate modelId exists in modelOptions before applying
                  const group = modelOptions.find(g => g.profileKey === profileKey);
                  if (!group?.items.some(i => i.id === modelId)) return;
                  setSessionProviderModel(
                    activeSession.id,
                    profileKey,
                    modelId,
                  );
                  // ponytail: project → localStorage only, global → electron-store
                  if (activeSessionCwd) {
                    try {
                      localStorage.setItem(
                        "deskwand.pm." + encodeURIComponent(activeSessionCwd),
                        JSON.stringify({ p: profileKey, m: modelId, t: thinkingLevel }),
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
                modelMenuDisabled={!activeSession || modelOptions.length === 0}
                thinkingLevel={thinkingLevel}
                thinkingLevelOptions={thinkingLevelOptions}
                onSelectThinkingLevel={(level) => {
                  setSessionThinkingLevel(activeSession.id, level);
                  // ponytail: project → localStorage only, global → electron-store
                  if (activeSessionCwd) {
                    try {
                      localStorage.setItem(
                        "deskwand.pm." + encodeURIComponent(activeSessionCwd),
                        JSON.stringify({ p: activeProviderProfileKey, m: activeModel, t: level }),
                      );
                    } catch {
                      /* ignore */
                    }
                  } else {
                    window.electronAPI.config.save({ thinkingLevel: level });
                  }
                }}
                contextUsagePercentage={contextUsagePercentage}
                contextRingColorClass={contextRingColorClass}
                contextUsageTooltip={contextUsageTooltip}
                canStop={canStop}
                onStop={handleStop}
                isSubmitting={isSubmitting}
                isExpanded={isInputExpanded}
                onToggleExpand={() => setIsInputExpanded((v) => !v)}
                onSteer={handleSteer}
                hasInput={hasInput}
                traceExpanded={effectiveTraceExpanded}
                onToggleTrace={
                  hasTraceContent || hasActiveTurn
                    ? handleToggleTraceExpanded
                    : undefined
                }
              />
            }
          />
        </div>
      </div>
    </div>
  );
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
