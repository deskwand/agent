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
  Square,
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
import { ArtifactInlineFrame } from "./message/ArtifactInlineFrame";
import type { InlineArtifactInfo } from "../utils/inline-artifacts";
import { useAppStore } from "../store";
import { useReadAloud } from "../hooks/useReadAloud";
import { Tooltip } from "./Tooltip";
import {
  projectNestedToolBlocks,
  projectNestedToolMessages,
} from "../utils/nested-tool-display";

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
  /** 本轮标记为内联渲染的产物（由 ChatView 聚合） */
  inlineArtifacts?: InlineArtifactInfo[];
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
function InlineArtifactList({
  artifacts,
  isLatestRound,
}: {
  artifacts: InlineArtifactInfo[];
  isLatestRound: boolean;
}) {
  const artifactKey = artifacts.map((artifact) => artifact.path).join("|");
  const [expandedOverride, setExpandedOverride] = useState<{
    key: string;
    path: string | null;
  } | null>(null);

  const defaultExpandedPath =
    isLatestRound && artifacts.length > 0
      ? artifacts[artifacts.length - 1].path
      : null;
  const expandedPath =
    expandedOverride && expandedOverride.key === artifactKey
      ? expandedOverride.path
      : defaultExpandedPath;

  return (
    <div className="space-y-1.5">
      {artifacts.map((artifact) => (
        <ArtifactInlineFrame
          key={artifact.path}
          artifact={artifact}
          expanded={expandedPath === artifact.path}
          onToggle={(path) =>
            setExpandedOverride({
              key: artifactKey,
              path: expandedPath === path ? null : path,
            })
          }
        />
      ))}
    </div>
  );
}

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
  inlineArtifacts = [],
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
  const rawVisibleBlocks = stripSyntheticBlocks(contentBlocks);
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
        <p className="text-sm text-text-primary">
          {t("topUp.insufficientCredits")}
        </p>
        <button
          className="w-fit rounded-lg bg-accent px-3 py-1.5 text-sm text-accent-foreground"
          onClick={() => useAppStore.getState().setTopUpOpen(true)}
        >
          {t("topUp.goTopUp")}
        </button>
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
    return (
      <div
        className={`flex items-center gap-3 opacity-0 group-hover:opacity-100 transition-[opacity,transform] duration-200 scale-90 group-hover:scale-100${extraClass ? ` ${extraClass}` : ""}`}
      >
        {showActions ? (
          <>
            <span className="text-xs text-text-muted select-none">
              {timestampLabel}
            </span>
            <Tooltip label={t("messageCard.copyMessage")}>
              <button
                onClick={handleCopy}
                aria-label={t("messageCard.copyMessage")}
                className="flex items-center gap-1 text-xs text-text-muted hover:text-text-primary transition-colors"
              >
                {copied ? (
                  <Check className="w-3 h-3 text-success" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
              </button>
            </Tooltip>
            {/* 朗读只给助手回复 —— showActions 对用户消息也为真（上面的
                `message.role !== "assistant"` 分支），所以这里必须自己挡一道。
                朗读已无能力开关：只要有可读文字就出现按钮，没文字时按钮置灰。 */}
            {!isUser ? (
              <>
                <Tooltip
                  label={
                    voiceRuntimeActive
                      ? t("messageCard.readAloudBusy")
                      : readingThis && reader.status === "playing"
                        ? t("messageCard.pauseReading")
                        : readingThis && reader.status === "paused"
                          ? t("messageCard.resumeReading")
                          : !readingThis && !speechAvailable
                            ? t("messageCard.readAloudEmpty")
                            : t("messageCard.readAloud")
                  }
                >
                  <button
                    type="button"
                    data-testid="read-aloud-button"
                    disabled={
                      voiceRuntimeActive || (!readingThis && !speechAvailable)
                    }
                    aria-label={t("messageCard.readAloud")}
                    onClick={() => {
                      if (readingThis) {
                        reader.toggle();
                      } else if (bodyRef.current) {
                        startKeyRef.current = getCopyContent();
                        reader.start(message.id, bodyRef.current);
                      }
                    }}
                    className="flex items-center gap-1 text-xs text-text-muted transition-colors hover:text-text-primary disabled:opacity-40"
                  >
                    {readingThis &&
                    (reader.status === "playing" ||
                      reader.status === "preparing") ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : readingThis && reader.status === "paused" ? (
                      <Play className="w-3 h-3" />
                    ) : (
                      <Volume2 className="w-3 h-3" />
                    )}
                  </button>
                </Tooltip>
                {readingThis &&
                reader.status !== "idle" &&
                reader.status !== "error" ? (
                  <>
                    <button
                      type="button"
                      data-testid="stop-reading-button"
                      aria-label={t("messageCard.stopReading")}
                      onClick={() => reader.stop()}
                      className="flex items-center gap-1 text-xs text-text-muted transition-colors hover:text-text-primary"
                    >
                      <Square className="w-3 h-3" />
                    </button>
                    <span className="text-xs text-text-muted tabular-nums">
                      {t("messageCard.readAloudProgress", {
                        current: reader.currentIndex + 1,
                        total: reader.total,
                      })}
                    </span>
                  </>
                ) : null}
                {/* 没装模型 / 引擎起不来时，错误就落在这里，并指路到设置 ——
                    不做第二条「提示条 + 下载按钮」的 UI 路径，少一条状态就少一批 bug。 */}
                {readingThis && reader.status === "error" ? (
                  <span className="text-xs text-error">
                    {t("messageCard.readAloudFailed")}
                  </span>
                ) : null}
              </>
            ) : null}
          </>
        ) : null}
        {showFork ? (
          <Tooltip label={t("messageCard.forkMessage")}>
            <button
              type="button"
              onClick={() => onForkMessage(message)}
              aria-label={t("messageCard.forkMessage")}
              className="flex items-center gap-1 text-xs text-text-muted hover:text-text-primary transition-colors"
            >
              <GitBranch className="w-3 h-3" />
            </button>
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
                <div className="mb-1 flex items-center gap-1 text-xs text-text-muted">
                  <Clock className="w-3 h-3" />
                  <span>{t("messageCard.queued")}</span>
                </div>
              )}
              {isCancelled && (
                <div className="mb-1 flex items-center gap-1 text-xs text-text-muted">
                  <XCircle className="w-3 h-3" />
                  <span>{t("messageCard.cancelled")}</span>
                </div>
              )}
              {isUser && message.elSelections?.length ? (
                <ElementRefChips selections={message.elSelections} />
              ) : null}
              {visibleBlocks.length === 0 &&
              !(isUser && message.elSelections?.length) ? (
                <span className="text-text-muted italic">
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
          {/* bodyRef 只圈正文块：下面的操作栏（时间戳 / 进度）不参与切句。 */}
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
          {inlineArtifacts.length > 0 ? (
            <InlineArtifactList
              artifacts={inlineArtifacts}
              isLatestRound={isLatestRound}
            />
          ) : null}
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
