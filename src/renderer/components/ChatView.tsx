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
import type {
  Message,
  ContentBlock,
  ThinkingLevel,
  ProviderProfileKey,
  ApiProviderConfig,
} from "../types";
import { Plug, ChevronsDown, Loader2 } from "lucide-react";
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

export interface TurnRange {
  start: number;
  end: number;
}

export function buildTurnRanges(messages: Message[]): TurnRange[] {
  if (messages.length === 0) return [];

  const userIndexes = messages.flatMap((message, index) =>
    message.role === "user" ? [index] : [],
  );

  if (userIndexes.length === 0) {
    // System-only conversation (for example a preamble) — treat as a single turn.
    return [{ start: 0, end: messages.length }];
  }

  return userIndexes.map((userIndex, index) => ({
    start: index === 0 ? 0 : userIndex,
    end: userIndexes[index + 1] ?? messages.length,
  }));
}

export function getInitialVisibleTurnStart(
  totalTurns: number,
  initialVisibleTurns: number,
): number {
  return Math.max(totalTurns - initialVisibleTurns, 0);
}

export function getPreviousVisibleTurnStart(
  currentStart: number,
  prependTurns: number,
): number {
  return Math.max(currentStart - prependTurns, 0);
}

export function getPrependedVisibleTurnStart(
  currentStart: number,
  turnCount: number,
  prependTurns: number,
): number {
  if (turnCount <= 0) return 0;
  return getPreviousVisibleTurnStart(
    Math.min(currentStart, turnCount - 1),
    prependTurns,
  );
}

export function getEffectiveVisibleTurnStart(
  activeSessionId: string | null,
  initializedSessionId: string | null,
  turnCount: number,
  visibleTurnStartIndex: number,
  initialVisibleTurns: number,
): number {
  if (turnCount === 0) return 0;
  if (
    shouldInitializeVisibleTurns(
      activeSessionId,
      initializedSessionId,
      turnCount,
    )
  ) {
    return getInitialVisibleTurnStart(turnCount, initialVisibleTurns);
  }
  return Math.min(visibleTurnStartIndex, turnCount - 1);
}

export function getVisibleMessageStartIndex(
  turnRanges: TurnRange[],
  visibleTurnStartIndex: number,
): number {
  return turnRanges[visibleTurnStartIndex]?.start ?? 0;
}

export function shouldInitializeVisibleTurns(
  activeSessionId: string | null,
  initializedSessionId: string | null,
  turnCount: number,
): boolean {
  return Boolean(activeSessionId) && activeSessionId !== initializedSessionId && turnCount > 0;
}

export function canLoadOlderTurns(
  isLoadingOlder: boolean,
  visibleTurnStartIndex: number,
): boolean {
  return !isLoadingOlder && visibleTurnStartIndex > 0;
}

export function didSessionHistoryScopeChange(
  previousSessionId: string | null,
  activeSessionId: string | null,
): boolean {
  return previousSessionId !== activeSessionId;
}

export function shouldAutoFillViewport(
  scrollHeight: number,
  clientHeight: number,
  visibleTurnStartIndex: number,
): boolean {
  return visibleTurnStartIndex > 0 && scrollHeight <= clientHeight;
}

export function getAnchoredScrollTop(
  previousScrollTop: number,
  previousScrollHeight: number,
  nextScrollHeight: number,
): number {
  return previousScrollTop + (nextScrollHeight - previousScrollHeight);
}

