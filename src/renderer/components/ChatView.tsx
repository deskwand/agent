import {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useMemo,
  useCallback,
} from "react";
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
import {
  formatContextPercentage,
  resolveDisplayedContextUsage,
} from "../utils/context-usage";
import { MessageCard } from "./MessageCard";
import { ProcessSummaryBlock } from "./message/ProcessSummaryBlock";
import type {
  Message,
  ContentBlock,
  ThinkingLevel,
  ProviderProfileKey,
  ApiProviderConfig,
  ToolUseContent,
  QueuedInput,
  ImageContent,
  FileAttachmentContent,
} from "../types";
import { mergeSteerEntries, resolveAnchorMessageId } from "../steer-entries";
import {
  buildProcessSummaryDisplayBlock,
  collectResultFiles,
  isProcessToolUse,
} from "../utils/tool-display-blocks";
import type {
  ProcessSummaryDisplayBlock,
  ResultFileEntry,
} from "../utils/tool-display-blocks";
import {
  extractVideoReferences,
  type VideoReference,
} from "../utils/video-reference";
import {
  Plug,
  ChevronsDown,
  Loader2,
  Navigation,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { API_PROVIDER_PRESETS } from "../../shared/api-model-presets";
import {
  ChatInput,
  type ChatInputHandle,
  type ChatInputSubmitData,
} from "./ChatInput";
import { ChatInputBottomBar } from "./ChatInputBottomBar";
import { ChatInputQueueBar } from "./ChatInputQueueBar";
import { ChatInputStatusBar, resolveInputStatus } from "./ChatInputStatusBar";
import {
  MessageNavRail,
  getTurnPreviewText,
  type RailTickEntry,
} from "./MessageNavRail";

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

export function didSessionHistoryScopeChange(
  previousSessionId: string | null,
  activeSessionId: string | null,
): boolean {
  return previousSessionId !== activeSessionId;
}

export function shouldAutoFillViewport(
  scrollHeight: number,
  clientHeight: number,
  visibleMessageStartIndex: number,
): boolean {
  return visibleMessageStartIndex > 0 && scrollHeight <= clientHeight;
}

export function shouldInitializeVisibleWindow(
  activeSessionId: string | null,
  initializedSessionId: string | null,
  messageCount: number,
): boolean {
  return (
    Boolean(activeSessionId) &&
    activeSessionId !== initializedSessionId &&
    messageCount > 0
  );
}

export function getAnchoredScrollTop(
  previousScrollTop: number,
  previousScrollHeight: number,
  nextScrollHeight: number,
): number {
  return previousScrollTop + (nextScrollHeight - previousScrollHeight);
}

export function shouldShowHydratingHistoryState(
  activeSessionId: string | null,
  hasActiveSession: boolean,
  hasHistoryHydrated: boolean,
  displayedMessageCount: number,
): boolean {
  return Boolean(
    activeSessionId &&
    hasActiveSession &&
    !hasHistoryHydrated &&
    displayedMessageCount === 0,
  );
}

// Render window is a FIXED-SIZE message window, not a turn window:
// in agent sessions a single turn can span hundreds of tool messages,
// so an 8-turn window could render thousands of MessageCards and take
// seconds to open. The window slides from the tail (initial/at-bottom)
// or follows the scroll position into older history.
const MAX_RENDER_MESSAGES = 400;
const PREPEND_MESSAGES = 200;
// Page size for fetching older history and the store window cap,
// kept in sync with MESSAGE_PAGE_SIZE / MAX_WINDOW_MESSAGES.
const LOAD_OLDER_PAGE_SIZE = 1000;
const MAX_MEMORY_WINDOW_MESSAGES = 2000;
// Nav-rail dock: cap the tick count (sampled uniformly) so user-dense
// sessions keep a stable dock while user-sparse ones never empty out.
const MAX_DOCK_TICKS = 50;
// Wheel deltas below this are trackpad jitter, not a scroll gesture.
const WHEEL_KILL_THRESHOLD_PX = 4;
// Fire a little before the user hits absolute top to hide prepend latency.
const LOAD_OLDER_THRESHOLD_PX = 160;

export function ChatView() {
  const { t } = useTranslation();
  // Scoped selectors — each subscription only re-renders when its slice changes
  const activeSessionId = useActiveSessionId();
  const activeSession = useCurrentSession();
  const messages = useActiveSessionMessages();
  const { partialMessage } = useActivePartialContent();
  const activeTurn = useActiveTurn();
  const pendingTurns = usePendingTurns();

  const appConfig = useAppConfig();
  const contextWindow = useAppStore((s) =>
    activeSessionId
      ? s.sessionStates[activeSessionId]?.contextWindow
      : undefined,
  );
  const sessionState = useAppStore((s) =>
    activeSessionId ? s.sessionStates[activeSessionId] : undefined,
  );
  const compaction = sessionState?.compaction ?? { status: "idle" as const };
  const backgroundAgents = sessionState?.backgroundAgents ?? [];
  const hasMoreOlder = sessionState?.hasMoreOlder ?? false;
  const oldestMessageId = sessionState?.oldestMessageId ?? null;
  const prependOlderMessages = useAppStore((s) => s.prependOlderMessages);
  const trimMessagesToWindow = useAppStore((s) => s.trimMessagesToWindow);
  const isCompacting = compaction.status === "running";
  const compactionResult =
    compaction.status === "success" ||
    compaction.status === "failed" ||
    compaction.status === "aborted"
      ? compaction.status
      : null;
  const setSessionCompaction = useAppStore((s) => s.setSessionCompaction);
  const dismissSessionCompaction = useAppStore(
    (s) => s.dismissSessionCompaction,
  );
  const steerRecords = sessionState?.steerRecords ?? [];
  const inputQueue = sessionState?.inputQueue ?? [];
  const setGoalStatus = useAppStore((s) => s.setGoalStatus);
  const enqueueInput = useAppStore((s) => s.enqueueInput);
  const removeInput = useAppStore((s) => s.removeInput);
  const addSteerRecord = useAppStore((s) => s.addSteerRecord);
  const failPendingSteerRecords = useAppStore((s) => s.failPendingSteerRecords);
  const setGlobalNotice = useAppStore((s) => s.setGlobalNotice);
  const updateSession = useAppStore((s) => s.updateSession);
  const clearActiveTurn = useAppStore((s) => s.clearActiveTurn);
  const {
    continueSession,
    stopSession,
    setSessionThinkingLevel,
    setSessionProviderModel,
    getSessionMessagesPage,
    isElectron,
  } = useIPC();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isInputExpanded, setIsInputExpanded] = useState(false);
  useEffect(() => {
    if (!activeSessionId || !compactionResult) return;
    const timeoutMs = compactionResult === "success" ? 3000 : 5000;
    const id = setTimeout(
      () => dismissSessionCompaction(activeSessionId),
      timeoutMs,
    );
    return () => clearTimeout(id);
  }, [activeSessionId, compactionResult, dismissSessionCompaction]);

  // 会话回到 idle 时：仍处于 injecting 的引导记录标记失败并回填输入框
  useEffect(() => {
    if (!activeSessionId || activeSession?.status !== "idle") return;
    const freshIds = steerRecords
      .filter((r) => r.status === "injecting" && Date.now() - r.ts < 500)
      .map((r) => r.id);
    if (freshIds.length > 0) {
      const id = setTimeout(() => {
        const stillPending = useAppStore
          .getState()
          .sessionStates[
            activeSessionId
          ]?.steerRecords.filter((r) => freshIds.includes(r.id) && r.status === "injecting");
        if (stillPending && stillPending.length > 0) {
          const failedIds = failPendingSteerRecords(
            activeSessionId,
            "session-stopped",
          );
          if (failedIds.length > 0) {
            const record = useAppStore
              .getState()
              .sessionStates[
                activeSessionId
              ]?.steerRecords.find((r) => r.id === failedIds[0]);
            if (record) chatInputRef.current?.setPrompt(record.text);
          }
        }
      }, 500);
      return () => clearTimeout(id);
    }
    const failedIds = failPendingSteerRecords(
      activeSessionId,
      "session-stopped",
    );
    if (failedIds.length > 0) {
      const record = steerRecords.find((r) => failedIds.includes(r.id));
      if (record) chatInputRef.current?.setPrompt(record.text);
    }
  }, [
    activeSessionId,
    activeSession?.status,
    failPendingSteerRecords,
    steerRecords,
  ]);

  const activeSessionCwd = useAppStore((s) => {
    if (!activeSessionId) return undefined;
    const session = (s.sessions as { id: string; cwd?: string | null }[]).find(
      (ses) => ses.id === activeSessionId,
    );
    return session?.cwd || undefined;
  });

  const [activeConnectors, setActiveConnectors] = useState<
    { id: string; name: string; connected: boolean; toolCount: number }[]
  >([]);
  const [showConnectorLabel, setShowConnectorLabel] = useState(true);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [visibleMessageStartIndex, setVisibleMessageStartIndex] = useState(0);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);

  const headerRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const connectorMeasureRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  // Single-source follow state: true while the user is at the physical
  // bottom. Written ONLY by user-input events (wheel/scroll) and explicit
  // actions (send, button, session switch). Content-growth paths read it
  // and pin unconditionally — they never infer intent.
  const isAtBottomRef = useRef(true);
  const previousScrollTopRef = useRef(0);
  const autoDrainRef = useRef(false);
  const stopRequestedRef = useRef(false);
  const prevMessageCountRef = useRef(0);
  const chatInputRef = useRef<ChatInputHandle>(null);
  const previousSessionIdRef = useRef<string | null>(null);
  const initializedSessionIdRef = useRef<string | null>(null);
  const pendingPrependAnchorRef = useRef<{
    scrollHeight: number;
    scrollTop: number;
  } | null>(null);
  const pendingDockJumpRef = useRef<string | null>(null);
  const isLoadingOlderRef = useRef(false);
  // Bumped on every session switch; async stage-2 continuations check it
  // so a fetch started for the old session cannot prepend into the new one.
  const sessionGenerationRef = useRef(0);

  const hasActiveTurn = Boolean(activeTurn);

  const goalStatus = useAppStore((s) =>
    activeSessionId ? s.sessionStates[activeSessionId]?.goalStatus : undefined,
  );
  // Hide complete/blocked transition state 5 seconds after it appears
  const [goalTransitionVisible, setGoalTransitionVisible] = useState(true);
  useEffect(() => {
    const s = goalStatus?.status;
    if (s === "complete" || s === "blocked") {
      setGoalTransitionVisible(true);
      const timer = setTimeout(() => setGoalTransitionVisible(false), 5000);
      return () => clearTimeout(timer);
    }
    setGoalTransitionVisible(true);
  }, [goalStatus?.status, activeSessionId]);

  const pendingCount = pendingTurns.length;
  const isSessionRunning = activeSession?.status === "running";
  const canStop = isSessionRunning || hasActiveTurn || pendingCount > 0;

  const inputStatus = useMemo(() => {
    // Mirror the stop button: whenever canStop is true the status bar
    // must show a non-null indicator so the user never sees a blank bar
    // while the session is running / a turn is active or pending.
    const hasStreamingText = !!partialMessage?.trim();
    return resolveInputStatus({
      isSending: isSubmitting && !canStop,
      isCompacting,
      compactionResult,
      // Guard with hasActiveTurn: once the turn ends we don't show
      // "thinking" during the brief idle-window before session settles.
      shouldShowThinkingIndicator:
        canStop && hasActiveTurn && !hasStreamingText,
      isResponding: canStop && hasStreamingText,
      goalStatus:
        goalStatus?.status === "complete" || goalStatus?.status === "blocked"
          ? goalTransitionVisible
            ? goalStatus
            : null
          : goalStatus,
      backgroundAgents,
    });
  }, [
    isCompacting,
    compactionResult,
    canStop,
    hasActiveTurn,
    partialMessage,
    goalStatus,
    goalTransitionVisible,
    backgroundAgents,
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
  const displayedContextUsage = resolveDisplayedContextUsage(
    lastInputTokens,
    compaction.estimatedTokens,
  );
  const displayedContextTokens = displayedContextUsage.tokens;
  const contextUsagePercentage =
    displayedContextTokens !== null && contextWindow && contextWindow > 0
      ? Math.min((displayedContextTokens / contextWindow) * 100, 100)
      : 0;
  const contextRingColorClass =
    contextUsagePercentage > 95
      ? "text-error"
      : contextUsagePercentage > 80
        ? "text-warning"
        : "text-accent";
  const showExactUsageDetails = !displayedContextUsage.isEstimated;
  const cacheHitRate =
    showExactUsageDetails &&
    typeof latestAssistantUsage?.cacheRead === "number" &&
    typeof latestAssistantUsage?.totalPromptInput === "number" &&
    latestAssistantUsage.totalPromptInput > 0
      ? `${((latestAssistantUsage.cacheRead / latestAssistantUsage.totalPromptInput) * 100).toFixed(1)}%`
      : "--";
  const formattedUsed =
    displayedContextTokens === null
      ? "--"
      : formatTokenCount(displayedContextTokens);
  const contextUsageTooltip = t("chat.contextUsageTooltip", {
    percentage: formatContextPercentage(
      displayedContextTokens === null
        ? null
        : displayedContextUsage.isEstimated
          ? t("chat.approximateValue", {
              value: Math.round(contextUsagePercentage),
            })
          : Math.round(contextUsagePercentage),
    ),
    used:
      displayedContextUsage.isEstimated && displayedContextTokens !== null
        ? t("chat.approximateValue", { value: formattedUsed })
        : formattedUsed,
    total: formatTokenCount(contextWindow || 0),
    output:
      showExactUsageDetails && typeof latestAssistantUsage?.output === "number"
        ? formatTokenCount(latestAssistantUsage.output)
        : "--",
    cacheRead:
      showExactUsageDetails &&
      typeof latestAssistantUsage?.cacheRead === "number"
        ? formatTokenCount(latestAssistantUsage.cacheRead)
        : "--",
    promptNonCache:
      showExactUsageDetails && typeof latestAssistantUsage?.input === "number"
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

  // Strip thinking blocks from all assistant messages — thinking happens
  // server-side but should never appear in the chat UI.
  const messagesWithoutThinking = useMemo(
    () =>
      messages.map((msg) => {
        if (msg.role !== "assistant" || !Array.isArray(msg.content)) return msg;
        return {
          ...msg,
          content: (msg.content as ContentBlock[]).filter(
            (b) => b.type !== "thinking",
          ),
        };
      }),
    [messages],
  );

  // Strip auto-generated user messages (goal firstTurn / continue prompts)
  // from the chat UI. They still exist in the message list for streaming
  // (pendingTurn creation) but are never visible.
  const messagesDisplayable = useMemo(
    () => messagesWithoutThinking.filter((msg) => !msg.autoGenerated),
    [messagesWithoutThinking],
  );

  const displayedMessages = useMemo(() => {
    // Use the full list (including auto-generated) for anchor lookup &
    // aggregation; filter auto-generated out of the final result only.
    const full = messagesWithoutThinking;
    if (!activeSessionId || !activeTurn?.userMessageId || !activeTurn.turnId)
      return messagesDisplayable;

    const anchorIndex = full.findIndex(
      (message) => message.id === activeTurn.userMessageId,
    );
    if (anchorIndex === -1) return messagesDisplayable;

    let rangeEnd = anchorIndex + 1;
    while (rangeEnd < full.length) {
      if (full[rangeEnd].role === "user") break;
      rangeEnd += 1;
    }

    const aggregatedBlocks: ContentBlock[] = [];
    let hasActiveTurnAssistantMessage = false;
    let executionTimeMs: number | undefined;

    for (let i = anchorIndex + 1; i < rangeEnd; i += 1) {
      const message = full[i];
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

    if (partialMessage) {
      appendMergedLiveBlock(aggregatedBlocks, {
        type: "text",
        text: partialMessage,
      });
    }

    const hasStreamingContent = Boolean(partialMessage);
    if (!hasActiveTurnAssistantMessage && !hasStreamingContent)
      return messagesDisplayable;

    const streamingMessage: Message = {
      id: `partial-${activeSessionId}-${activeTurn.turnId}`,
      sessionId: activeSessionId,
      role: "assistant",
      content: aggregatedBlocks,
      timestamp: Date.now(),
      turnId: activeTurn.turnId,
      executionTimeMs,
    };

    // Slice from full list, then strip auto-generated messages from result
    const before = full
      .slice(0, anchorIndex + 1)
      .filter((msg) => !msg.autoGenerated);
    const after = full.slice(rangeEnd).filter((msg) => !msg.autoGenerated);

    return [...before, streamingMessage, ...after];
  }, [
    activeSessionId,
    activeTurn?.turnId,
    activeTurn?.userMessageId,
    messagesDisplayable,
    messagesWithoutThinking,
    partialMessage,
  ]);

  // Keep the window pinned to the tail while the user is at the bottom,
  // so streamed messages stay visible as the list grows.
  useEffect(() => {
    if (!isAtBottomRef.current || !activeSessionId) return;
    const tailStart = Math.max(
      0,
      displayedMessages.length - MAX_RENDER_MESSAGES,
    );
    setVisibleMessageStartIndex((current) =>
      current === tailStart ? current : tailStart,
    );
  }, [activeSessionId, displayedMessages.length]);

  // Fixed-size sliding window: [start, start + MAX_RENDER_MESSAGES).
  const visibleMessages = useMemo(
    () =>
      displayedMessages.slice(
        visibleMessageStartIndex,
        visibleMessageStartIndex + MAX_RENDER_MESSAGES,
      ),
    [displayedMessages, visibleMessageStartIndex],
  );

  // Merge pure-tool messages (no text blocks) into the preceding assistant
  // message so buildToolDisplayBlocks can group all tool_use/tool_result together.
  const { messages: mergedMessages, hoistedProcessSummaryTurnIds } =
    useMemo(() => {
      const result: Message[] = [];
      const hoistedTurnIds = new Set<string>();

      for (const msg of visibleMessages) {
        if (msg.role === "assistant") {
          const blocks = Array.isArray(msg.content)
            ? (msg.content as unknown as ContentBlock[])
            : [];
          const hasText = blocks.some((b) => b.type === "text");

          if (!hasText && blocks.length > 0) {
            // Pure-tool message — merge into the preceding assistant message
            let merged = false;
            for (let j = result.length - 1; j >= 0; j--) {
              const prev = result[j];
              if (
                prev &&
                prev.role === "assistant" &&
                prev.turnId === msg.turnId
              ) {
                const prevBlocks = Array.isArray(prev.content)
                  ? (prev.content as unknown as ContentBlock[])
                  : [];
                result[j] = {
                  ...prev,
                  content: [...prevBlocks, ...blocks],
                };
                if (typeof msg.turnId === "string") {
                  hoistedTurnIds.add(msg.turnId);
                }
                merged = true;
                break;
              }
            }
            if (merged) continue;
            // No preceding assistant (e.g. first message in turn is a tool) — keep as-is
          }
        }
        result.push(msg);
      }

      return {
        messages: result,
        hoistedProcessSummaryTurnIds: hoistedTurnIds,
      };
    }, [visibleMessages]);

  const visibleTurnEntries = useMemo(() => {
    // Single pass: detect turn-end indices, latest non-partial assistant,
    // collect artifact files, and build one turn-level process summary anchor.
    const turnEndIds = new Set<string>();
    const turnArtifactFiles = new Map<string, ResultFileEntry[]>();
    const turnVideoReferences = new Map<string, VideoReference[]>();
    const turnProcessSummaries = new Map<string, ProcessSummaryDisplayBlock>();
    const turnsWithProcessSummary = new Set<string>();
    let latestAssistantId: string | null = null;
    let currentTurnToolUses: ToolUseContent[] = [];
    let currentTurnProcessToolUses: ToolUseContent[] = [];
    let currentTurnAssistantText: string[] = [];
    let currentTurnBlocks: ContentBlock[] = [];

    for (let i = 0; i < mergedMessages.length; i++) {
      const msg = mergedMessages[i];
      if (!msg) continue;

      // Collect tool_use blocks from assistant messages in the current turn.
      if (msg.role === "assistant") {
        const rawContent = msg.content as unknown;
        const blocks = Array.isArray(rawContent)
          ? (rawContent as ContentBlock[])
          : [];
        const toolUses = blocks.filter(
          (b): b is ToolUseContent => b.type === "tool_use",
        );
        currentTurnAssistantText.push(
          ...blocks.filter((b) => b.type === "text").map((b) => b.text),
        );
        currentTurnToolUses.push(...toolUses);
        currentTurnProcessToolUses.push(...toolUses.filter(isProcessToolUse));
        currentTurnBlocks.push(...blocks);

        const msgId = String(msg.id);
        const isPartial = msgId.startsWith("partial-");
        if (isPartial) continue;
        latestAssistantId = msgId;
        const next = mergedMessages[i + 1];
        if (!next || next.role === "user") {
          turnEndIds.add(msgId);
          if (currentTurnToolUses.length > 0) {
            turnArtifactFiles.set(
              msgId,
              collectResultFiles(currentTurnToolUses, currentTurnBlocks),
            );
          }
          const videoReferences = extractVideoReferences(
            currentTurnAssistantText.join("\n"),
            activeSessionCwd,
          );
          if (videoReferences.length > 0) {
            turnVideoReferences.set(msgId, videoReferences);
          }
          if (
            currentTurnProcessToolUses.length > 0 &&
            typeof msg.turnId === "string" &&
            hoistedProcessSummaryTurnIds.has(msg.turnId)
          ) {
            turnProcessSummaries.set(
              msgId,
              buildProcessSummaryDisplayBlock(currentTurnProcessToolUses),
            );
            turnsWithProcessSummary.add(msg.turnId);
          }
          currentTurnToolUses = [];
          currentTurnProcessToolUses = [];
          currentTurnAssistantText = [];
          currentTurnBlocks = [];
        }
      }
    }

    return mergedMessages.map((message) => {
      const isStreaming =
        typeof message.id === "string" && message.id.startsWith("partial-");
      const msgId = String(message.id);
      const turnId = message.turnId;
      return {
        message,
        isStreaming,
        isTurnEnd: turnEndIds.has(msgId),
        // Partial messages (streaming) and the last completed assistant are the latest round.
        // Partial messages must be treated as latest-round so that process summaries
        // keep their natural order instead of being pushed to the end.
        isLatestRound:
          msgId.startsWith("partial-") || msgId === latestAssistantId,
        artifactFiles: turnArtifactFiles.get(msgId) ?? [],
        videoReferences: turnVideoReferences.get(msgId) ?? [],
        turnProcessSummary:
          message.role === "assistant"
            ? turnProcessSummaries.get(msgId)
            : undefined,
        suppressProcessSummaries:
          message.role === "assistant" &&
          typeof turnId === "string" &&
          turnsWithProcessSummary.has(turnId),
      };
    });
  }, [mergedMessages, hoistedProcessSummaryTurnIds, activeSessionCwd]);

  // Dock ticks are anchored to the IN-MEMORY window (all loaded history),
  // not the render window: sliding the render window while scrolling up
  // must not change the tick count. User-dense sessions are capped by
  // uniform sampling so the dock stays stable there too.
  const railTicks = useMemo<RailTickEntry[]>(() => {
    const userMsgs = displayedMessages.filter((m) => m.role === "user");
    if (userMsgs.length === 0) return [];
    const sampled =
      userMsgs.length > MAX_DOCK_TICKS
        ? Array.from(
            { length: MAX_DOCK_TICKS },
            (_, i) =>
              userMsgs[
                Math.round((i * (userMsgs.length - 1)) / (MAX_DOCK_TICKS - 1))
              ],
          )
        : userMsgs;
    // One pass over the displayed list: attach the preview of the first
    // assistant message that follows each sampled user message.
    const assistantByUser = new Map<string, string | null>();
    let pendingUser: Message | null = null;
    for (const msg of displayedMessages) {
      if (msg.role === "user") {
        pendingUser = msg;
        continue;
      }
      if (msg.role === "assistant" && pendingUser) {
        const result = getTurnPreviewText(msg, 100);
        if (result.kind !== "empty" && !assistantByUser.has(pendingUser.id)) {
          assistantByUser.set(pendingUser.id, result.value);
        }
      }
    }
    return sampled.map((msg) => {
      const userResult = getTurnPreviewText(msg, 100);
      return {
        messageId: String(msg.id),
        userPreview: userResult.kind !== "empty" ? userResult.value : "",
        assistantPreview: assistantByUser.get(String(msg.id)) ?? null,
      };
    });
  }, [displayedMessages]);

  // 引导记录按时间戳合并进消息流时间轴（时序一致；不进 messages store）
  const mergedTurnEntries = useMemo(
    () => mergeSteerEntries(visibleTurnEntries, steerRecords),
    [visibleTurnEntries, steerRecords],
  );

  const handleDockTickSelect = useCallback(
    (messageId: string) => {
      const container = scrollContainerRef.current;
      if (!container) return;
      // A dock jump is an explicit leave-bottom intent: without this, the
      // smooth scrollIntoView's first scroll event can still see
      // isAtBottomRef=true (scrollTop has not moved yet) and the bottom
      // reclamation branch would snap the window back to the tail,
      // removing the very message we just jumped to.
      isAtBottomRef.current = false;
      const target = container.querySelector(
        `[data-message-id="${messageId}"]`,
      );
      if (target) {
        target.scrollIntoView({ block: "start", behavior: "smooth" });
        return;
      }
      // Target is outside the render window: slide the window to it and
      // jump via the effect below once it is rendered.
      const idx = displayedMessages.findIndex(
        (m) => String(m.id) === messageId,
      );
      if (idx === -1) return;
      pendingDockJumpRef.current = messageId;
      setVisibleMessageStartIndex(Math.max(0, idx - PREPEND_MESSAGES));
    },
    [displayedMessages],
  );

  // Runs after the render-window slide commits, so the target message is
  // guaranteed to be in the DOM (a requestAnimationFrame could fire before
  // React flushes and the jump would silently no-op).
  useEffect(() => {
    const messageId = pendingDockJumpRef.current;
    if (!messageId) return;
    pendingDockJumpRef.current = null;
    scrollContainerRef.current
      ?.querySelector(`[data-message-id="${messageId}"]`)
      ?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [visibleMessageStartIndex]);

  const isHydratingHistoryState = shouldShowHydratingHistoryState(
    activeSessionId,
    Boolean(activeSession),
    Boolean(sessionState?.historyHydrated),
    displayedMessages.length,
  );

  useEffect(() => {
    if (
      !didSessionHistoryScopeChange(
        previousSessionIdRef.current,
        activeSessionId,
      )
    ) {
      return;
    }

    previousSessionIdRef.current = activeSessionId;
    initializedSessionIdRef.current = null;
    pendingPrependAnchorRef.current = null;
    isLoadingOlderRef.current = false;
    setIsLoadingOlder(false);
    setVisibleMessageStartIndex(0);
    sessionGenerationRef.current += 1;
    pendingDockJumpRef.current = null;
  }, [activeSessionId]);

  useEffect(() => {
    if (
      !activeSessionId ||
      !shouldInitializeVisibleWindow(
        activeSessionId,
        initializedSessionIdRef.current,
        displayedMessages.length,
      )
    ) {
      return;
    }
    initializedSessionIdRef.current = activeSessionId;
    setVisibleMessageStartIndex(
      Math.max(0, displayedMessages.length - MAX_RENDER_MESSAGES),
    );
  }, [activeSessionId, displayedMessages.length]);

  const loadOlderTurns = useCallback(async () => {
    const container = scrollContainerRef.current;
    if (!container || isLoadingOlderRef.current || !activeSessionId) {
      return;
    }

    if (visibleMessageStartIndex > 0) {
      // Stage 1: slide the render window further into older history.
      const nextStart = Math.max(
        0,
        visibleMessageStartIndex - PREPEND_MESSAGES,
      );
      isLoadingOlderRef.current = true;
      pendingPrependAnchorRef.current = {
        scrollHeight: container.scrollHeight,
        scrollTop: container.scrollTop,
      };
      setIsLoadingOlder(true);
      setVisibleMessageStartIndex(nextStart);
      if (nextStart === visibleMessageStartIndex) {
        // Start index cannot move (already 0): React bails out, the
        // anchor effect never fires — clear the flags manually so the
        // spinner stops and later loads are not blocked.
        requestAnimationFrame(() => {
          pendingPrependAnchorRef.current = null;
          isLoadingOlderRef.current = false;
          setIsLoadingOlder(false);
        });
      }
      return;
    }

    // Stage 2: render window is at the top of the in-memory window —
    // fetch the next older page from the main process.
    if (!hasMoreOlder) return;

    isLoadingOlderRef.current = true;
    pendingPrependAnchorRef.current = {
      scrollHeight: container.scrollHeight,
      scrollTop: container.scrollTop,
    };
    setIsLoadingOlder(true);

    let prependApplied = false;
    const fetchGeneration = sessionGenerationRef.current;
    try {
      const page = await getSessionMessagesPage(
        activeSessionId,
        oldestMessageId,
        LOAD_OLDER_PAGE_SIZE,
      );
      if (fetchGeneration !== sessionGenerationRef.current) {
        // Session switched while the fetch was in flight: drop the page.
        // The switch effect already cleared the loading flags.
        return;
      }
      if (!page || page.messages.length === 0) {
        if (page) prependOlderMessages(activeSessionId, [], page.hasMore);
        return;
      }
      // prependOlderMessages trims the oldest messages when the store
      // window exceeds its cap and returns how many were dropped; the
      // boundary (page tail) shifts forward by that amount.
      const trimmed = prependOlderMessages(
        activeSessionId,
        page.messages,
        page.hasMore,
      );
      // Render window slides to just above the prepended boundary so the
      // previously visible content stays on screen; the page itself stays
      // above the window (message-granularity, no turn math needed).
      const boundary = page.messages.filter((m) => !m.autoGenerated).length;
      const newStart = Math.max(0, boundary - trimmed - PREPEND_MESSAGES);
      setVisibleMessageStartIndex(newStart);
      prependApplied = true;
      if (newStart === 0) {
        // Extreme case: the page still contains fewer than two user
        // messages after alignment, so the render window start cannot
        // move — the anchor effect never fires and the spinner would
        // spin forever. Clear the flags here; the window stays intact
        // and shows the whole merged list, which is correct content.
        requestAnimationFrame(() => {
          pendingPrependAnchorRef.current = null;
          isLoadingOlderRef.current = false;
          setIsLoadingOlder(false);
        });
      }
    } catch {
      // Keep the current window intact; the spinner clears below and
      // the next scroll-to-top retries.
    } finally {
      if (!prependApplied && fetchGeneration === sessionGenerationRef.current) {
        // Failed or empty fetch: no render-window change coming, so
        // the anchor effect will not fire — clear everything now.
        // The generation guard matters: a STALE continuation must not
        // touch the flags, or it would steal the new session's scroll
        // anchor and re-open the load gate, letting auto-fill start a
        // second stage-2 with the same cursor (duplicate prepend).
        pendingPrependAnchorRef.current = null;
        isLoadingOlderRef.current = false;
        setIsLoadingOlder(false);
      }
      // Success path: the anchor effect (deps: [visibleMessageStartIndex])
      // applies the anchor and clears isLoadingOlder after commit.
    }
  }, [
    activeSessionId,
    getSessionMessagesPage,
    hasMoreOlder,
    oldestMessageId,
    prependOlderMessages,
    visibleMessageStartIndex,
  ]);

  const syncFollowFromScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const maxScrollTop = container.scrollHeight - container.clientHeight;
    const st = container.scrollTop;
    if (st < previousScrollTopRef.current && maxScrollTop - st > 1) {
      // Moving up (or content shrank without clamping to the bottom):
      // the user left the bottom → stop following.
      isAtBottomRef.current = false;
    } else if (st > previousScrollTopRef.current && st >= maxScrollTop - 1) {
      // Scrolled DOWN to the physical bottom → resume following. Requires
      // downward movement so a wheel-up with the viewport still parked at
      // the bottom (no scroll event yet) cannot be revived by the
      // intervening bottom-position scroll event.
      isAtBottomRef.current = true;
    }
    previousScrollTopRef.current = st;
    setShowScrollToBottom(!isAtBottomRef.current);
  }, []);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    syncFollowFromScroll();
    const onScroll = () => {
      syncFollowFromScroll();
      if (
        isAtBottomRef.current &&
        visibleMessageStartIndex > 0 &&
        activeSessionId
      ) {
        // Returned to the bottom after loading history: collapse the
        // render window to the tail and reclaim the in-memory window.
        // Safe to re-run: same start index bails out and trim is a no-op
        // once the window is within the cap.
        setVisibleMessageStartIndex(
          Math.max(0, displayedMessages.length - MAX_RENDER_MESSAGES),
        );
        trimMessagesToWindow(activeSessionId, MAX_MEMORY_WINDOW_MESSAGES);
      }
      if (container.scrollTop <= LOAD_OLDER_THRESHOLD_PX) {
        loadOlderTurns();
      }
    };
    container.addEventListener("scroll", onScroll, { passive: true });

    // Wheel fires before the first scroll event, so an incoming token cannot
    // pull the viewport back down while the upward gesture is starting.
    const onWheel = (e: WheelEvent) => {
      // Ignore trackpad jitter (sub-threshold pixel deltas at gesture
      // start/end). Line/notch-mode deltas are always intentional.
      if (
        e.deltaMode === WheelEvent.DOM_DELTA_PIXEL &&
        Math.abs(e.deltaY) < WHEEL_KILL_THRESHOLD_PX
      ) {
        return;
      }
      // A wheel inside a nested scrollable (tool output, bash output, ...)
      // scrolls that element only — it is not a chat-scroll gesture, so it
      // must not cancel follow. The chat container itself also carries the
      // overflow-y-auto class, so `!== container` separates the two.
      // Assumption: every overflow-y-auto descendant of the container is
      // independently scrollable. A decorative (non-scrolling) element
      // carrying that class would swallow wheel intent — keep the
      // convention when adding new scrollable blocks.
      if (
        e.target instanceof Element &&
        e.target.closest(".overflow-y-auto") !== container
      ) {
        return;
      }
      if (e.deltaY < 0) {
        isAtBottomRef.current = false;
        setShowScrollToBottom(true);
        // Chromium cancels in-flight programmatic smooth-scroll animations
        // on user wheel input, so an ongoing button/send glide cannot reach
        // the bottom and falsely revive follow. Browser behavior dependency
        // (not testable in jsdom) — covered by manual checklist item 7.
      }
      // Downward wheels leave the state untouched; the scroll event
      // confirms arrival at the physical bottom.
    };
    container.addEventListener("wheel", onWheel, { passive: true });

    return () => {
      container.removeEventListener("scroll", onScroll);
      container.removeEventListener("wheel", onWheel);
    };
  }, [
    activeSessionId,
    displayedMessages.length,
    loadOlderTurns,
    syncFollowFromScroll,
    trimMessagesToWindow,
    visibleMessageStartIndex,
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
  }, [visibleMessageStartIndex]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || isLoadingOlder) return;

    const rafId = requestAnimationFrame(() => {
      if (
        shouldAutoFillViewport(
          container.scrollHeight,
          container.clientHeight,
          visibleMessageStartIndex,
        )
      ) {
        loadOlderTurns();
      }
    });

    return () => cancelAnimationFrame(rafId);
  }, [
    displayedMessages.length,
    isLoadingOlder,
    loadOlderTurns,
    visibleMessageStartIndex,
  ]);

  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const hasNewMessage = messages.length !== prevMessageCountRef.current;
    const lastMessage = messages[messages.length - 1];
    const isOwnNewMessage =
      hasNewMessage &&
      lastMessage?.role === "user" &&
      !lastMessage.autoGenerated;
    if (isOwnNewMessage) {
      // Sending a message is an explicit return-to-bottom action.
      isAtBottomRef.current = true;
      container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    } else if (isAtBottomRef.current) {
      // Any content growth (streaming tick, new message, in-place refresh)
      // pins unconditionally — no debounce, no guard: idempotent.
      container.scrollTop = container.scrollHeight;
    }

    prevMessageCountRef.current = messages.length;
  }, [messages.length, partialMessage.length]);

  // Additional scroll trigger for content height changes (e.g., TodoWrite expand/collapse)
  useEffect(() => {
    const container = scrollContainerRef.current;
    const messagesContainer = messagesContainerRef.current;
    if (!container || !messagesContainer) return;

    const resizeObserver = new ResizeObserver(() => {
      const container = scrollContainerRef.current;
      if (container && isAtBottomRef.current) {
        container.scrollTop = container.scrollHeight;
      }
    });

    resizeObserver.observe(messagesContainer);

    return () => {
      resizeObserver.disconnect();
    };
  }, []); // ResizeObserver is stable — no need to recreate on message count changes

  useEffect(() => {
    chatInputRef.current?.focus();
    // 重置跟随状态，覆盖旧会话中用户手动上滚的残留
    isAtBottomRef.current = true;
    previousScrollTopRef.current = 0;
    setIsInputExpanded(false);
    const rafId = requestAnimationFrame(() => {
      const c = scrollContainerRef.current;
      if (c) c.scrollTo({ top: c.scrollHeight, behavior: "auto" });
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
    if (!activeSessionId || isSubmitting || isCompacting) return;

    const rawText = data.text.trim();
    if (!rawText && data.images.length === 0 && data.files.length === 0) return;

    // Non-idle send (text and/or attachments): route into the queue area
    // (replaces the old queued message-card path).
    if (canStop) {
      const { images, files } = buildAttachmentBlocks(data);
      enqueueInput(activeSessionId, rawText, images, files);
      chatInputRef.current?.clear();
      setTimeout(() => chatInputRef.current?.focus(), 0);
      return;
    }

    // Normal send path
    setIsSubmitting(true);
    try {
      const contentBlocks: ContentBlock[] = [
        ...buildAttachmentBlocks(data).images,
        ...buildAttachmentBlocks(data).files,
      ];
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
    } finally {
      setIsSubmitting(false);
      setTimeout(() => chatInputRef.current?.focus(), 0);
    }
  };

  /** 将 ChatInputSubmitData 的图片/文件转为 ContentBlock 附件块（入队与发送共用）。 */
  function buildAttachmentBlocks(data: ChatInputSubmitData): {
    images: ImageContent[];
    files: FileAttachmentContent[];
  } {
    return {
      images: data.images.map((img) => ({
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
      })),
      files: data.files.map((file) => ({
        type: "file_attachment",
        filename: file.name,
        relativePath: file.path,
        size: file.size,
        mimeType: file.type,
        inlineDataBase64: file.inlineDataBase64,
      })),
    };
  }

  const handleCompact = async (instructions?: string) => {
    if (!activeSessionId || isCompacting || hasActiveTurn || !isElectron) {
      return;
    }

    try {
      const res = await window.electronAPI!.invoke<{
        success: boolean;
        status?: string;
      }>({
        type: "session.compact",
        payload: { sessionId: activeSessionId, instructions },
      });
      if (!res?.success) {
        setSessionCompaction(activeSessionId, "failed");
        setGlobalNotice({
          id: `compact-err-${Date.now()}`,
          type: "error",
          message: t("chat.compactFailed"),
        });
        return;
      }
      if (res.status === "already-compacted") {
        setSessionCompaction(activeSessionId, "success");
      } else if (res.status === "skipped") {
        dismissSessionCompaction(activeSessionId);
        setGlobalNotice({
          id: `compact-skipped-${Date.now()}`,
          type: "info",
          message: t("chat.compactSkipped"),
        });
      }
    } catch {
      setSessionCompaction(activeSessionId, "failed");
      setGlobalNotice({
        id: `compact-err-${Date.now()}`,
        type: "error",
        message: t("chat.compactFailed"),
      });
      return;
    }
  };

  const handleCommand = (action: string) => {
    if (action === "compact") {
      handleCompact();
      return;
    }
    // Goal commands: send via IPC directly (bypass message flow)
    // with optimistic UI update for instant feedback.
    if (action.startsWith("goal:") && activeSessionId && isElectron) {
      const goalAction = action.slice(5); // "pause" | "resume" | "clear"
      // Optimistic update: reflect the action in UI immediately
      const currentGoal = goalStatus;
      if (currentGoal) {
        if (goalAction === "pause") {
          setGoalStatus(activeSessionId, {
            status: "paused",
            objective: currentGoal.objective,
            iteration: currentGoal.iteration,
          });
        } else if (goalAction === "resume") {
          setGoalStatus(activeSessionId, {
            status: "active",
            objective: currentGoal.objective,
            iteration: currentGoal.iteration,
          });
        } else if (goalAction === "clear") {
          setGoalStatus(activeSessionId, undefined);
        }
      }
      window.electronAPI.send({
        type: "session.command",
        payload: {
          sessionId: activeSessionId,
          action: goalAction as "pause" | "resume" | "clear",
        },
      });
      return;
    }
  };

  const handleStop = () => {
    if (canStop) {
      if (activeSessionId) {
        stopRequestedRef.current = true; // 用户主动停止：抑制队列自动执行一次
        stopSession(activeSessionId);
        updateSession(activeSessionId, { status: "idle" });
        clearActiveTurn(activeSessionId);
      }
      return;
    }
    chatInputRef.current?.submit();
  };

  /** 统一出队发送入口：自动执行与手动引导（idle）共用，防双回合。 */
  const sendQueuedItem = useCallback(
    (item: QueuedInput) => {
      if (!activeSessionId || isCompacting) return; // 压缩中禁止发送（与 handleSubmit 守卫一致）
      autoDrainRef.current = true;
      removeInput(activeSessionId, item.id);
      const contentBlocks: ContentBlock[] = [
        ...(item.images ?? []),
        ...(item.files ?? []),
      ];
      if (item.text) {
        contentBlocks.push({ type: "text", text: item.text });
      }
      // 发送失败（会话删除/非法 model 等）：复位 in-flight guard，避免队列永久卡死
      continueSession(
        activeSessionId,
        contentBlocks,
        activeSession?.providerProfileKey,
        activeSession?.model,
      ).catch(() => {
        autoDrainRef.current = false;
      });
    },
    [
      activeSessionId,
      isCompacting,
      continueSession,
      removeInput,
      activeSession?.providerProfileKey,
      activeSession?.model,
    ],
  );

  const handleQueueSteer = useCallback(
    (inputId: string) => {
      if (!activeSessionId) return;
      const item = useAppStore
        .getState()
        .sessionStates[
          activeSessionId
        ]?.inputQueue.find((i) => i.id === inputId);
      if (!item) return;
      if (!canStop) {
        // idle：作为普通消息发送并触发回合
        sendQueuedItem(item);
        return;
      }
      removeInput(activeSessionId, inputId);
      // 引导注入：图片随注入（SDK steer 支持 images）；
      // 文件 SDK 不支持 → 降级为文本说明（自动执行/普通发送时完整支持）。
      const fileNotes = (item.files ?? [])
        .map((f) => `[${f.filename}]`)
        .join(" ");
      const imageNote =
        (item.images ?? []).length > 0 ? `[${t("steer.imageAttachment")}]` : "";
      const steerText = [item.text, imageNote, fileNotes]
        .filter(Boolean)
        .join(" ");
      // 锚点 = 注入时刻最后一条**可见**消息 id（渲染时固定时序位置）。
      // 必须跳过 autoGenerated 消息（goal 自动 prompt 等，UI 不可见——
      // 锚到它们会导致渲染时找不到锚点而 fallback 沉底），且 assistant
      // 消息锚到同回合第一条（合并后保留的 id）。
      const messages =
        useAppStore.getState().sessionStates[activeSessionId]?.messages ?? [];
      const anchorMessageId = resolveAnchorMessageId(messages);
      const recordId = addSteerRecord(
        activeSessionId,
        steerText,
        anchorMessageId,
      );
      if (isElectron) {
        window.electronAPI.send({
          type: "session.steer",
          payload: {
            sessionId: activeSessionId,
            prompt: steerText,
            requestId: recordId,
            images: item.images,
          },
        });
      }
    },
    [
      activeSessionId,
      canStop,
      isElectron,
      removeInput,
      addSteerRecord,
      sendQueuedItem,
    ],
  );

  // 会话空闲 + 队列非空 → 自动执行第一条（FIFO）；用户 stop 抑制一次
  const previousDrainSessionIdRef = useRef<string | null>(null);
  useEffect(() => {
    // 跨会话切换：复位上一会话的 in-flight / stop 抑制标记，避免静默失效
    if (previousDrainSessionIdRef.current !== activeSessionId) {
      previousDrainSessionIdRef.current = activeSessionId ?? null;
      autoDrainRef.current = false;
      stopRequestedRef.current = false;
    }
    if (!activeSessionId || activeSession?.status !== "idle") {
      autoDrainRef.current = false;
      return;
    }
    if (stopRequestedRef.current) {
      stopRequestedRef.current = false;
      return;
    }
    if (autoDrainRef.current) return;
    const queue =
      useAppStore.getState().sessionStates[activeSessionId]?.inputQueue ?? [];
    if (queue.length === 0) return;
    sendQueuedItem(queue[0]);
  }, [activeSessionId, activeSession?.status, inputQueue.length, sendQueuedItem]);

  const scrollToBottomByButton = () => {
    isAtBottomRef.current = true;
    setShowScrollToBottom(false);
    const c = scrollContainerRef.current;
    c?.scrollTo({ top: c.scrollHeight, behavior: "smooth" });
  };

  if (!activeSession) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted">
        <span>{t("chat.loadingConversation")}</span>
      </div>
    );
  }

  return (
    <div className="relative flex-1 flex flex-col overflow-hidden bg-background">
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
          className="h-full min-h-0 overflow-y-auto overflow-x-hidden eff-scroll-fade"
          style={{ overflowAnchor: "none" }}
        >
          <div
            ref={messagesContainerRef}
            className="w-full max-w-[920px] mx-auto py-8 px-5 lg:px-8 space-y-5"
          >
            {mergedTurnEntries.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-28 text-text-muted space-y-3 text-center">
                <p className="text-xs uppercase tracking-[0.16em] text-text-muted/80">
                  DeskWand
                </p>
                <p className="text-base text-text-secondary">
                  {t(
                    isHydratingHistoryState
                      ? "chat.loadingConversation"
                      : "chat.startConversation",
                  )}
                </p>
              </div>
            ) : (
              mergedTurnEntries.map((entry) =>
                "message" in entry ? (
                  (() => {
                    const {
                      message,
                      isStreaming,
                      isLatestRound,
                      artifactFiles,
                      videoReferences,
                      turnProcessSummary,
                      suppressProcessSummaries,
                    } = entry;
                    return (
                      <div
                        key={message.id}
                        data-message-id={message.id}
                        className="space-y-1.5"
                      >
                        {turnProcessSummary ? (
                          <ProcessSummaryBlock
                            block={turnProcessSummary}
                            message={message}
                          />
                        ) : null}
                        <MessageCard
                          message={message}
                          isStreaming={isStreaming}
                          isLatestRound={isLatestRound}
                          artifactFiles={artifactFiles}
                          videoReferences={videoReferences}
                          suppressProcessSummaries={suppressProcessSummaries}
                        />
                      </div>
                    );
                  })()
                ) : (
                  <div
                    key={entry.id}
                    className="flex items-center gap-2 px-1 text-xs"
                  >
                    <Navigation
                      className={`h-3.5 w-3.5 flex-shrink-0 ${
                        entry.status === "failed"
                          ? "text-error"
                          : "text-text-muted"
                      }`}
                    />
                    <span
                      className="min-w-0 flex-1 truncate text-text-secondary"
                      title={entry.text}
                    >
                      {entry.text}
                    </span>
                    <span
                      className={`flex-shrink-0 ${
                        entry.status === "failed" ? "text-error" : "text-text-muted"
                      }`}
                    >
                      {entry.status === "injecting" && (
                        <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
                      )}
                      {entry.status === "delivered" && (
                        <CheckCircle2 className="mr-1 inline h-3 w-3" />
                      )}
                      {entry.status === "failed" && (
                        <XCircle className="mr-1 inline h-3 w-3" />
                      )}
                      {entry.status === "injecting" && t("steer.injecting")}
                      {entry.status === "delivered" && t("steer.delivered")}
                      {entry.status === "failed" &&
                        `${t("steer.failed")}: ${
                          entry.reason === "no-active-session"
                            ? t("steer.reasonNoActiveSession")
                            : entry.reason === "sdk-error"
                              ? t("steer.reasonSdkError")
                              : t("steer.reasonSessionStopped")
                        }`}
                    </span>
                  </div>
                ),
              )
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        <button
          type="button"
          onClick={scrollToBottomByButton}
          aria-label="Scroll to bottom"
          className={`absolute right-5 lg:right-8 bottom-6 z-20 w-10 h-10 rounded-full bg-surface text-text-secondary hover:bg-surface-hover hover:text-text-primary shadow-elevated transition-all duration-200 flex items-center justify-center ${
            showScrollToBottom
              ? "opacity-100 scale-100 pointer-events-auto"
              : "opacity-0 scale-75 pointer-events-none"
          }`}
        >
          <ChevronsDown className="w-5 h-5" />
        </button>
      </div>

      {/* Input */}
      <div className="bg-transparent">
        {inputQueue.length > 0 && (
          <div className="max-w-[920px] mx-auto px-5 lg:px-8 pt-1">
            <ChatInputQueueBar
              items={inputQueue}
              onSteer={handleQueueSteer}
              onRemove={(id) =>
                activeSessionId && removeInput(activeSessionId, id)
              }
            />
          </div>
        )}
        <div className="max-w-[920px] mx-auto px-5 lg:px-8 pt-1">
          <ChatInputStatusBar
            status={inputStatus}
            onGoalCommand={handleCommand}
          />
        </div>
        <div className="max-w-[920px] mx-auto px-5 lg:px-8 pt-0.5 pb-5">
          <ChatInput
            ref={chatInputRef}
            onSubmit={handleSubmit}
            onCompact={handleCompact}
            onCommand={handleCommand}
            disabled={isSubmitting}
            submitDisabled={isCompacting}
            isExpanded={isInputExpanded}
            onToggleExpand={() => setIsInputExpanded((v) => !v)}
            placeholder={t("chat.typeMessage")}
            cardClassName="p-3.5 rounded-6xl bg-background/50 shadow-elevated"
            textareaClassName="w-full resize-none bg-transparent border-none outline-none focus:ring-0 text-text-primary placeholder:text-text-muted text-sm leading-relaxed py-2 overflow-hidden"
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
                  const group = modelOptions.find(
                    (g) => g.profileKey === profileKey,
                  );
                  if (!group?.items.some((i) => i.id === modelId)) return;
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
                        JSON.stringify({
                          p: profileKey,
                          m: modelId,
                          t: thinkingLevel,
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
                        JSON.stringify({
                          p: activeProviderProfileKey,
                          m: activeModel,
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
                contextUsagePercentage={contextUsagePercentage}
                contextRingColorClass={contextRingColorClass}
                contextUsageTooltip={contextUsageTooltip}
                canStop={canStop}
                onStop={handleStop}
                isSubmitting={isSubmitting}
                submitDisabled={isCompacting}
                isExpanded={isInputExpanded}
                onToggleExpand={() => setIsInputExpanded((v) => !v)}
              />
            }
          />
        </div>
      </div>
      <MessageNavRail
        ticks={railTicks}
        scrollContainerRef={scrollContainerRef}
        onTickSelect={handleDockTickSelect}
      />
    </div>
  );
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
