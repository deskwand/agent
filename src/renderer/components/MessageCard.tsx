// MessageCard — top-level chat message renderer.
// Delegates block rendering to ContentBlockView and its sub-components.
import { useState, memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Copy, Check, Clock, XCircle } from "lucide-react";
import type {
  Message,
  ContentBlock,
  ToolUseContent,
  ToolResultContent,
} from "../types";
import {
  buildToolDisplayBlocks,
  filterAssistantVisibleBlocks,
  orderAssistantDisplayBlocks,
} from "../utils/tool-display-blocks";
import type { ResultFileEntry } from "../utils/tool-display-blocks";
import { ContentBlockView } from "./message/ContentBlockView";
import { ProcessSummaryBlock } from "./message/ProcessSummaryBlock";
import { ResultSummaryBlock } from "./message/ResultSummaryBlock";
import { ArtifactCard } from "./message/ArtifactCard";

interface MessageCardProps {
  message: Message;
  isStreaming?: boolean;
  hideTraceBlocks?: boolean;
  /** Whether this turn is the latest (actively streaming or just completed) */
  isLatestRound?: boolean;
  /** Files changed in this turn (aggregated by ChatView) */
  artifactFiles?: ResultFileEntry[];
  /** Hide process summaries when ChatView renders a turn-level summary. */
  suppressProcessSummaries?: boolean;
}

function isTraceBlock(block: ContentBlock): boolean {
  return block.type === "tool_use" || block.type === "tool_result";
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
  hideTraceBlocks = false,
  isLatestRound = false,
  artifactFiles = [],
  suppressProcessSummaries = false,
}: MessageCardProps) {
  const { t, i18n } = useTranslation();
  const isUser = message.role === "user";
  const isQueued = message.localStatus === "queued";
  const isCancelled = message.localStatus === "cancelled";
  const rawContent = message.content as unknown;
  const contentBlocks = Array.isArray(rawContent)
    ? (rawContent as ContentBlock[])
    : [{ type: "text", text: String(rawContent ?? "") } as ContentBlock];
  const visibleBlocks = isUser
    ? hideTraceBlocks
      ? contentBlocks.filter((block) => !isTraceBlock(block))
      : contentBlocks
    : filterAssistantVisibleBlocks(contentBlocks, hideTraceBlocks);
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
    const blocks = buildToolDisplayBlocks(visibleBlocks).filter(
      (block) =>
        !suppressProcessSummaries || block.type !== "process-summary",
    );
    // Keep natural block order for the latest round so process summaries appear
    // in context. Reorder historical (completed) messages to group content first,
    // then results, then process summaries.
    if (isUser || isLatestRound) return blocks;
    return orderAssistantDisplayBlocks(blocks);
  }, [isUser, isLatestRound, suppressProcessSummaries, visibleBlocks]);

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

  const showActions = !isStreaming && !isQueued && !isCancelled;

  // Extract all text content for copying. For assistant messages all visible
  // text blocks include markdown code fences — no separate code block type exists.
  const getCopyContent = (): string =>
    visibleBlocks
      .filter((block): block is { type: "text"; text: string } => block.type === "text")
      .map((block) => block.text)
      .join("\n");

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

  const renderActionBar = (extraClass?: string) => (
    <div
      className={`flex items-center gap-3 opacity-0 group-hover:opacity-100 transition-opacity${extraClass ? ` ${extraClass}` : ""}`}
    >
      <span className="text-xs text-text-muted select-none">
        {timestampLabel}
      </span>
      <button
        onClick={handleCopy}
        className="flex items-center gap-1 text-xs text-text-muted hover:text-text-primary transition-colors"
        title={t("messageCard.copyMessage")}
      >
        {copied ? (
          <Check className="w-3 h-3 text-success" />
        ) : (
          <Copy className="w-3 h-3" />
        )}
      </button>
    </div>
  );

  if (!isUser && visibleBlocks.length === 0) {
    return null;
  }

  return (
    <div className="eff-message-enter">
      {isUser ? (
        // User message — compact bubble with action bar below
        <div className="flex justify-end group">
          <div className="max-w-[80%] min-w-0 flex flex-col items-end">
            <div
              className={`message-user px-4 py-3 rounded-5xl min-w-0 break-words ${
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
              {visibleBlocks.length === 0 ? (
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
                    allBlocks={visibleBlocks}
                  />
                ))
              )}
            </div>
            {showActions && renderActionBar("mt-0.5")}
          </div>
        </div>
      ) : (
        // Assistant message — no bubble, direct content with action bar below
        <div className="group space-y-1.5">
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
                          allBlocks={visibleBlocks}
                          message={message}
                        />
                      );
                    }
                    if (b.type === "result-summary") {
                      return (
                        <ResultSummaryBlock
                          key={`res-${gi}-${bi}`}
                          block={b}
                          allBlocks={visibleBlocks}
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
                allBlocks={visibleBlocks}
                message={message}
              />
            );
          })}
          {artifactFiles.length > 0 ? (
            <ArtifactCard
              files={artifactFiles}
              isLatestRound={isLatestRound}
            />
          ) : null}
          {showActions && renderActionBar()}
        </div>
      )}
    </div>
  );
});
