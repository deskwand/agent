import { memo, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, Pencil } from "lucide-react";
import type { Message, ContentBlock } from "../../types";
import {
  collectResultFiles,
  formatResultSummaryLabel,
  type DisplayBlock,
} from "../../utils/tool-display-blocks";
import { shortenPath } from "./toolHelpers";
import { ToolUseBlock } from "./ToolUseBlock";

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
  const files = useMemo(() => collectResultFiles(block.items), [block.items]);

  return (
    <div className="overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="group flex w-full items-center gap-2 rounded-lg px-1 text-left text-sm leading-[var(--line-height-chat)] transition-colors hover:bg-surface-hover/40"
      >
        <Pencil className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />
        <span className="min-w-0 truncate font-medium text-text-primary">
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
          {files.map((file) => (
            <div key={file.path} className="truncate font-mono">
              {shortenPath(file.path)}
            </div>
          ))}
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