const INITIAL_VISIBLE_TURNS = 8;
const PREPEND_TURNS = 6;
// Fire a little before the user hits absolute top to hide prepend latency.
const LOAD_OLDER_THRESHOLD_PX = 160;

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
  const [visibleTurnStartIndex, setVisibleTurnStartIndex] = useState(0);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);

  const headerRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const connectorMeasureRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const isUserAtBottomRef = useRef(true);
  const autoFollowRef = useRef(true);
  const prevMessageCountRef = useRef(0);
  const prevPartialLengthRef = useRef(0);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRequestRef = useRef<number | null>(null);
  const isScrollingRef = useRef(false);
  const chatInputRef = useRef<ChatInputHandle>(null);
  const previousSessionIdRef = useRef<string | null>(null);
  const initializedSessionIdRef = useRef<string | null>(null);
  const pendingPrependAnchorRef = useRef<{
    scrollHeight: number;
    scrollTop: number;
  } | null>(null);
  const isLoadingOlderRef = useRef(false);
  const turnCountRef = useRef(0);

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

  const turnRanges = useMemo(() => buildTurnRanges(displayedMessages), [displayedMessages]);
  turnCountRef.current = turnRanges.length;

  const effectiveVisibleTurnStartIndex = useMemo(
    () =>
      getEffectiveVisibleTurnStart(
        activeSessionId,
        initializedSessionIdRef.current,
        turnRanges.length,
        visibleTurnStartIndex,
        INITIAL_VISIBLE_TURNS,
      ),
    [activeSessionId, turnRanges.length, visibleTurnStartIndex],
  );

  const visibleMessageStartIndex = useMemo(
    () => getVisibleMessageStartIndex(turnRanges, effectiveVisibleTurnStartIndex),
    [turnRanges, effectiveVisibleTurnStartIndex],
  );

  const visibleMessages = useMemo(() =>
    displayedMessages.slice(visibleMessageStartIndex),
    [displayedMessages, visibleMessageStartIndex],
  );
  // TODO: add bottom-side reclamation if very long sessions still degrade
  // after repeated prepends; v1 only windows older history from the top.

  const visibleTurnEntries = useMemo(() => {
    return visibleMessages.map((message) => {
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
  }, [visibleMessages, effectiveTraceExpanded]);

  useEffect(() => {
    if (
      !didSessionHistoryScopeChange(previousSessionIdRef.current, activeSessionId)
    ) {
      return;
    }

    previousSessionIdRef.current = activeSessionId;
    initializedSessionIdRef.current = null;
    pendingPrependAnchorRef.current = null;
    isLoadingOlderRef.current = false;
    setIsLoadingOlder(false);
    setVisibleTurnStartIndex(0);
  }, [activeSessionId]);

  useEffect(() => {
    if (
      !activeSessionId ||
      !shouldInitializeVisibleTurns(
        activeSessionId,
        initializedSessionIdRef.current,
        turnRanges.length,
      )
    ) {
      return;
    }
    initializedSessionIdRef.current = activeSessionId;
    setVisibleTurnStartIndex(
      getInitialVisibleTurnStart(turnRanges.length, INITIAL_VISIBLE_TURNS),
    );
  }, [activeSessionId, turnRanges.length]);

  const loadOlderTurns = useCallback(() => {
    const container = scrollContainerRef.current;
    if (
      !container ||
      !canLoadOlderTurns(
        isLoadingOlderRef.current,
        effectiveVisibleTurnStartIndex,
      )
    ) {
      return;
    }

    isLoadingOlderRef.current = true;
    pendingPrependAnchorRef.current = {
      scrollHeight: container.scrollHeight,
      scrollTop: container.scrollTop,
    };
    setIsLoadingOlder(true);
    setVisibleTurnStartIndex((currentStart) =>
      getPrependedVisibleTurnStart(
        currentStart,
        turnCountRef.current,
        PREPEND_TURNS,
      ),
    );
  }, [effectiveVisibleTurnStartIndex]);

  const updateScrollToBottomVisibility = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return true;
    const distanceToBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    const isAtBottom = distanceToBottom <= 80;
    isUserAtBottomRef.current = isAtBottom;
    return isAtBottom;
  }, []);

  const syncAutoFollowState = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const isAtBottom = updateScrollToBottomVisibility();
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
    const onScroll = () => {
      syncAutoFollowState();
      if (container.scrollTop <= LOAD_OLDER_THRESHOLD_PX) {
        loadOlderTurns();
      }
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    // ponytail: wheel fires before any pixel moves — beats the 80px isAtBottom
    // threshold race with incoming stream tokens during high-speed scrolling.
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) autoFollowRef.current = false;
    };
    container.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      container.removeEventListener("scroll", onScroll);
      container.removeEventListener("wheel", onWheel);
    };
  }, [loadOlderTurns, syncAutoFollowState]);

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
    const anchor = pendingPrependAnchorRef.current;
    const container = scrollContainerRef.current;
    if (!anchor || !container) return;

    container.scrollTop = getAnchoredScrollTop(
      anchor.scrollTop,
      anchor.scrollHeight,
      container.scrollHeight,
    );
    pendingPrependAnchorRef.current = null;
    isLoadingOlderRef.current = false;
    setIsLoadingOlder(false);
  }, [visibleTurnStartIndex]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || isLoadingOlder) return;

    const rafId = requestAnimationFrame(() => {
      if (
        shouldAutoFillViewport(
          container.scrollHeight,
          container.clientHeight,
          effectiveVisibleTurnStartIndex,
        )
      ) {
        loadOlderTurns();
      }
    });

    return () => cancelAnimationFrame(rafId);
  }, [
    displayedMessages.length,
    effectiveVisibleTurnStartIndex,
    isLoadingOlder,
    loadOlderTurns,
  ]);

  useEffect(() => {
    const messageCount = messages.length;
    const partialLength = partialMessage.length + partialThinking.length;
    const hasNewMessage = messageCount !== prevMessageCountRef.current;
    const isStreamingTick =
      partialLength !== prevPartialLengthRef.current && !hasNewMessage;

    // Streaming tick: keep following unless the user explicitly scrolled away.
    // Mark as programmatic so the resulting scroll event does NOT reset
    // autoFollowRef back to true (race with user's scroll-up event).
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
    if (isScrollingRef.current) return;
    autoFollowRef.current = true;
    isUserAtBottomRef.current = true;
    setShowScrollToBottom(false);
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
        {isLoadingOlder && displayedMessages.length > 0 && (
          <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center">
            <div className="rounded-full bg-background/85 px-3 py-1 shadow-elevated backdrop-blur-sm">
              <Loader2
                aria-hidden="true"
                className="h-4 w-4 animate-spin text-text-muted"
              />
            </div>
          </div>
        )}
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
              visibleTurnEntries.map(({ message, isStreaming, hideTraceBlocks }) => (
                <div key={message.id} className="space-y-1.5">
                  <MessageCard
                    message={message}
                    isStreaming={isStreaming}
                    hideTraceBlocks={hideTraceBlocks}
                  />
                </div>
              ))
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
