// Compact tool row — single-line summary for use inside ProcessSummaryBlock
// Click to expand into full ToolUseBlock content.
import { useState, memo } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, ChevronDown, Loader2, XCircle, CheckCircle2 } from "lucide-react";
import { useAppStore } from "../../store";
import {
  findToolResult,
  getCollapsedToolSummary,
  formatCollapsedToolSummary,
} from "../../utils/tool-result-summary";
import { getToolIcon, getToolLabel } from "./toolHelpers";
import { ToolUseBlock } from "./ToolUseBlock";
import type { ToolUseContent, ContentBlock, Message } from "../../types";

interface CompactToolRowProps {
  block: ToolUseContent;
  allBlocks?: ContentBlock[];
  message?: Message;
}

export const CompactToolRow = memo(function CompactToolRow({
  block,
  allBlocks,
  message,
}: CompactToolRowProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const traceSteps = useAppStore((s) =>
    message?.sessionId
      ? (s.sessionStates[message.sessionId]?.traceSteps ?? [])
      : [],
  );
  const activeTurn = useAppStore((s) =>
    message?.sessionId
      ? (s.sessionStates[message.sessionId]?.activeTurn ?? null)
      : null,
  );
  const allMessages = useAppStore((s) =>
    message?.sessionId
      ? (s.sessionStates[message.sessionId]?.messages ?? [])
      : [],
  );

  const toolResult = findToolResult(block.id, allBlocks, allMessages);
  const hasActiveTurn = Boolean(activeTurn);
  const isRunning = !toolResult && hasActiveTurn;
  const isError = toolResult?.isError === true;

  const label = getToolLabel(block.name, block.input, t);
  const collapsedSummary = getCollapsedToolSummary(
    block.name,
    toolResult?.content,
    isError,
    Boolean(toolResult),
    toolResult?.diff,
  );
  const collapsedSummaryText = formatCollapsedToolSummary(collapsedSummary, t);

  // Duration from trace steps
  let duration: number | undefined;
  if (message?.sessionId) {
    const resultStep = traceSteps.find(
      (s) => s.id === block.id && s.type === "tool_result",
    );
    duration = resultStep?.duration;
  }
  const durationText =
    duration !== undefined
      ? duration < 1000
        ? `${duration}ms`
        : `${(duration / 1000).toFixed(1)}s`
      : null;

  // Build meta fragments
  const metaFragments: string[] = [];
  if (!isRunning && collapsedSummaryText) {
    metaFragments.push(collapsedSummaryText);
  }
  if (durationText) {
    metaFragments.push(durationText);
  }
  const meta = metaFragments.join(" · ");

  return (
    <div>
      {/* Compact row */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="group flex w-full items-center gap-2 py-1 pr-2 text-left hover:bg-surface-hover/30 transition-colors rounded"
      >
        {/* Status icon */}
        <span className="flex-shrink-0 flex items-center">
          {isRunning ? (
            <Loader2 className="w-3 h-3 animate-spin text-text-muted" />
          ) : isError ? (
            <XCircle className="w-3 h-3 text-error" />
          ) : (
            <CheckCircle2 className="w-3 h-3 text-text-muted" />
          )}
        </span>

        {/* Tool icon */}
        <span className="flex-shrink-0 text-text-muted">
          {getToolIcon(block.name)}
        </span>

        {/* Label — full width, no truncation */}
        <span className="flex-1 min-w-0 text-xs text-text-secondary font-mono break-all">
          {label}
        </span>

        {/* Meta (right-aligned) */}
        {meta ? (
          <span className="flex-shrink-0 text-[11px] text-text-muted">
            {meta}
          </span>
        ) : null}

        {/* Chevron */}
        <span className="flex-shrink-0 text-text-muted">
          {expanded ? (
            <ChevronDown className="w-3 h-3" />
          ) : (
            <ChevronRight className="w-3 h-3" />
          )}
        </span>
      </button>

      {/* Expanded — full ToolUseBlock */}
      {expanded ? (
        <div className="pl-5">
          <ToolUseBlock
            block={block}
            allBlocks={allBlocks}
            message={message}
            showIcon={false}
          />
        </div>
      ) : null}
    </div>
  );
});
