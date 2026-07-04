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
}

function isTraceBlock(block: ContentBlock): boolean {
  return block.type === "tool_use" || block.type === "tool_result";
}

export const MessageCard = memo(function MessageCard({
  message,
  isStreaming,
  hideTraceBlocks = false,
  isLatestRound = false,
  artifactFiles = [],
}: MessageCardProps) {
  const { t } = useTranslation();
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
    const blocks = buildToolDisplayBlocks(visibleBlocks);
    // Keep natural block order for the latest round so process summaries appear
    // in context. Reorder historical (completed) messages to group content first,
    // then results, then process summaries.
    if (isUser || isLatestRound) return blocks;
    return orderAssistantDisplayBlocks(blocks);
  }, [isUser, isLatestRound, visibleBlocks]);

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

  // Extract text content for copying
  const getTextContent = () =>
    visibleBlocks
      .filter((block) => block.type === "text")
      .map((block) => (block as { type: "text"; text: string }).text)
      .join("\n");

  const handleCopy = async () => {
    const text = getTextContent();
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

  if (!isUser && visibleBlocks.length === 0) {
    return null;
  }

  return (
    <div className="animate-fade-in">
      {isUser ? (
        // User message - compact styling with smaller padding and radius
        <div className="flex items-start gap-2 justify-end group">
          <div
            className={`message-user px-4 py-3 rounded-5xl max-w-[80%] min-w-0 break-words ${
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
          <button
            onClick={handleCopy}
            className="mt-1 w-6 h-6 flex items-center justify-center rounded-md bg-surface-muted hover:bg-surface-active transition-all opacity-0 group-hover:opacity-100 flex-shrink-0"
            title={t("messageCard.copyMessage")}
          >
            {copied ? (
              <Check className="w-3 h-3 text-success" />
            ) : (
              <Copy className="w-3 h-3 text-text-muted" />
            )}
          </button>
        </div>
      ) : (
        // Assistant message — no bubble, direct content (Agent style)
        <div className="space-y-1.5">
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
        </div>
      )}
    </div>
  );
});
