// Collapsible "thinking" block — Agent extended thinking display
import { Suspense, lazy, useState, memo } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, Brain } from "lucide-react";
import { PanelErrorBoundary } from "../PanelErrorBoundary";

const MessageMarkdown = lazy(() =>
  import("../MessageMarkdown").then((module) => ({
    default: module.MessageMarkdown,
  })),
);

interface ThinkingBlockProps {
  block: { type: "thinking"; thinking: string };
}

export const ThinkingBlock = memo(function ThinkingBlock({
  block,
}: ThinkingBlockProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const text = block.thinking || "";
  if (!text) return null;

  const PREVIEW_MAX_CHARS = 600;
  const previewText =
    text.length > PREVIEW_MAX_CHARS ? text.slice(0, PREVIEW_MAX_CHARS) : text;

  return (
    <div className="rounded-2xl bg-background/40 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="group w-full flex items-start gap-2.5 py-2 pr-3 text-left hover:bg-surface-hover/50 transition-colors"
      >
        <Brain className="w-3.5 h-3.5 flex-shrink-0 pt-0.5 text-text-muted" />
        <div className="min-w-0 flex flex-1 items-baseline gap-x-1 overflow-hidden">
          <span className="flex-shrink-0 text-xs font-medium text-text-muted">
            {t("messageCard.thinking")}
          </span>
          {!expanded && (
            <span className="min-w-0 flex-1 truncate text-xs text-text-muted/60 italic">
              {previewText}
            </span>
          )}
          <span
            className={`inline-flex w-3.5 flex-shrink-0 items-center justify-center self-start pt-0.5 text-text-muted transition-opacity ${
              expanded
                ? "opacity-100"
                : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
            }`}
          >
            {expanded ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
          </span>
        </div>
      </button>

      {expanded && (
        <div className="px-4 py-3 animate-fade-in">
          <div className="text-sm text-text-secondary leading-relaxed prose-chat max-w-none">
            <PanelErrorBoundary
              name="ThinkingMarkdown"
              fallback={<div className="whitespace-pre-wrap">{text}</div>}
            >
              <Suspense
                fallback={<div className="whitespace-pre-wrap">{text}</div>}
              >
                <MessageMarkdown normalizedText={text} />
              </Suspense>
            </PanelErrorBoundary>
          </div>
        </div>
      )}
    </div>
  );
});
