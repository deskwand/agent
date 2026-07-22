// Tool use card — collapsible, merges matching tool_result from same/other messages
import { useState, useMemo, memo } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronRight,
  Globe,
  Loader2,
  Search,
  XCircle,
  CheckCircle2,
} from "lucide-react";
import { useAppStore } from "../../store";
import {
  formatCollapsedToolSummary,
  findToolResult,
  getCollapsedToolSummary,
  shouldPreferToolResultImages,
  shouldRenderToolResultText,
} from "../../utils/tool-result-summary";
import type { ToolUseContent, ContentBlock, Message } from "../../types";
import { AskUserQuestionBlock } from "./AskUserQuestionBlock";
import { TodoWriteBlock } from "./TodoWriteBlock";
import { FileToolBlock, canHandleFileInput } from "./FileToolBlock";
import { BashToolBlock, canHandleBashInput } from "./BashToolBlock";
import { getToolIcon, getToolLabel } from "./toolHelpers";
import { MessageMarkdown } from "../MessageMarkdown";

// Only allow safe image MIME types for data: URI rendering
const WEB_SEARCH_TOOL_NAMES = new Set([
  "web_search",
  "websearch",
  "web_fetch",
  "webfetch",
  "fetch_content",
  "get_search_content",
]);

const AGENT_TOOL_NAMES = new Set(["Agent"]);

const ALLOWED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

interface ToolUseBlockProps {
  block: ToolUseContent;
  allBlocks?: ContentBlock[];
  message?: Message;
  showIcon?: boolean;
}

