// MessageCard — top-level chat message renderer.
// Delegates block rendering to ContentBlockView and its sub-components.
import { useState, memo, useMemo, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  Copy,
  Check,
  Clock,
  XCircle,
  GitBranch,
  Volume2,
  Play,
  Loader2,
  Pause,
} from "lucide-react";
import type {
  Message,
  ContentBlock,
  ToolUseContent,
  ToolResultContent,
} from "../types";
import {
  buildToolDisplayBlocks,
  orderAssistantDisplayBlocks,
} from "../utils/tool-display-blocks";
import type { ResultFileEntry } from "../utils/tool-display-blocks";
import type { VideoReference } from "../utils/video-reference";
import { ContentBlockView } from "./message/ContentBlockView";
import { ElementRefChips } from "./message/ElementRefChips";
import { stripSyntheticBlocks } from "../utils/synthetic-blocks";
import { ProcessSummaryBlock } from "./message/ProcessSummaryBlock";
import { ResultSummaryBlock } from "./message/ResultSummaryBlock";
import { ArtifactCard } from "./message/ArtifactCard";
import { splitArtifactBlocks } from "../utils/inline-artifacts";
import type { ArtifactExpansion } from "../types";
import { useAppStore } from "../store";
import { useReadAloud } from "../hooks/useReadAloud";
import { getCapabilityGate } from "../capabilities/capability-gate";
import {
  isLatestReadIntent,
  nextReadIntent,
  shouldAutoStartReadAloud,
} from "../utils/voice/read-aloud-gate";
import { Tooltip, TooltipContent, TooltipTrigger } from "./app-tooltip";
import {
  projectNestedToolBlocks,
  projectNestedToolMessages,
} from "../utils/nested-tool-display";
import { Button } from "./app-button";

const EMPTY_NESTED_CALLS = {};
const EMPTY_MESSAGES: Message[] = [];

interface MessageCardProps {
  toolBlocksProjected?: boolean;
  toolLookupBlocks?: ContentBlock[];
  message: Message;
  isStreaming?: boolean;
  /** Whether this turn is the latest (actively streaming or just completed) */
  isLatestRound?: boolean;
  /** Whether this message ends its assistant turn. Defaults to true. */
  isTurnEnd?: boolean;
  /** Files changed in this turn (aggregated by ChatView) */
  artifactFiles?: ResultFileEntry[];
  /** Local videos referenced by assistant text in this turn. */
  videoReferences?: VideoReference[];
  /** Hide process summaries when ChatView renders a turn-level summary. */
  suppressProcessSummaries?: boolean;
  /** 分叉入口：仅助手消息显示（tool_result 行/流式中/排队中/已取消除外） */
  onForkMessage?: (message: Message) => void;
}

/**
 * 一轮里的内联产物。只展开最新的一个，历史轮次默认全折叠。
 *
 * "展开哪个"放在这里而不是 MessageCard：展开会重渲染，没必要把整张消息卡带上。
 * 也不用 useEffect 同步默认值：`artifacts` 的数组身份会随每次 trace step 更新而变，
 * 用 effect 会在流式过程中反复把用户刚折叠的动作弹回去。改成"用户的选择带上集合键"，
 * 键变了才回落到默认值。
 */
function formatRelativeTime(timestamp: number, locale: string): string {
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  const date = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, "0");
  const timeStr = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const isZh = locale.startsWith("zh");

  if (diffSec < 60) return isZh ? "刚刚" : "Just now";
  if (diffMin < 60) return isZh ? `${diffMin} 分钟前` : `${diffMin} min ago`;
  if (diffHour < 24) return isZh ? `${diffHour} 小时前` : `${diffHour} h ago`;
  if (diffDay < 2) return isZh ? `昨天 ${timeStr}` : `Yesterday ${timeStr}`;
  if (diffDay < 7) return isZh ? `${diffDay} 天前` : `${diffDay} days ago`;

  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  if (date.getFullYear() === new Date().getFullYear()) {
    return `${month}-${day} ${timeStr}`;
  }
  return `${date.getFullYear()}-${month}-${day} ${timeStr}`;
}

