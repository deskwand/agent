import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
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
import { ContentBlockView } from "./message/ContentBlockView";
import type {
  Message,
  ContentBlock,
  ThinkingLevel,
  ProviderProfileKey,
  ApiProviderConfig,
} from "../types";
import {
  Plug,
  Clock,
  ChevronsDown,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
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
  const [timerTick, setTimerTick] = useState(0);
  const [steeringEvent, setSteeringEvent] = useState<{ turnId: string; text: string } | null>(null);
  const [compactionResult, setCompactionResult] = useState<
    "success" | "failed" | null
  >(null);

  // Real-time elapsed timer for active turn
  useEffect(() => {
    if (!activeTurn) {
      setTimerTick(0);
      return;
    }
    const id = setInterval(() => setTimerTick((t) => t + 1), 200);
    return () => clearInterval(id);
  }, [activeTurn?.turnId]);

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

  const activeTurnElapsedMs = useMemo(() => {
    if (!activeTurn?.startedAt) return 0;
    // Force recalculation on each timerTick
    void timerTick;
    return Date.now() - activeTurn.startedAt;
  }, [activeTurn?.startedAt, timerTick]);

  const appConfig = useAppConfig();
  const contextWindow = useAppStore((s) =>
    activeSessionId
      ? s.sessionStates[activeSessionId]?.contextWindow
      : undefined,
  );
  const sessionState = useAppStore((s) =>
    activeSessionId ? s.sessionStates[activeSessionId] : undefined,
  );
  const toggleTurnCollapsed = useAppStore((s) => s.toggleTurnCollapsed);
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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const isUserAtBottomRef = useRef(true);
  const autoFollowRef = useRef(true);
  const programmaticScrollUntilRef = useRef(0);
  const prevMessageCountRef = useRef(0);
  const prevPartialLengthRef = useRef(0);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRequestRef = useRef<number | null>(null);
  const isScrollingRef = useRef(false);
  const chatInputRef = useRef<ChatInputHandle>(null);

  const hasActiveTurn = Boolean(activeTurn);
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
    // Only show the thinking indicator when the active turn has NOT yet
    // produced any assistant output. After the final stream.message arrives,
    // partialMessage/partialThinking are cleared, but activeTurn remains set
    // until session.status idle — we must not re-show the spinner in that gap.
    const hasAssistantOutput =
      hasActiveTurn &&
      activeTurn &&
      messages.some(
        (m) => m.role === "assistant" && m.turnId === activeTurn.turnId,
      );
    const shouldShowThinkingIndicator =
      hasActiveTurn &&
      !hasAssistantOutput &&
      (!partialMessage || partialMessage.trim() === "") &&
      !partialThinking;
    return resolveInputStatus({
      isCompacting,
      compactionResult,
      steeringText,
      shouldShowThinkingIndicator,
      goalStatus,
    });
  }, [
    isCompacting,
    compactionResult,
    hasActiveTurn,
    partialMessage,
    partialThinking,
    steeringEvent,
    activeTurn?.turnId,
    goalStatus,
    messages,
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
          ? `${API_PROVIDER_PRESETS.custom.name} / ${meta.customProtocol}`
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
    const collapsedTurns = sessionState?.collapsedTurns ?? {};
    const traceByTurn = new Map<
      string,
      Array<{
        message: Message;
        block: ContentBlock;
        index: number;
        allBlocks: ContentBlock[];
      }>
    >();
    const executionTimeByTurn = new Map<string, number>();

    for (const message of displayedMessages) {
      if (
        message.role !== "assistant" ||
        !message.turnId ||
        !Array.isArray(message.content)
      )
        continue;
      const blocks = message.content as ContentBlock[];
      const traceBlocks = blocks
        .map((block, index) => ({ block, index }))
        .filter((item) => isTraceBlock(item.block));
      if (traceBlocks.length > 0) {
        const existing = traceByTurn.get(message.turnId) ?? [];
        existing.push(
          ...traceBlocks.map((item) => ({
            message,
            block: item.block,
            index: item.index,
            allBlocks: blocks,
          })),
        );
        traceByTurn.set(message.turnId, existing);
      }
      if (
        typeof message.executionTimeMs === "number" &&
        Number.isFinite(message.executionTimeMs)
      ) {
        executionTimeByTurn.set(
          message.turnId,
          Math.max(
            executionTimeByTurn.get(message.turnId) ?? 0,
            Math.max(0, message.executionTimeMs),
          ),
        );
      }
    }

    return displayedMessages.map((message, index) => {
      const isStreaming =
        typeof message.id === "string" && message.id.startsWith("partial-");
      const turnId = message.turnId;
      const isActiveTurn = Boolean(turnId) && activeTurn?.turnId === turnId;
      const traceItems = turnId ? (traceByTurn.get(turnId) ?? []) : [];
      const firstAssistantIndex =
        turnId == null
          ? -1
          : displayedMessages.findIndex(
              (item) => item.role === "assistant" && item.turnId === turnId,
            );
      const showTraceEntry =
        !isActiveTurn &&
        message.role === "assistant" &&
        Boolean(turnId) &&
        traceItems.length > 0 &&
        index === firstAssistantIndex;
      const hasNonTraceBlocks =
        message.role !== "assistant" ||
        !Array.isArray(message.content) ||
        message.content.some((block) => !isTraceBlock(block));

      return {
        message,
        isStreaming,
        hideTraceBlocks:
          message.role === "assistant" && Boolean(turnId) && !isActiveTurn,
        showTraceEntry,
        traceItems,
        turnExecutionTimeMs: turnId
          ? executionTimeByTurn.get(turnId)
          : undefined,
        renderMessageCard: isActiveTurn || hasNonTraceBlocks,
        isTurnCollapsed:
          showTraceEntry && turnId
            ? !isStreaming &&
              !(activeTurn?.turnId === turnId) &&
              (collapsedTurns[turnId] ?? true)
            : false,
      };
    });
  }, [activeTurn?.turnId, displayedMessages, sessionState?.collapsedTurns]);

  // Format execution time for display
  const formatExecutionTime = useCallback((ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const minutes = Math.floor(ms / 60000);
    const seconds = ((ms % 60000) / 1000).toFixed(0);
    return `${minutes}m ${seconds}s`;
  }, []);

  const getTraceSummaryLabel = useCallback(
    (turnId: string | undefined, turnExecutionTimeMs?: number) => {
      if (!turnId) return t("messageCard.traceExecuted");
      if (activeTurn?.turnId === turnId) {
        const elapsed = activeTurnElapsedMs;
        if (elapsed > 0) return t("messageCard.traceExecutingWithTime", { time: formatExecutionTime(elapsed) });
        return t("messageCard.traceExecuting");
      }
      if (typeof turnExecutionTimeMs === "number" && turnExecutionTimeMs > 0) {
        return t("messageCard.traceExecutedWithTime", { time: formatExecutionTime(turnExecutionTimeMs) });
      }
      return t("messageCard.traceExecuted");
    },
    [t, activeTurn?.turnId, activeTurnElapsedMs, formatExecutionTime],
  );

  const updateScrollToBottomVisibility = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return true;
    const distanceToBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    const isAtBottom = distanceToBottom <= 80;
    isUserAtBottomRef.current = isAtBottom;
    return isAtBottom;
  }, []);

  const markProgrammaticScroll = useCallback((durationMs: number = 120) => {
    programmaticScrollUntilRef.current = Date.now() + durationMs;
  }, []);

  const syncAutoFollowState = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const isAtBottom = updateScrollToBottomVisibility();
    const isProgrammatic = Date.now() < programmaticScrollUntilRef.current;

    if (isProgrammatic) {
      if (isAtBottom) {
        autoFollowRef.current = true;
      }
      setShowScrollToBottom(false);
      return;
    }

    autoFollowRef.current = isAtBottom;
    setShowScrollToBottom(!autoFollowRef.current);
  }, [updateScrollToBottomVisibility]);

  // Debounced scroll function to prevent scroll conflicts
  const scrollToBottom = useRef(
    (behavior: ScrollBehavior = "auto", immediate: boolean = false) => {
      // Cancel any pending scroll requests
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
        scrollTimeoutRef.current = null;
      }
      if (scrollRequestRef.current) {
        cancelAnimationFrame(scrollRequestRef.current);
        scrollRequestRef.current = null;
      }

      const performScroll = () => {
        if (!autoFollowRef.current) return;

        // Mark as scrolling to prevent concurrent scrolls
        isScrollingRef.current = true;
        markProgrammaticScroll(behavior === "smooth" ? 400 : 120);

        messagesEndRef.current?.scrollIntoView({ behavior });

        // Reset scrolling flag after a short delay
        setTimeout(
          () => {
            isScrollingRef.current = false;
          },
          behavior === "smooth" ? 300 : 50,
        );
      };

      if (immediate) {
        performScroll();
      } else {
        // Use RAF + timeout for debouncing
        scrollRequestRef.current = requestAnimationFrame(() => {
          scrollTimeoutRef.current = setTimeout(performScroll, 16); // ~1 frame delay
        });
      }
    },
  ).current;

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    syncAutoFollowState();
    // 用户阅读旧消息时，阻止新消息自动滚动打断视线
    const onScroll = () => syncAutoFollowState();
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, [syncAutoFollowState]);

  useEffect(() => {
    updateScrollToBottomVisibility();
  }, [
    updateScrollToBottomVisibility,
    messages.length,
    partialMessage.length,
    partialThinking.length,
    displayedMessages.length,
  ]);

  useEffect(() => {
    const messageCount = messages.length;
    const partialLength = partialMessage.length + partialThinking.length;
    const hasNewMessage = messageCount !== prevMessageCountRef.current;
    const isStreamingTick =
      partialLength !== prevPartialLengthRef.current && !hasNewMessage;

    // Streaming tick: keep following unless the user explicitly scrolled away
    if (isStreamingTick && autoFollowRef.current) {
      const container = scrollContainerRef.current;
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    }

    // Own new message: scroll directly to bottom, bypassing scroll guards
    // (useEffect B runs after useEffect A flips isUserAtBottomRef=false,
    //  so we must scroll before the isUserAtBottomRef check)
    const isOwnNewMessage =
      hasNewMessage && messages[messages.length - 1]?.role === "user";
    if (isOwnNewMessage) {
      autoFollowRef.current = true;
      const container = scrollContainerRef.current;
      if (container) {
        markProgrammaticScroll(400);
        container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
      }
    }

    // Skip scroll if already scrolling (prevent non-streaming conflicts)
    if (isScrollingRef.current) {
      prevMessageCountRef.current = messageCount;
      prevPartialLengthRef.current = partialLength;
      return;
    }

    if (autoFollowRef.current) {
      if (!isStreamingTick && !isOwnNewMessage) {
        // New message from others or message change - keep following until user scrolls away
        const behavior: ScrollBehavior = hasNewMessage ? "smooth" : "auto";
        scrollToBottom(behavior, false);
      }
    }

    prevMessageCountRef.current = messageCount;
    prevPartialLengthRef.current = partialLength;
  }, [messages.length, partialMessage.length, partialThinking.length]);

  // Additional scroll trigger for content height changes (e.g., TodoWrite expand/collapse)
  useEffect(() => {
    const container = scrollContainerRef.current;
    const messagesContainer = messagesContainerRef.current;
    if (!container || !messagesContainer) return;

    const resizeObserver = new ResizeObserver(() => {
      // Don't interfere with ongoing scrolls
      if (!isScrollingRef.current && autoFollowRef.current) {
        // Scroll to bottom when content height changes while auto-follow is active
        scrollToBottom("auto", false);
      }
    });

    resizeObserver.observe(messagesContainer);

    return () => {
      resizeObserver.disconnect();
    };
  }, []); // ResizeObserver is stable — no need to recreate on message count changes

  // Cleanup scroll timeouts on unmount
  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
      if (scrollRequestRef.current) {
        cancelAnimationFrame(scrollRequestRef.current);
      }
    };
  }, []);

  useEffect(() => {
    chatInputRef.current?.focus();
    // 重置跟随状态，覆盖旧会话中用户手动上滚的残留
    autoFollowRef.current = true;
    setIsInputExpanded(false);
    const rafId = requestAnimationFrame(() => {
      scrollToBottom("auto", true);
    });
    return () => cancelAnimationFrame(rafId);
  }, [activeSessionId]);

  // Scroll to bottom when input expands, so messages area follows
  useEffect(() => {
    if (!isInputExpanded) return;
    const raf = requestAnimationFrame(() => {
      scrollToBottomByButton();
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

  const scrollToBottomByButton = () => {
    autoFollowRef.current = true;
    isUserAtBottomRef.current = true;
    setShowScrollToBottom(false);
    markProgrammaticScroll(400);
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  if (!activeSession) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted">
        <span>{t("chat.loadingConversation")}</span>
      </div>
    );
  }

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
        <div
          ref={scrollContainerRef}
          className="h-full min-h-0 overflow-y-auto overflow-x-hidden"
          style={{ overflowAnchor: "none" }}
        >
          <div
            ref={messagesContainerRef}
            className="w-full max-w-[920px] mx-auto py-8 px-5 lg:px-8 space-y-5"
          >
            {displayedMessages.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-28 text-text-muted space-y-3 text-center">
                <p className="text-xs uppercase tracking-[0.16em] text-text-muted/80">
                  DeskWand
                </p>
                <p className="text-base text-text-secondary">
                  {t("chat.startConversation")}
                </p>
              </div>
            ) : (
              turnEntries.map(
                ({
                  message,
                  isStreaming,
                  hideTraceBlocks,
                  showTraceEntry,
                  traceItems,
                  turnExecutionTimeMs,
                  isTurnCollapsed,
                  renderMessageCard,
                }) => (
                  <div key={message.id} className="space-y-1.5">
                    {showTraceEntry && message.turnId && (
                      <div className="space-y-2">
                        <button
                          onClick={() =>
                            toggleTurnCollapsed(
                              message.sessionId,
                              message.turnId!,
                            )
                          }
                          className="inline-flex max-w-full items-center gap-1 px-0 py-1 text-left hover:opacity-70 transition-opacity"
                        >
                          <Clock className="w-3 h-3 text-text-muted flex-shrink-0" />
                          <span className="text-xs font-medium text-text-muted truncate">
                            {getTraceSummaryLabel(
                              message.turnId,
                              turnExecutionTimeMs,
                            )}
                          </span>
                          {isTurnCollapsed ? (
                            <ChevronRight className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
                          ) : (
                            <ChevronDown className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
                          )}
                        </button>

                        {!isTurnCollapsed && (
                          <div className="rounded-2xl border border-border-subtle bg-background/40 overflow-hidden animate-fade-in">
                            <div className="px-0 py-0 space-y-1.5">
                              {traceItems.map((item, index) => (
                                <ContentBlockView
                                  key={
                                    "id" in item.block
                                      ? `${item.message.id}-${(item.block as { id: string }).id}`
                                      : `${item.message.id}-trace-${item.block.type}-${item.index}-${index}`
                                  }
                                  block={item.block}
                                  isUser={false}
                                  isStreaming={isStreaming}
                                  allBlocks={item.allBlocks}
                                  message={item.message}
                                />
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {renderMessageCard && (
                      <MessageCard
                        message={message}
                        isStreaming={isStreaming}
                        hideTraceBlocks={hideTraceBlocks}
                      />
                    )}
                  </div>
                ),
              )
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {showScrollToBottom && (
          <button
            type="button"
            onClick={scrollToBottomByButton}
            aria-label="Scroll to bottom"
            className="absolute right-5 lg:right-8 bottom-6 z-20 w-10 h-10 rounded-full bg-surface text-text-secondary hover:bg-surface-hover hover:text-text-primary shadow-elevated transition-colors flex items-center justify-center"
          >
            <ChevronsDown className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Input */}
      <div className="bg-transparent backdrop-blur-md">
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
            cardClassName="p-3.5 rounded-6xl bg-background/60 backdrop-blur-sm shadow-elevated"
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
