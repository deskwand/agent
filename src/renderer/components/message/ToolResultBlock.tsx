// Fallback ToolResultBlock — only renders for truly orphan results (no matching tool_use anywhere)
import { useState, memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, XCircle, CheckCircle2 } from "lucide-react";
import { useAppStore } from "../../store";
import {
  formatCollapsedToolSummary,
  getCollapsedToolSummary,
  shouldPreferToolResultImages,
  shouldRenderToolResultText,
} from "../../utils/tool-result-summary";
import type {
  ToolResultContent,
  ContentBlock,
  ToolUseContent,
  Message,
} from "../../types";

// Only allow safe image MIME types for data: URI rendering
const ALLOWED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

interface ToolResultBlockProps {
  block: ToolResultContent;
  allBlocks?: ContentBlock[];
  message?: Message;
}

export const ToolResultBlock = memo(function ToolResultBlock({
  block,
  allBlocks,
  message,
}: ToolResultBlockProps) {
  const traceSteps = useAppStore((s) =>
    message?.sessionId
      ? (s.sessionStates[message.sessionId]?.traceSteps ?? [])
      : [],
  );
  const allMessages = useAppStore((s) =>
    message?.sessionId
      ? (s.sessionStates[message.sessionId]?.messages ?? [])
      : [],
  );
  const [expanded, setExpanded] = useState(false);
  const { t } = useTranslation();

  // If a ToolUseBlock in any message already merges this result, hide this block
  const isOrphan = useMemo(() => {
    if (!message?.sessionId) return true;
    for (const msg of allMessages) {
      if (!Array.isArray(msg.content)) continue;
      const hasMatchingToolUse = (msg.content as ContentBlock[]).some(
        (b) =>
          b.type === "tool_use" && (b as ToolUseContent).id === block.toolUseId,
      );
      if (hasMatchingToolUse) return false;
    }
    return true;
  }, [allMessages, block.toolUseId, message?.sessionId]);

  if (!isOrphan) return null;

  // Try to find the tool name from trace steps
  let toolName: string | undefined;
  if (message?.sessionId) {
    const toolCallStep = traceSteps.find(
      (s) => s.id === block.toolUseId && s.type === "tool_call",
    );
    if (toolCallStep) toolName = toolCallStep.toolName;
  }
  if (!toolName) {
    const toolUseBlock = allBlocks?.find(
      (b) =>
        b.type === "tool_use" && (b as ToolUseContent).id === block.toolUseId,
    ) as ToolUseContent | undefined;
    toolName = toolUseBlock?.name;
  }

  const isMCPTool = toolName?.startsWith("mcp__") || false;
  const mcpServerName = isMCPTool
    ? (toolName || "").match(/^mcp__(.+?)__(.+)$/)?.[1] || null
    : null;
  const displayName = isMCPTool
    ? (toolName || "").match(/^mcp__(.+?)__(.+)$/)?.[2] || toolName || "tool"
    : toolName || "tool";
  const collapsedSummary = getCollapsedToolSummary(
    toolName,
    block.content,
    block.isError === true,
  );
  const defaultCollapsedSummaryText = formatCollapsedToolSummary(
    collapsedSummary,
    t,
  );
  const collapsedSummaryText = block.errorCode
    ? t(`webAccess.errors.${block.errorCode}`)
    : defaultCollapsedSummaryText;

  const validImages =
    block.images?.filter(
      (image) =>
        image?.mimeType &&
        image?.data &&
        ALLOWED_IMAGE_TYPES.has(image.mimeType),
    ) ?? [];
  const hasImages = validImages.length > 0;
  const preferImageOutput = shouldPreferToolResultImages(
    toolName,
    typeof block.content === "string" ? block.content : "",
    hasImages,
    block.isError === true,
  );
  const shouldShowOutputText = shouldRenderToolResultText(
    toolName,
    typeof block.content === "string" ? block.content : "",
    hasImages,
    block.isError === true,
  );
  const resultStep = traceSteps.find(
    (s) => s.id === block.toolUseId && s.type === "tool_result",
  );
  const duration = resultStep?.duration;
  const durationText =
    duration === undefined
      ? null
      : duration < 1000
        ? `${duration}ms`
        : `${(duration / 1000).toFixed(1)}s`;
  const expandedMetaItems = [
    durationText,
    hasImages ? t("tool.metaImages", { count: validImages.length }) : null,
    mcpServerName,
  ].filter((value): value is string => Boolean(value));

  return (
    <div
      className={`rounded-2xl overflow-hidden ${
        block.isError ? "bg-error/5" : "bg-background/40"
      }`}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="group w-full flex items-start gap-2.5 py-2 pr-3 text-left hover:bg-surface-hover/50 transition-colors"
      >
        {block.isError ? (
          <XCircle className="w-3.5 h-3.5 pt-0.5 text-text-muted flex-shrink-0" />
        ) : (
          <CheckCircle2 className="w-3.5 h-3.5 pt-0.5 text-text-muted flex-shrink-0" />
        )}
        <div className="min-w-0 flex flex-1 items-baseline gap-x-1">
          <span
            className={`min-w-0 flex-1 truncate text-xs font-mono ${
              block.isError ? "text-error" : "text-text-secondary"
            }`}
          >
            {displayName}
          </span>
          {collapsedSummaryText && (
            <span
              className={`whitespace-nowrap text-xs ${
                block.isError ? "text-error" : "text-text-muted"
              }`}
            >
              · {collapsedSummaryText}
            </span>
          )}
          <span
            className={`inline-flex w-3.5 flex-shrink-0 items-center justify-center self-center text-text-muted transition-opacity ${
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
        <div className="animate-fade-in px-3 py-2">
          {expandedMetaItems.length > 0 && (
            <div className="pb-2 text-xs text-text-muted">
              {expandedMetaItems.join(" · ")}
            </div>
          )}
          {preferImageOutput && hasImages && (
            <div className="space-y-2">
              {validImages.map((image, index) => (
                <div key={index} className="rounded-lg overflow-hidden">
                  <img
                    src={`data:${image.mimeType};base64,${image.data}`}
                    alt={`Screenshot ${index + 1}`}
                    className="w-full h-auto"
                    style={{ maxHeight: "400px", objectFit: "contain" }}
                  />
                </div>
              ))}
            </div>
          )}
          {block.diff ? (
            <pre className="text-xs font-mono whitespace-pre-wrap break-all rounded-lg p-2.5 max-h-[300px] overflow-y-auto bg-surface-muted leading-snug">
              {block.diff.split("\n").map((line, i) => {
                const prefix = line[0];
                const bgClass =
                  prefix === "+"
                    ? "diff-add"
                    : prefix === "-"
                      ? "diff-del"
                      : "text-text-secondary";
                return (
                  <div key={i} className={bgClass}>
                    {line}
                  </div>
                );
              })}
            </pre>
          ) : (
            shouldShowOutputText && (
              <pre
                className={`text-xs font-mono whitespace-pre-wrap break-all rounded-lg p-2.5 max-h-[300px] overflow-y-auto ${
                  block.isError
                    ? "text-error bg-error/5"
                    : "text-text-secondary bg-surface-muted"
                } ${preferImageOutput ? "mt-2" : ""}`}
              >
                {block.content}
              </pre>
            )
          )}
          {!preferImageOutput && hasImages && (
            <div className="mt-2 space-y-2">
              {validImages.map((image, index) => (
                <div key={index} className="rounded-lg overflow-hidden">
                  <img
                    src={`data:${image.mimeType};base64,${image.data}`}
                    alt={`Screenshot ${index + 1}`}
                    className="w-full h-auto"
                    style={{ maxHeight: "400px", objectFit: "contain" }}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
});