export const MessageCard = memo(function MessageCard({
  message,
  isStreaming,
  isLatestRound = false,
  isTurnEnd = true,
  artifactFiles = [],
  videoReferences = [],
  suppressProcessSummaries = false,
  toolBlocksProjected = false,
  toolLookupBlocks,
  onForkMessage,
}: MessageCardProps) {
  const { t, i18n } = useTranslation();

  const isUser = message.role === "user";
  const isQueued = message.localStatus === "queued";
  const isCancelled = message.localStatus === "cancelled";
  // 工具结果独立行（role=assistant + 单个 tool_result 块）不可作为分叉点
  const isToolResultRow =
    message.role === "assistant" &&
    message.content.length === 1 &&
    message.content[0].type === "tool_result";
  const rawContent = message.content as unknown;
  const contentBlocks = Array.isArray(rawContent)
    ? (rawContent as ContentBlock[])
    : [{ type: "text", text: String(rawContent ?? "") } as ContentBlock];
  const rawVisibleBlocks = splitArtifactBlocks(
    stripSyntheticBlocks(contentBlocks),
    {
      streaming: Boolean(isStreaming),
    },
  );

  // 只有最新的展开，历史默认折叠。产物块来自消息自身的内容，所以"集合键"就是这条消息的产物路径串，
  // 键变了才回落到默认值——用户手动折叠不会被无关重渲染弹回去。
  const artifactPaths = useMemo(
    () =>
      rawVisibleBlocks
        .filter((block) => block.type === "artifact")
        .map((block) => (block as { path: string }).path),
    [rawVisibleBlocks],
  );
  const artifactKey = artifactPaths.join("|");
  const [expandedOverride, setExpandedOverride] = useState<{
    key: string;
    path: string | null;
  } | null>(null);
  const expandedArtifactPath =
    expandedOverride && expandedOverride.key === artifactKey
      ? expandedOverride.path
      : isLatestRound && artifactPaths.length > 0
        ? artifactPaths[artifactPaths.length - 1]
        : null;
  const artifactExpansion = useMemo<ArtifactExpansion>(
    () => ({
      expandedPath: expandedArtifactPath,
      onToggle: (path) =>
        setExpandedOverride({
          key: artifactKey,
          path: expandedArtifactPath === path ? null : path,
        }),
    }),
    [expandedArtifactPath, artifactKey],
  );
  const sessionMessages = useAppStore(
    (s) => s.sessionStates[message.sessionId]?.messages ?? EMPTY_MESSAGES,
  );
  const nestedCalls = useAppStore(
    (s) =>
      s.sessionStates[message.sessionId]?.nestedToolCalls ?? EMPTY_NESTED_CALLS,
  );
  const activeTurnId = useAppStore(
    (s) => s.sessionStates[message.sessionId]?.activeTurn?.turnId,
  );
  const sameTurnMessages = useMemo(
    () =>
      toolBlocksProjected
        ? EMPTY_MESSAGES
        : sessionMessages.filter(
            (item) =>
              item.role === "assistant" &&
              Array.isArray(item.content) &&
              Boolean(message.turnId) &&
              item.turnId === message.turnId,
          ),
    [toolBlocksProjected, sessionMessages, message.turnId],
  );
  const lookupBlocks = sameTurnMessages.length
    ? sameTurnMessages.flatMap((item) => item.content)
    : rawVisibleBlocks;
  const visibleBlocks =
    toolBlocksProjected || isUser
      ? rawVisibleBlocks
      : projectNestedToolBlocks(
          rawVisibleBlocks,
          nestedCalls,
          Boolean(activeTurnId) && message.turnId === activeTurnId,
          lookupBlocks,
        );
  const projectedLookup = useMemo(
    () =>
      sameTurnMessages.length
        ? projectNestedToolMessages(
            sameTurnMessages,
            nestedCalls,
            activeTurnId,
          ).flatMap((item) => item.content)
        : undefined,
    [sameTurnMessages, nestedCalls, activeTurnId],
  );
  // 跨消息查表只服务助手侧「tool_use / tool_result 落在不同 entry」的配对：表里
  // 只有 assistant 块。用户消息拿它当块表，会丢掉这一轮自己的块（历史回合里图片
  // 块没了 → 点图不开预览）。用户消息只看自己的块：它们不带工具块（见
  // entries-to-messages），跨回合查表对它们没有意义。
  const allDisplayBlocks = isUser
    ? visibleBlocks
    : (toolLookupBlocks ?? projectedLookup ?? visibleBlocks);

  const lastTextBlockIndex = useMemo(() => {
    let idx = -1;
    visibleBlocks.forEach((b, i) => {
      if (b.type === "text") idx = i;
    });
    return idx;
  }, [visibleBlocks]);
  const [copied, setCopied] = useState(false);

  // Build a set of tool_result IDs that have a matching tool_use (for merging)
  const mergedResultIds = useMemo(() => {
    const ids = new Set<string>();
    for (const b of visibleBlocks) {
      if (b.type === "tool_use") {
        const tu = b as ToolUseContent;
        const result = visibleBlocks.find(
          (r) =>
            r.type === "tool_result" &&
            (r as ToolResultContent).toolUseId === tu.id,
        );
        if (result) ids.add((result as ToolResultContent).toolUseId);
      }
    }
    return ids;
  }, [visibleBlocks]);
  const groupedDisplayBlocks = useMemo(() => {
    const blocks = buildToolDisplayBlocks(
      visibleBlocks,
      allDisplayBlocks,
    ).filter(
      (block) => !suppressProcessSummaries || block.type !== "process-summary",
    );
    // Keep natural block order for the latest round so process summaries appear
    // in context. Reorder historical (completed) messages to group content first,
    // then results, then process summaries.
    if (isUser || isLatestRound) return blocks;
    return orderAssistantDisplayBlocks(blocks);
  }, [
    isUser,
    isLatestRound,
    suppressProcessSummaries,
    visibleBlocks,
    allDisplayBlocks,
  ]);

  // Group consecutive summary blocks so they render with tighter spacing,
  // matching inline text rhythm (historical messages where blocks are reordered).
  const renderGroups = useMemo(() => {
    type Group =
      | { kind: "single"; block: (typeof groupedDisplayBlocks)[number] }
      | { kind: "summary-group"; blocks: typeof groupedDisplayBlocks };
    const groups: Group[] = [];
    let pending: typeof groupedDisplayBlocks = [];

    const flush = () => {
      if (pending.length === 0) return;
      groups.push({ kind: "summary-group", blocks: [...pending] });
      pending = [];
    };

    for (const b of groupedDisplayBlocks) {
      if (b.type === "process-summary" || b.type === "result-summary") {
        pending.push(b);
      } else {
        flush();
        groups.push({ kind: "single", block: b });
      }
    }
    flush();
    return groups;
  }, [groupedDisplayBlocks]);

  // Extract all text content for copying. For assistant messages all visible
  // text blocks include markdown code fences — no separate code block type exists.
  const getCopyContent = (): string =>
    visibleBlocks
      .filter(
        (block): block is { type: "text"; text: string } =>
          block.type === "text",
      )
      .map((block) => block.text)
      .join("\n");

  // 朗读：正文容器的 ref。切句与高亮都只读这份 DOM，不改 markdown。
  const bodyRef = useRef<HTMLDivElement>(null);
  const reader = useReadAloud();
  // 朗读前的能力门（缺 TTS → 确认下载 → 装好自动开始）。与麦克风那条路无关。
  //
  // **取动作、不订阅**：`useCapabilityGate()` 会订阅整片 gate 状态，而每张消息卡
  // 都调一次 —— 下载期间进度事件每 ~100ms 一条，那会把整条消息列表重渲染。
  const gate = getCapabilityGate();
  // 语音运行时独占音频：全屏在放回答、后台也在听，两路声音不能同时响。
  const voiceRuntimeActive = useAppStore((s) => s.voiceModeOpen);
  const readingThis = reader.messageId === message.id;
  // 「有没有可读的文字」用已有的 visibleBlocks 判断，不去读 DOM ——
  // 正文一律是 text 块（代码块也是 text，会被念成「代码块，共 N 行」），
  // 只有纯图片消息会落到 false。
  const speechAvailable = visibleBlocks.some(
    (block) => block.type === "text" && block.text.trim().length > 0,
  );

  const startKeyRef = useRef<string | null>(null);
  const readerRef = useRef(reader);
  readerRef.current = reader;

  // 消息被卸载（被删除 / 切了会话）就停 —— 否则高亮会落在已经不在的 DOM 上
  useEffect(
    () => () => {
      if (readerRef.current.messageId === message.id) readerRef.current.stop();
    },
    [message.id],
  );

  // 正文变了就停：句子表是开播时的快照，改了就对不上了（不做增量对齐）
  const speechKey = getCopyContent();
  useEffect(() => {
    if (!readingThis) {
      startKeyRef.current = null;
      return;
    }
    if (startKeyRef.current !== null && speechKey !== startKeyRef.current) {
      reader.stop();
    }
  }, [speechKey, readingThis, reader]);

  // 余额不足（402 INSUFFICIENT_BALANCE）：渲染充值引导卡片，替代原始错误文本
  if (message.code === "INSUFFICIENT_BALANCE") {
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4">
        <p className="text-sm text-foreground">
          {t("topUp.insufficientCredits")}
        </p>
        <Button
          variant="ghost"
          className="w-fit rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground h-auto hover:bg-transparent hover:text-current"
          onClick={() => useAppStore.getState().setTopUpOpen(true)}
        >
          {t("topUp.goTopUp")}
        </Button>
      </div>
    );
  }

  const canFork =
    message.role === "assistant" &&
    isTurnEnd &&
    !isToolResultRow &&
    !isQueued &&
    !isCancelled &&
    !isStreaming &&
    groupedDisplayBlocks.length > 0;

  const showActions =
    (message.role !== "assistant" || isTurnEnd) &&
    !isStreaming &&
    !isQueued &&
    !isCancelled &&
    groupedDisplayBlocks.length > 0;

  const handleCopy = async () => {
    const text = getCopyContent();
    if (text) {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        // Clipboard unavailable
      }
    }
  };

  const timestampLabel = formatRelativeTime(message.timestamp, i18n.language);

  const renderActionBar = (extraClass?: string) => {
    const showFork = canFork && onForkMessage;
    if (!showActions && !showFork) return null;
    // ⚠️ 图标按钮一律走 `iconSm`（28×28，与 `BrowserPanel` / `TitlebarButton` 的图标键同尺寸 ✓
    // —— 那两处现在也传 `size="iconSm"` 了；**手写 `w-7 h-7` 只有 32×28**，不是 28×28 ✗，
    // 2026-10-10 实测见 `app-button.tsx` 紧凑档说明 ✓）
    // —— 缺省档是 `h-9 px-4 py-2`，而这四处原先只写 `h-auto`：高度归了内容、**内边距仍是 base 的
    // 16/8** ⇒ 16px 图标被撑成 **48×32 的方块**（2026-10-10 用户报障「元数据的这个框太大了」✓；
    // Chromium 量测见 `app-button.tsx` 紧凑档说明 ✓）。
    // ⚠️ 图标上写的 `w-3 h-3` 是**死代码** ✗：base 的 `[&_svg]:size-4`（特异性 0,1,1）稳压它，
    // 而且调用点再写 `[&_svg]:size-3` 也赢不了（2026-10-10 实测 ✓）⇒ 实际渲染 16px ✓，28×28 盒
    // 子里的视觉留白是 6px，**别照 `w-3` 去推算** ✗✓。
    // ⚠️ `justify-center` **必须显式写** ✗✗：写了 `flex` 又没写 `justify-*` 时，`app-button` 的
    // `shouldLeftAlign()` 会注入 `justify-start`（它的判据是「原生 `<button class="flex">` 本来就居左」）
    // ⇒ 图标会贴着左边（2026-10-10 实测：左 0 / 右 12；显式 `justify-center` 后 6 / 6 ✓）。
    // ⚠️ `hover:bg-transparent` 也是**有意**的：这排只要颜色反馈、不要灰底（`cn` 合并后 ghost 的
    // `hover:bg-accent` 会被删掉 ✓；2026-10-10 用户：图标带底色看着重）。
    // 读屏名与 tooltip 同一份来源：图标会在四个字形间变，读屏用户听到的必须是当前那一下的动作。
    const readAloudLabel = voiceRuntimeActive
      ? t("messageCard.readAloudBusy")
      : readingThis && reader.status === "preparing"
        ? t("messageCard.stopReading")
        : readingThis && reader.status === "playing"
          ? t("messageCard.pauseReading")
          : readingThis && reader.status === "paused"
            ? t("messageCard.resumeReading")
            : !readingThis && !speechAvailable
              ? t("messageCard.readAloudEmpty")
              : t("messageCard.readAloud");

    return (
      <div
        className={`flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-[opacity,transform] duration-200 scale-90 group-hover:scale-100${extraClass ? ` ${extraClass}` : ""}`}
      >
        {showActions ? (
          <>
            <span className="mr-1 text-xs text-muted-foreground select-none">
              {timestampLabel}
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="iconSm"
                  onClick={handleCopy}
                  aria-label={t("messageCard.copyMessage")}
                  className="flex items-center justify-center hover:bg-transparent text-muted-foreground hover:text-foreground transition-colors"
                >
                  {copied ? (
                    <Check className="w-3 h-3 text-success" />
                  ) : (
                    <Copy className="w-3 h-3" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {t("messageCard.copyMessage")}
              </TooltipContent>
            </Tooltip>
            {/* 朗读只给助手回复 —— showActions 对用户消息也为真（上面的
                `message.role !== "assistant"` 分支），所以这里必须自己挡一道。
                朗读已无能力开关：只要有可读文字就出现按钮，没文字时按钮置灰。 */}
            {!isUser ? (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      type="button"
                      size="iconSm"
                      data-testid="read-aloud-button"
                      disabled={
                        voiceRuntimeActive || (!readingThis && !speechAvailable)
                      }
                      aria-label={readAloudLabel}
                      onClick={() => {
                        // 这颗键是朗读的唯一入口（停止键已删）⇒ 四条「点了没反应」的路
                        // 都必须补上：preparing → 取消；其它非 error → 暂停/继续；
                        // error → 重试；缺 TTS 模型 → 先装（装好由下面的门续上自动开始）。
                        if (readingThis && reader.status === "preparing") {
                          reader.stop();
                          return;
                        }
                        if (readingThis && reader.status !== "error") {
                          reader.toggle();
                          return;
                        }
                        if (!bodyRef.current) return;
                        const attempt = nextReadIntent();
                        const start = () => {
                          startKeyRef.current = getCopyContent();
                          readerRef.current.start(message.id, bodyRef.current!);
                        };
                        void gate.ensureReady("voice").then((outcome) => {
                          if (outcome === "ready") {
                            start();
                            return;
                          }
                          // busy / failed / unsupported：什么都不做（失败已由门报过）。
                          if (outcome !== "cancelled") return;
                          // 弹窗已打开：装好之后如果护栏还成立就自动开始，
                          // 否则只给一条"再点一次"的提示（不自动出声）。
                          void gate.whenReady("voice").then(() => {
                            const ok = shouldAutoStartReadAloud({
                              messageMounted: bodyRef.current !== null,
                              messageStillCurrent: isLatestReadIntent(attempt),
                              voiceRuntimeOpen:
                                useAppStore.getState().voiceModeOpen,
                              noReadStartedSince: !readerRef.current.messageId,
                            });
                            if (ok) {
                              start();
                              return;
                            }
                            // 四条护栏有一条不成立：不自动出声，只给一条"再点一次"
                            // （spec §2.6）。静默什么都不说是不行的 —— 用户刚为它下了模型。
                            useAppStore.getState().setGlobalNotice({
                              id: `read-aloud-ready-${message.id}`,
                              message: "",
                              messageKey: "messageCard.readAloudReadyAgain",
                              type: "info",
                            });
                          });
                        });
                      }}
                      className="flex items-center justify-center hover:bg-transparent text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                    >
                      {readingThis && reader.status === "preparing" ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : readingThis && reader.status === "playing" ? (
                        // 2026-10-10：播放中给「暂停」条。旧版这里是转圈 —— 转圈是「忙」的
                        // 语汇，不是「能点」的语汇，而它这一下点的正是暂停。
                        <Pause className="w-3 h-3" />
                      ) : readingThis && reader.status === "paused" ? (
                        <Play className="w-3 h-3" />
                      ) : (
                        <Volume2 className="w-3 h-3" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {readAloudLabel}
                  </TooltipContent>
                </Tooltip>
                {/* 停止键与「第 X / Y 句」进度已删（2026-10-10 用户：朗读就一个图标 ✓）。
                    停下来的路径都不在这排里：消息卸载与正文变化（上面的两个 effect）、
                    语音会话（useVoiceMode.ts:241）、收听（store/index.ts:1466）各自 stopReadAloud；
                    还没出声时的取消由这颗键自己承担（preparing 分支）。 */}
                {/* 没装模型 / 引擎起不来时，错误就落在这里，并指路到设置 ——
                    不做第二条「提示条 + 下载按钮」的 UI 路径，少一条状态就少一批 bug。 */}
                {readingThis && reader.status === "error" ? (
                  <span className="text-xs text-destructive">
                    {t("messageCard.readAloudFailed")}
                  </span>
                ) : null}
              </>
            ) : null}
          </>
        ) : null}
        {showFork ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                type="button"
                size="iconSm"
                onClick={() => onForkMessage(message)}
                aria-label={t("messageCard.forkMessage")}
                className="flex items-center justify-center hover:bg-transparent text-muted-foreground hover:text-foreground transition-colors"
              >
                <GitBranch className="w-3 h-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {t("messageCard.forkMessage")}
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    );
  };

  if (!isUser && visibleBlocks.length === 0) {
    return null;
  }

  return (
    <div>
      {isUser ? (
        // User message — compact bubble with action bar below
        <div className="flex justify-end group">
          <div className="max-w-[80%] min-w-0 flex flex-col items-end">
            <div
              className={`message-user px-4 py-3 rounded-xl min-w-0 break-words ${
                isQueued ? "opacity-70 border-dashed" : ""
              } ${isCancelled ? "opacity-60" : ""}`}
            >
              {isQueued && (
                <div className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="w-3 h-3" />
                  <span>{t("messageCard.queued")}</span>
                </div>
              )}
              {isCancelled && (
                <div className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
                  <XCircle className="w-3 h-3" />
                  <span>{t("messageCard.cancelled")}</span>
                </div>
              )}
              {isUser && message.elSelections?.length ? (
                <ElementRefChips selections={message.elSelections} />
              ) : null}
              {visibleBlocks.length === 0 &&
              !(isUser && message.elSelections?.length) ? (
                <span className="text-muted-foreground italic">
                  {t("messageCard.emptyMessage")}
                </span>
              ) : (
                visibleBlocks.map((block, index) => (
                  <ContentBlockView
                    key={
                      "id" in block
                        ? (block as { id: string }).id
                        : `block-${block.type}-${index}`
                    }
                    block={block}
                    artifactExpansion={artifactExpansion}
                    isUser={isUser}
                    isStreaming={
                      isStreaming &&
                      (block.type !== "text" || index === lastTextBlockIndex)
                    }
                    allBlocks={allDisplayBlocks}
                  />
                ))
              )}
            </div>
            {renderActionBar("mt-0.5")}
          </div>
        </div>
      ) : (
        // Assistant message — no bubble, direct content with action bar below
        <div className="group space-y-1.5">
          {/* bodyRef 只圈正文块：下面的操作栏（时间戳）不参与切句。 */}
          <div ref={bodyRef} className="space-y-1.5">
            {renderGroups.map((group, gi) => {
              if (group.kind === "summary-group") {
                return (
                  <div key={`sg-${gi}`} className="space-y-0.5">
                    {group.blocks.map((b, bi) => {
                      if (b.type === "process-summary") {
                        return (
                          <ProcessSummaryBlock
                            key={`proc-${gi}-${bi}`}
                            block={b}
                            allBlocks={allDisplayBlocks}
                            message={message}
                          />
                        );
                      }
                      if (b.type === "result-summary") {
                        return (
                          <ResultSummaryBlock
                            key={`res-${gi}-${bi}`}
                            block={b}
                            allBlocks={allDisplayBlocks}
                            message={message}
                          />
                        );
                      }
                      return null;
                    })}
                  </div>
                );
              }

              // Non-summary blocks are always content blocks
              const displayBlock = group.block;
              if (displayBlock.type !== "content") return null;
              const { block } = displayBlock;
              if (
                block.type === "tool_result" &&
                mergedResultIds.has((block as ToolResultContent).toolUseId)
              ) {
                return null;
              }
              return (
                <ContentBlockView
                  key={
                    "id" in block
                      ? (block as { id: string }).id
                      : `block-${block.type}-${gi}`
                  }
                  block={block}
                  artifactExpansion={artifactExpansion}
                  isUser={isUser}
                  isStreaming={
                    isStreaming &&
                    (block.type !== "text" || gi === lastTextBlockIndex)
                  }
                  allBlocks={allDisplayBlocks}
                  message={message}
                />
              );
            })}
          </div>
          {artifactFiles.length > 0 || videoReferences.length > 0 ? (
            <ArtifactCard
              files={artifactFiles}
              videoReferences={videoReferences}
              isLatestRound={isLatestRound}
            />
          ) : null}
          {/* 与正文同一个 4px 台阶：元数据行不能伸出正文左边缘。 */}
          {renderActionBar("pl-1")}
        </div>
      )}
    </div>
  );
});