export const ToolUseBlock = memo(function ToolUseBlock({
  block,
  allBlocks,
  message,
  showIcon = true,
}: ToolUseBlockProps) {
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
  const activeTurn = useAppStore((s) =>
    message?.sessionId
      ? (s.sessionStates[message.sessionId]?.activeTurn ?? null)
      : null,
  );
  const partialToolResult = useAppStore((s) =>
    message?.sessionId
      ? (s.sessionStates[message.sessionId]?.partialToolResults?.[block.id] ??
        null)
      : null,
  );
  const [expanded, setExpanded] = useState(false);
  const { t } = useTranslation();

  // Special-case tool UIs
  if (block.name === "AskUserQuestion") {
    return <AskUserQuestionBlock block={block} />;
  }
  if (block.name === "TodoWrite") {
    return <TodoWriteBlock block={block} />;
  }
  if (block.name === "write" || block.name === "write_file") {
    if (
      canHandleFileInput(block.input as Record<string, unknown> | undefined)
    ) {
      return (
        <FileToolBlock
          block={block}
          allBlocks={allBlocks}
          message={message}
          action="write"
          showIcon={showIcon}
        />
      );
    }
  }
  if (block.name === "read" || block.name === "read_file") {
    if (
      canHandleFileInput(block.input as Record<string, unknown> | undefined)
    ) {
      return (
        <FileToolBlock
          block={block}
          allBlocks={allBlocks}
          message={message}
          action="read"
          showIcon={showIcon}
        />
      );
    }
  }
  if (block.name === "bash" || block.name === "execute_command") {
    if (
      canHandleBashInput(block.input as Record<string, unknown> | undefined)
    ) {
      return (
        <BashToolBlock
          block={block}
          allBlocks={allBlocks}
          message={message}
          showIcon={showIcon}
        />
      );
    }
  }

  // Find matching tool_result: first in same message, then across all session messages
  const toolResult = findToolResult(block.id, allBlocks, allMessages);

  // Determine state: running / success / error
  // Only show spinner if session still has an active turn; otherwise treat as done
  const hasActiveTurn = Boolean(activeTurn);
  const isRunning = !toolResult && hasActiveTurn;
  const isError = toolResult?.isError === true;

  const isGoalTool =
    block.name === "get_goal" ||
    block.name === "update_goal" ||
    block.name === "goal_complete";

  const label = getToolLabel(block.name, block.input, t);

  // Inline get_goal objective into the label when result is available
  let displayLabel = label;
  if (toolResult && isGoalTool) {
    const resultText =
      typeof toolResult.content === "string" ? toolResult.content : "";
    const match = resultText.match(/^Objective:\s*(.+)/m);
    if (match) {
      displayLabel = `${label} · ${match[1]}`;
    }
  }
  const isMCPTool = block.name.startsWith("mcp__");
  const mcpServerName = isMCPTool
    ? block.name.match(/^mcp__(.+?)__/)?.[1]
    : null;
  const isWebSearchTool = WEB_SEARCH_TOOL_NAMES.has(block.name);
  const isAgentTool = AGENT_TOOL_NAMES.has(block.name);
  const toolInput = block.input as Record<string, unknown>;
  const collapsedSummary = getCollapsedToolSummary(
    block.name,
    toolResult?.content,
    isError,
    Boolean(toolResult),
    toolResult?.diff,
  );
  const defaultCollapsedSummaryText = formatCollapsedToolSummary(
    collapsedSummary,
    t,
  );
  const collapsedSummaryText = toolResult?.errorCode
    ? t(`webAccess.errors.${toolResult.errorCode}`)
    : isAgentTool
      ? [toolInput.subagent_type, toolInput.description]
          .filter(Boolean)
          .join(" · ")
      : defaultCollapsedSummaryText;

  const isVisionDescribe = block.name === "vision_describe";

  // Strip the [Image description of xxx]\n\n prefix from vision_describe output
  const visionDescriptionText = useMemo(() => {
    if (!isVisionDescribe || !toolResult?.content) return null;
    const text =
      typeof toolResult.content === "string" ? toolResult.content : "";
    const match = text.match(/^\[Image description of .+?\]\n\n/);
    return match ? text.slice(match[0].length) : text;
  }, [isVisionDescribe, toolResult?.content]);

  const validImages =
    toolResult?.images?.filter(
      (image) =>
        image?.mimeType &&
        image?.data &&
        ALLOWED_IMAGE_TYPES.has(image.mimeType),
    ) ?? [];
  const preferImageOutput = toolResult
    ? shouldPreferToolResultImages(
        block.name,
        typeof toolResult.content === "string" ? toolResult.content : "",
        validImages.length > 0,
        isError,
      )
    : false;
  const shouldShowOutputText = toolResult
    ? shouldRenderToolResultText(
        block.name,
        typeof toolResult.content === "string" ? toolResult.content : "",
        validImages.length > 0,
        isError,
      )
    : false;

  // Duration from trace steps
  let duration: number | undefined;
  if (message?.sessionId) {
    const resultStep = traceSteps.find(
      (s) => s.id === block.id && s.type === "tool_result",
    );
    duration = resultStep?.duration;
  }
  const durationText =
    duration === undefined
      ? null
      : duration < 1000
        ? `${duration}ms`
        : `${(duration / 1000).toFixed(1)}s`;
  const expandedMetaItems = [
    durationText,
    validImages.length > 0
      ? t("tool.metaImages", { count: validImages.length })
      : null,
    isMCPTool && mcpServerName ? mcpServerName : null,
  ].filter((value): value is string => Boolean(value));

  return (
    <div
      className={`rounded-2xl overflow-hidden transition-colors ${
        isError ? "bg-error/5" : isRunning ? "bg-accent/5" : "bg-background/40"
      }`}
    >
      {/* Header — always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="group w-full flex items-start gap-2.5 py-2 pr-3 text-left hover:bg-surface-hover/50 transition-colors"
      >
        {/* Status icon — goal tools are status queries, no execution indicator needed */}
        {!isGoalTool && (
          <div className="w-3.5 flex-shrink-0 pt-0.5 flex justify-center text-text-muted">
            {isRunning ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : isError ? (
              <XCircle className="w-3.5 h-3.5" />
            ) : (
              <CheckCircle2 className="w-3.5 h-3.5" />
            )}
          </div>
        )}

        {/* Tool icon */}
        {showIcon ? (
          <div className="w-3.5 flex-shrink-0 pt-0.5 flex justify-center text-text-muted">
            {getToolIcon(block.name)}
          </div>
        ) : null}

        {/* Content cluster */}
        <div className="min-w-0 flex flex-1 items-baseline gap-x-1">
          <span className="min-w-0 flex-1 truncate text-xs font-mono text-text-secondary">
            {displayLabel}
          </span>
          {!isRunning && collapsedSummary.kind === "diff" && (
            <span className="whitespace-nowrap text-xs text-text-muted inline-flex items-center gap-1">
              ·{" "}
              <span className="diff-add rounded-sm px-0.5">
                +{collapsedSummary.added}
              </span>
              <span className="diff-del rounded-sm px-0.5">
                -{collapsedSummary.removed}
              </span>
            </span>
          )}
          {!isRunning &&
            collapsedSummary.kind !== "diff" &&
            collapsedSummaryText && (
              <span
                className={`whitespace-nowrap text-xs ${
                  isError ? "text-error" : "text-text-muted"
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

      {/* Expanded content */}
      {expanded && (
        <div className="animate-fade-in bg-background/35">
          {expandedMetaItems.length > 0 && (
            <div className="px-3 pt-2 text-xs text-text-muted">
              {expandedMetaItems.join(" · ")}
            </div>
          )}

          {/* Input section — hidden when diff is available, always hidden for vision_describe */}
          {!toolResult?.diff && !isVisionDescribe && (
            <div className="px-3 py-2">
              <div className="text-xs uppercase tracking-wider text-text-muted font-medium mb-1">
                {t("tool.sectionInput")}
              </div>
              {isWebSearchTool ? (
                <div className="space-y-1">
                  {block.name === "get_search_content" ? (
                    <div className="text-xs text-text-secondary">
                      responseId: {String(toolInput.responseId || "")}
                    </div>
                  ) : block.name === "fetch_content" ? (
                    <>
                      {(Array.isArray(toolInput.urls)
                        ? (toolInput.urls as string[])
                        : []
                      ).map((u, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-1.5 text-xs text-text-secondary"
                        >
                          <Globe className="w-3 h-3 text-text-muted flex-shrink-0" />
                          <span className="truncate">{u}</span>
                        </div>
                      ))}
                      {toolInput.url && !Array.isArray(toolInput.urls) && (
                        <div className="flex items-center gap-1.5 text-xs text-text-secondary">
                          <Globe className="w-3 h-3 text-text-muted flex-shrink-0" />
                          <span className="truncate">
                            {String(toolInput.url)}
                          </span>
                        </div>
                      )}
                    </>
                  ) : /* web_search / websearch / web_fetch / webfetch */
                  (Array.isArray(toolInput.queries)
                      ? (toolInput.queries as string[])
                      : []
                    ).length > 0 ? (
                    (toolInput.queries as string[]).map((q, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-1.5 text-xs text-text-secondary"
                      >
                        <Search className="w-3 h-3 text-text-muted flex-shrink-0" />
                        <span>{q}</span>
                      </div>
                    ))
                  ) : (
                    <div className="flex items-center gap-1.5 text-xs text-text-secondary">
                      <Search className="w-3 h-3 text-text-muted flex-shrink-0" />
                      <span>
                        {String(toolInput.query || toolInput.url || "")}
                      </span>
                    </div>
                  )}
                </div>
              ) : isAgentTool ? (
                <div className="text-xs text-text-secondary space-y-1">
                  {(toolInput.subagent_type as string) && (
                    <div className="flex items-center gap-1.5">
                      <span>{toolInput.subagent_type as string}</span>
                    </div>
                  )}
                  {(toolInput.description as string) && (
                    <div className="truncate">{toolInput.description as string}</div>
                  )}
                </div>
              ) : (
                <pre className="text-xs font-mono text-text-secondary whitespace-pre-wrap break-all bg-surface-muted rounded-lg p-2.5">
                  {JSON.stringify(block.input, null, 2)}
                </pre>
              )}
            </div>
          )}

          {/* Streaming output when tool is running */}
          {isRunning && partialToolResult && partialToolResult.content && (
            <div className="px-3 py-2">
              <div className="text-xs uppercase tracking-wider text-text-muted font-medium mb-1 flex items-center gap-1.5">
                <Loader2 className="w-3 h-3 animate-spin text-accent" />
                {t("tool.sectionStreaming")}
              </div>
              <pre className="text-xs font-mono text-text-secondary whitespace-pre-wrap break-all rounded-lg p-2.5 max-h-[300px] overflow-y-auto bg-surface-muted">
                {partialToolResult.content}
              </pre>
            </div>
          )}

          {/* Output section */}
          {toolResult && (
            <div className="px-3 py-2">
              {!toolResult.diff && !isVisionDescribe && (
                <div className="text-xs uppercase tracking-wider text-text-muted font-medium mb-1">
                  {t("tool.sectionOutput")}
                </div>
              )}
              {preferImageOutput &&
                validImages.map((image, index) => (
                  <div key={index} className="mt-2 rounded-lg overflow-hidden">
                    <img
                      src={`data:${image.mimeType};base64,${image.data}`}
                      alt={`Output ${index + 1}`}
                      className="w-full h-auto"
                      style={{ maxHeight: "400px", objectFit: "contain" }}
                    />
                  </div>
                ))}
              {toolResult.diff ? (
                <pre className="text-xs font-mono whitespace-pre-wrap break-all rounded-lg p-2.5 max-h-[300px] overflow-y-auto bg-surface-muted leading-snug">
                  {toolResult.diff.split("\n").map((line, i) => {
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
              ) : (isWebSearchTool || isAgentTool) && typeof toolResult.content === "string" ? (
                <div className="text-xs text-text-secondary max-h-[400px] overflow-y-auto">
                  <MessageMarkdown normalizedText={toolResult.content} />
                </div>
              ) : (
                shouldShowOutputText && (
                  <pre
                    className={`text-xs font-mono whitespace-pre-wrap break-all rounded-lg p-2.5 max-h-[300px] overflow-y-auto ${
                      isError
                        ? "text-error bg-error/5"
                        : "text-text-secondary bg-surface-muted"
                    } ${preferImageOutput ? "mt-2" : ""}`}
                  >
                    {isVisionDescribe && visionDescriptionText !== null
                      ? visionDescriptionText
                      : toolResult.content}
                  </pre>
                )
              )}
              {!preferImageOutput &&
                validImages.map((image, index) => (
                  <div key={index} className="mt-2 rounded-lg overflow-hidden">
                    <img
                      src={`data:${image.mimeType};base64,${image.data}`}
                      alt={`Output ${index + 1}`}
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
