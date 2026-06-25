// Terminal-style rendering for bash / execute_command tool output
import { useState, useMemo, memo } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  XCircle,
  CheckCircle2,
} from "lucide-react";
import Convert from "ansi-to-html";
import { useAppStore } from "../../store";
import { getToolIcon } from "./toolHelpers";
import type {
  ToolUseContent,
  ToolResultContent,
  ContentBlock,
  Message,
} from "../../types";

interface BashToolBlockProps {
  block: ToolUseContent;
  allBlocks?: ContentBlock[];
  message?: Message;
}

/** Exit code to infer when `isError` is unset and the tool has completed */
const DEFAULT_EXIT_CODE = 0;
const ERROR_EXIT_CODE = 1;

/** Build a single ansi-to-html converter using CSS custom properties for theme-aware colors */
function makeAnsiConverter() {
  return new Convert({
    fg: "var(--color-terminal-fg)",
    bg: "var(--color-terminal-bg)",
    newline: true,
    escapeXML: true,
  });
}

/** Truncate a command string for the collapsed header */
function truncateCmd(cmd: string, maxLen = 40): string {
  return cmd.length > maxLen ? cmd.substring(0, maxLen - 1) + "..." : cmd;
}

/**
 * Check whether a bash tool input can be rendered by BashToolBlock.
 * Exported so ToolUseBlock can decide whether to delegate.
 */
export function canHandleBashInput(
  input: Record<string, unknown> | undefined,
): boolean {
  if (!input) return false;
  const cmd = input.command || input.cmd;
  return typeof cmd === "string" && cmd.trim().length > 0;
}

export const BashToolBlock = memo(function BashToolBlock({
  block,
  allBlocks,
  message,
}: BashToolBlockProps) {
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

  // Extract command
  const inp = block.input as Record<string, unknown>;
  const cmd = (inp?.command || inp?.cmd || "") as string;
  if (!cmd.trim()) return null;

  // Find matching tool_result
  let toolResult = allBlocks?.find(
    (b) =>
      b.type === "tool_result" &&
      (b as ToolResultContent).toolUseId === block.id,
  ) as ToolResultContent | undefined;

  if (!toolResult && message?.sessionId) {
    for (const msg of allMessages) {
      if (!Array.isArray(msg.content)) continue;
      const found = (msg.content as ContentBlock[]).find(
        (b) =>
          b.type === "tool_result" &&
          (b as ToolResultContent).toolUseId === block.id,
      );
      if (found) {
        toolResult = found as ToolResultContent;
        break;
      }
    }
  }

  const hasActiveTurn = Boolean(activeTurn);
  const isRunning = !toolResult && hasActiveTurn;
  const isError = toolResult?.isError === true;
  const exitCode = isError ? ERROR_EXIT_CODE : DEFAULT_EXIT_CODE;

  // Output text (for ANSI→HTML conversion)
  const outputText =
    typeof toolResult?.content === "string" ? toolResult.content : "";

  // ANSI → HTML (one converter reused)
  const ansiConverter = useMemo(() => makeAnsiConverter(), []);
  const outputHtml = useMemo(() => {
    if (!outputText) return "";
    try {
      return ansiConverter.toHtml(outputText);
    } catch {
      // Fallback: basic escaping
      return outputText.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }
  }, [outputText, ansiConverter]);

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

  return (
    <div
      className={`rounded-2xl overflow-hidden transition-colors ${
        isError ? "bg-error/5" : isRunning ? "bg-accent/5" : "bg-background/40"
      }`}
    >
      {/* Collapsed header */}
      <button
        onClick={() => {
          setExpanded(!expanded);
        }}
        aria-expanded={expanded}
        className="group w-full flex items-start gap-2.5 py-2 pr-3 text-left hover:bg-surface-hover/50 transition-colors"
      >
        {/* Status icon */}
        <div
          className={`flex-shrink-0 pt-0.5 ${
            isError
              ? "text-error"
              : isRunning
                ? "text-accent"
                : "text-text-muted"
          }`}
        >
          {isRunning ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : isError ? (
            <XCircle className="w-3.5 h-3.5" />
          ) : (
            <CheckCircle2 className="w-3.5 h-3.5 text-success" />
          )}
        </div>

        {/* Tool icon */}
        <div className="flex-shrink-0 pt-0.5 text-text-muted">
          {getToolIcon(block.name)}
        </div>

        {/* Label: $ command · exit N — hidden when expanded (terminal panel shows it) */}
        <div className="min-w-0 flex flex-1 flex-wrap items-baseline gap-x-1 gap-y-0.5">
          {!expanded && (
            <>
              <span className="min-w-0 max-w-full truncate text-xs font-mono text-text-secondary">
                $ {truncateCmd(cmd)}
              </span>
              {isRunning ? (
                <span className="whitespace-nowrap text-xs text-text-muted">
                  · {t("tool.bashRunning")}
                </span>
              ) : (
                <span className="whitespace-nowrap text-xs text-text-muted">
                  · {t("tool.bashExitCode", { code: exitCode })}
                </span>
              )}
            </>
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

      {/* Expanded content — streaming during execution, terminal after */}
      {expanded && isRunning && partialToolResult && partialToolResult.content && (
        <div className="animate-fade-in px-3 py-2">
          <div className="text-xs uppercase tracking-wider text-text-muted font-medium mb-1 flex items-center gap-1.5">
            <Loader2 className="w-3 h-3 animate-spin text-accent" />
            {t("tool.sectionStreaming")}
          </div>
          <pre className="text-xs font-mono text-text-secondary whitespace-pre-wrap break-all rounded-lg p-2.5 max-h-[300px] overflow-y-auto bg-surface-muted">
            {partialToolResult.content}
          </pre>
        </div>
      )}

      {expanded && !isRunning && (
        <div className="animate-fade-in mx-3 mb-3 rounded-lg overflow-hidden border border-surface-muted">
          {/* Terminal title bar */}
          <div
            className="flex items-center gap-2 px-3 py-1.5"
            style={{ backgroundColor: "var(--color-terminal-titlebar-bg)" }}
          >
            <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f56]" />
            <span className="w-2.5 h-2.5 rounded-full bg-[#ffbd2e]" />
            <span className="w-2.5 h-2.5 rounded-full bg-[#27c93f]" />
            <span
              className="ml-2 text-[11px] font-medium"
              style={{ color: "var(--color-terminal-titlebar-text)" }}
            >
              bash
            </span>
            {durationText && (
              <span
                className="ml-auto text-[11px]"
                style={{ color: "var(--color-terminal-titlebar-text)" }}
              >
                {durationText}
              </span>
            )}
          </div>

          {/* Command + output */}
          <div
            className="px-3 py-2 font-mono text-xs leading-snug"
            style={{ backgroundColor: "var(--color-terminal-bg)" }}
          >
            {/* Command line: $ cmd (green for success, red for error) */}
            <div
              className="mb-1.5"
              style={{
                color: isError
                  ? "var(--color-terminal-error)"
                  : "var(--color-terminal-success)",
              }}
            >
              $ {cmd}
            </div>

            {/* Output with ANSI coloring (fg applied by ansi-to-html converter) */}
            {outputHtml ? (
              <div
                className="whitespace-pre-wrap break-all max-h-[300px] overflow-y-auto"
                dangerouslySetInnerHTML={{ __html: outputHtml }}
              />
            ) : (
              <div
                className="italic"
                style={{ color: "var(--color-terminal-dim)" }}
              >
                {t("tool.bashNoOutput")}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
});
