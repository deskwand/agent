// Shared rendering for read/read_file and write/write_file tools — shows file path + syntax-highlighted content
import { useState, memo } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  XCircle,
  CheckCircle2,
} from "lucide-react";
import { useAppStore } from "../../store";
import { getToolIcon, shortenPath } from "./toolHelpers";
import { CodeBlock } from "./CodeBlock";
import type {
  ToolUseContent,
  ToolResultContent,
  ContentBlock,
  Message,
} from "../../types";

interface FileToolBlockProps {
  block: ToolUseContent;
  allBlocks?: ContentBlock[];
  message?: Message;
  action: "read" | "write";
  showIcon?: boolean;
}

const EXT_LANG_MAP: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  json: "json",
  css: "css",
  html: "xml",
  xml: "xml",
  md: "markdown",
  py: "python",
  rs: "rust",
  go: "go",
  java: "java",
  c: "c",
  cpp: "cpp",
  h: "c",
  hpp: "cpp",
  sh: "bash",
  bash: "bash",
  yaml: "yaml",
  yml: "yaml",
  toml: "ini",
  sql: "sql",
  svg: "xml",
  txt: "text",
};

/** Map file extension to highlight.js language identifier */
export function languageFromPath(path: string): string {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return "text";
  const ext = path.slice(dot + 1).toLowerCase();
  return EXT_LANG_MAP[ext] || ext;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Strip read tool line-number prefixes from tool_result content.
 * Input:  "  1\timport React\n  2\tconst x = 1\n"
 * Output: "import React\nconst x = 1\n"
 */
export function stripLineNumbers(text: string): string {
  return text.replace(/^[\t ]*\d+[\t ]/gm, "");
}

/**
 * Check whether a read/read_file or write/write_file tool input can be rendered by FileToolBlock.
 * Exported so ToolUseBlock can use it to decide whether to delegate.
 */
export function canHandleFileInput(
  input: Record<string, unknown> | undefined,
): boolean {
  if (!input) return false;
  const path = input.path || input.filePath || input.file_path;
  if (!path || typeof path !== "string" || !path.trim()) return false;
  const content = input.content;
  return content === undefined || typeof content === "string";
}

export const FileToolBlock = memo(function FileToolBlock({
  block,
  allBlocks,
  message,
  action,
  showIcon = true,
}: FileToolBlockProps) {
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
  const [expanded, setExpanded] = useState(false);
  const { t } = useTranslation();

  // Extract path from input
  const path = ((block.input as Record<string, unknown>)?.path ||
    (block.input as Record<string, unknown>)?.filePath ||
    (block.input as Record<string, unknown>)?.file_path ||
    "") as string;

  // Content source differs by action:
  //   write → block.input.content (available immediately)
  //   read  → toolResult.content (arrives later)
  const isWrite = action === "write";
  const inputRaw = (block.input as Record<string, unknown>)?.content;
  const inputContent = typeof inputRaw === "string" ? inputRaw : "";

  if (!path) return null;
  if (isWrite && inputRaw !== undefined && typeof inputRaw !== "string")
    return null;

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

  // Resolve display content based on action
  const displayContent = isWrite
    ? inputContent // write: from input immediately
    : typeof toolResult?.content === "string"
      ? stripLineNumbers(toolResult.content) // read: from result, strip prefixes
      : "";

  // Stats (for collapsed header)
  const lang = languageFromPath(path);
  const lines = isWrite
    ? inputContent
      ? inputContent.split("\n").length
      : 0
    : toolResult
      ? displayContent
        ? displayContent.split("\n").length
        : 0
      : 0;
  const sizeText = formatSize(displayContent.length);

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
        onClick={() => setExpanded(!expanded)}
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

        {/* Tool icon — uses actual tool name for correct icon */}
        {showIcon ? (
        <div className="flex-shrink-0 pt-0.5 text-text-muted">
          {getToolIcon(block.name)}
        </div>
        ) : null}

        {/* Label: action + path + stats */}
        <div className="min-w-0 flex flex-1 flex-wrap items-baseline gap-x-1 gap-y-0.5">
          <span className="whitespace-nowrap text-xs text-text-muted">
            {t(isWrite ? "tool.actionWrite" : "tool.actionRead")}
          </span>
          <span className="min-w-0 max-w-full truncate text-xs font-mono text-text-secondary">
            · {shortenPath(path)}
          </span>
          {isRunning ? (
            <span className="whitespace-nowrap text-xs text-text-muted">
              · {isWrite ? t("tool.writeWriting") : t("tool.readReading")}
            </span>
          ) : (
            <span className="whitespace-nowrap text-xs text-text-muted">
              · {t("tool.writeLinesBytes", { lines, size: sizeText })}
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
          {/* Meta info bar */}
          <div className="flex items-center gap-2 px-3 pt-2 pb-1 text-xs text-text-muted">
            {durationText && <span>{durationText}</span>}
            {durationText && <span>·</span>}
            <span>{lang}</span>
          </div>

          {/* File path header */}
          <div className="flex items-center gap-2 px-3 py-1.5">
            <span className="text-text-muted flex-shrink-0">
              {showIcon ? getToolIcon(block.name) : null}
            </span>
            <span className="text-xs font-mono text-text-secondary truncate">
              {path}
            </span>
          </div>

          {/* Content area */}
          <div className="px-3 pb-3">
            {isError ? (
              <pre className="text-xs font-mono whitespace-pre-wrap break-all rounded-lg p-2.5 max-h-[300px] overflow-y-auto text-error bg-error/5">
                {typeof toolResult?.content === "string"
                  ? toolResult.content
                  : ""}
              </pre>
            ) : displayContent ? (
              <CodeBlock language={lang}>{displayContent}</CodeBlock>
            ) : (
              <div className="text-xs text-text-muted italic py-2">
                {isWrite ? t("tool.writeEmptyFile") : t("tool.readEmptyFile")}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
});
