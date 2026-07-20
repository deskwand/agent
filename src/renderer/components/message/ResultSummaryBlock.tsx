import { memo, useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, Pencil } from "lucide-react";
import type { Message, ContentBlock } from "../../types";
import {
  formatResultSummaryLabel,
  type DisplayBlock,
} from "../../utils/tool-display-blocks";
import { extractFilePathFromToolInput } from "../../utils/tool-output-path";
import {
  countDiffLines,
  findToolResult,
} from "../../utils/tool-result-summary";
import { shortenPath } from "./toolHelpers";
import { ToolUseBlock } from "./ToolUseBlock";
import { useAppStore } from "../../store";

interface ResultSummaryBlockProps {
  block: Extract<DisplayBlock, { type: "result-summary" }>;
  allBlocks?: ContentBlock[];
  message?: Message;
}

export const ResultSummaryBlock = memo(function ResultSummaryBlock({
  block,
  allBlocks,
  message,
}: ResultSummaryBlockProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const files = block.files;

  const allMessages = useAppStore((s) =>
    message?.sessionId
      ? (s.sessionStates[message.sessionId]?.messages ?? [])
      : [],
  );

  const fileDiffStats = useMemo(() => {
    const stats = new Map<string, { added: number; removed: number }>();

    for (const file of files) {
      let totalAdded = 0;
      let totalRemoved = 0;

      const matchingItems = block.items.filter(
        (item) => extractFilePathFromToolInput(item.input) === file.path,
      );

      for (const item of matchingItems) {
        const toolResult = findToolResult(item.id, allBlocks, allMessages);

        if (toolResult?.diff) {
          const { added, removed } = countDiffLines(toolResult.diff);
          totalAdded += added;
          totalRemoved += removed;
        }
      }

      if (totalAdded > 0 || totalRemoved > 0) {
        stats.set(file.path, { added: totalAdded, removed: totalRemoved });
      }
    }

    return stats;
  }, [files, block.items, allBlocks, allMessages]);

  return (
    <div className="overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="group flex w-full items-center gap-2 rounded-lg px-1 text-left text-sm leading-[var(--line-height-chat)] transition-colors hover:bg-surface-hover/40"
      >
        <span className="inline-flex items-center gap-1 min-w-0 truncate font-medium text-text-primary">
          <Pencil className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />
          {formatResultSummaryLabel(block.summary, t)}
        </span>
        <span className="inline-flex w-3.5 flex-shrink-0 items-center justify-center text-text-muted">
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </span>
      </button>

      {files.length > 0 ? (
        <div className="space-y-0.5 pl-6 pt-0.5 text-xs leading-[var(--line-height-chat)] text-text-secondary">
          {files.map((file) => {
            const stats = fileDiffStats.get(file.path);
            return (
              <div
                key={file.path}
                className="flex items-baseline gap-1.5 font-mono"
              >
                <span className="truncate">{shortenPath(file.path)}</span>
                {stats && stats.added > 0 && (
                  <span className="diff-add rounded-sm px-0.5 flex-shrink-0 text-xs">
                    +{stats.added}
                  </span>
                )}
                {stats && stats.removed > 0 && (
                  <span className="diff-del rounded-sm px-0.5 flex-shrink-0 text-xs">
                    -{stats.removed}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ) : null}

      {expanded ? (
        <div className="mt-0.5 space-y-1 pl-5">
          {block.items.map((item) => (
            <ToolUseBlock
              key={item.id}
              block={item}
              allBlocks={allBlocks}
              message={message}
              showIcon={false}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
});
