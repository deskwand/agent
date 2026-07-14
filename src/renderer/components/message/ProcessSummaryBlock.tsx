import { memo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronRight,
  BookOpen,
  Search,
  Globe,
  MonitorPlay,
  Target,
  Wrench,
} from "lucide-react";
import type { Message, ContentBlock } from "../../types";
import {
  getProcessSummaryFragments,
  type DisplayBlock,
  type ProcessSummaryFragment,
} from "../../utils/tool-display-blocks";
import { ToolUseBlock } from "./ToolUseBlock";

const PROCESS_ICON_MAP: Record<
  ProcessSummaryFragment["iconType"],
  React.ReactNode
> = {
  read: <BookOpen className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />,
  search: <Search className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />,
  browse: <Globe className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />,
  command: <MonitorPlay className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />,
  tool: <Wrench className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />,
  goal: <Target className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />,
};

interface ProcessSummaryBlockProps {
  block: Extract<DisplayBlock, { type: "process-summary" }>;
  allBlocks?: ContentBlock[];
  message?: Message;
}

export const ProcessSummaryBlock = memo(function ProcessSummaryBlock({
  block,
  allBlocks,
  message,
}: ProcessSummaryBlockProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const fragments = getProcessSummaryFragments(block.summary, t);

  return (
    <div className="overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="group flex w-full items-center gap-2 rounded-lg px-1 text-left text-sm leading-[var(--line-height-chat)] text-text-muted transition-colors hover:bg-surface-hover/40"
      >
        <span className="inline-flex items-center gap-1.5 min-w-0">
          {fragments.map((frag, fi) => (
            <span key={fi} className="inline-flex items-center gap-1">
              {fi > 0 && fi < fragments.length - 1 && (
                <span className="text-text-muted">
                  {t("tool.grouped.joinComma")}
                </span>
              )}
              {fi > 0 && fi === fragments.length - 1 && (
                <span className="text-text-muted">
                  {" "}
                  {t("tool.grouped.joinAnd")}{" "}
                </span>
              )}
              {PROCESS_ICON_MAP[frag.iconType]}
              <span>{frag.text}</span>
            </span>
          ))}
        </span>
        <span className="inline-flex w-3.5 flex-shrink-0 items-center justify-center text-text-muted">
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </span>
      </button>

      {expanded ? (
        <div className="mt-1 max-h-[400px] overflow-y-auto">
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
