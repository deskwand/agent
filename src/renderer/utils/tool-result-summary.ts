import type { TFunction } from "i18next";
import type { ContentBlock, Message, ToolResultContent } from "../types";

const screenshotSuccessPattern =
  /\b(?:screenshot\s+(?:saved|captured)|saved\s+screenshot|captured\s+screenshot)\b/i;
const omittedImageOutputPattern =
  /^\[(?:1 image output|\d+ image outputs) omitted from text context\]$/i;
const emptyOutputPattern = /^\(no output\)$/i;
const weakSuccessPattern = /^command completed successfully$/i;

export type CollapsedToolSummary =
  | { kind: "none" }
  | { kind: "lines"; count: number }
  | { kind: "screenshot" }
  | { kind: "error"; text: string }
  | { kind: "text"; text: string }
  | { kind: "matches"; count: number }
  | { kind: "chars"; count: number }
  | { kind: "modified" }
  | { kind: "diff"; added: number; removed: number }
  | { kind: "exitLine"; text: string };

function isFileReadTool(name: string): boolean {
  const lower = name.toLowerCase();
  return lower === "read" || lower === "read_file" || lower.startsWith("office_read_");
}

function isBashTool(name: string): boolean {
  const lower = name.toLowerCase();
  return lower === "bash" || lower === "execute_command";
}

/** Count added/removed lines from a unified diff string */
export function countDiffLines(diff: string): {
  added: number;
  removed: number;
} {
  let added = 0;
  let removed = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++ ")) {
      added++;
    } else if (line.startsWith("-") && !line.startsWith("--- ")) {
      removed++;
    }
  }
  return { added, removed };
}

/** Find a tool_result block matching a tool_use id across blocks and messages */
export function findToolResult(
  toolUseId: string,
  allBlocks: ContentBlock[] | undefined,
  allMessages: Message[],
): ToolResultContent | undefined {
  const result = allBlocks?.find(
    (b) =>
      b.type === "tool_result" &&
      (b as ToolResultContent).toolUseId === toolUseId,
  ) as ToolResultContent | undefined;

  if (result) return result;

  for (const msg of allMessages) {
    if (!Array.isArray(msg.content)) continue;
    const found = (msg.content as ContentBlock[]).find(
      (b) =>
        b.type === "tool_result" &&
        (b as ToolResultContent).toolUseId === toolUseId,
    );
    if (found) return found as ToolResultContent;
  }

  return undefined;
}

function isModifyTool(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower === "write" ||
    lower === "write_file" ||
    lower === "edit" ||
    lower === "edit_file"
  );
}

function isMatchTool(name: string): boolean {
  const lower = name.toLowerCase();
  return lower === "grep" || lower === "glob";
}

function isFetchTool(name: string): boolean {
  const lower = name.toLowerCase();
  return [
    "websearch",
    "webfetch",
    "web_fetch",
    "web_search",
    "fetch_content",
    "get_search_content",
  ].includes(lower);
}

function isVisionDescribeTool(name: string): boolean {
  return name.toLowerCase() === "vision_describe";
}

function getFirstContentLine(text: string, maxLen = 80): string {
  const firstLine = text.split(/\r?\n/)[0] ?? "";
  if (firstLine.length > maxLen) {
    return `${firstLine.substring(0, maxLen - 1)}…`;
  }
  return firstLine;
}

function getLastNonEmptyLine(text: string): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const last = lines[lines.length - 1] ?? "";
  return last.length > 80 ? `${last.substring(0, 77)}…` : last;
}

function isScreenshotToolName(toolName?: string): boolean {
  if (!toolName) {
    return false;
  }
  const lower = toolName.toLowerCase();
  if (lower.endsWith("__screenshot_for_display")) {
    return true;
  }
  return /(?:^|__|_)(?:screenshot|take_screenshot|capture_screenshot)(?:$|__|_)/.test(
    lower,
  );
}

export function shouldUseScreenshotSummary(
  toolName: string | undefined,
  content: string,
): boolean {
  if (isScreenshotToolName(toolName)) {
    return true;
  }
  return screenshotSuccessPattern.test(content);
}

export function getCollapsedToolSummary(
  toolName: string | undefined,
  content: unknown,
  isError = false,
  hasToolResult = true,
  diff?: string,
): CollapsedToolSummary {
  const normalized = typeof content === "string" ? content.trim() : "";

  if (!hasToolResult) {
    return { kind: "none" };
  }

  if (!isError && shouldUseScreenshotSummary(toolName, normalized)) {
    return { kind: "screenshot" };
  }

  if (!normalized) {
    return { kind: "none" };
  }

  if (isError) {
    const firstLine = normalized.split(/\r?\n/)[0] ?? "";
    return {
      kind: "error",
      text:
        firstLine.length > 60 ? `${firstLine.substring(0, 57)}...` : firstLine,
    };
  }

  // Suppress weak/boilerplate output before tool-specific dispatch
  if (
    weakSuccessPattern.test(normalized) ||
    omittedImageOutputPattern.test(normalized) ||
    emptyOutputPattern.test(normalized)
  ) {
    return { kind: "none" };
  }

  const toolNameLower = (toolName || "").toLowerCase();

  // Office document reads — no summary needed
  if (toolNameLower.startsWith("office_read_")) {
    return { kind: "none" };
  }

  // File read — show first line of content
  if (isFileReadTool(toolNameLower)) {
    return { kind: "text", text: getFirstContentLine(normalized) };
  }

  // Bash — show last non-empty line (typically exit code or final status)
  if (isBashTool(toolNameLower)) {
    return { kind: "exitLine", text: getLastNonEmptyLine(normalized) };
  }

  // Write / Edit — show diff line counts when available, otherwise "modified"
  if (isModifyTool(toolNameLower)) {
    if (diff) {
      const { added, removed } = countDiffLines(diff);
      return { kind: "diff", added, removed };
    }
    return { kind: "modified" };
  }

  // Grep / Glob — count non-empty lines as matches
  if (isMatchTool(toolNameLower)) {
    const matches = normalized.split(/\r?\n/).filter((l) => l.trim()).length;
    return { kind: "matches", count: matches };
  }

  // Webfetch — no summary needed
  if (isFetchTool(toolNameLower)) {
    return { kind: "none" };
  }

  // Vision describe — no summary needed
  if (isVisionDescribeTool(toolNameLower)) {
    return { kind: "none" };
  }

  // Default — first line preview for short output, line count for long
  const lineCount = normalized.split(/\r?\n/).length;
  if (lineCount <= 5 && normalized.length <= 120) {
    return { kind: "text", text: getFirstContentLine(normalized) };
  }
  return {
    kind: "lines",
    count: lineCount,
  };
}

export function formatCollapsedToolSummary(
  summary: CollapsedToolSummary,
  t: TFunction,
): string {
  if (summary.kind === "text") {
    return `"${summary.text}"`;
  }
  if (summary.kind === "matches") {
    return t("tool.summaryMatches", { count: summary.count });
  }
  if (summary.kind === "chars") {
    return t("tool.summaryChars", { count: summary.count });
  }
  if (summary.kind === "modified") {
    return t("tool.summaryModified");
  }
  if (summary.kind === "diff") {
    return t("tool.summaryDiff", {
      added: summary.added,
      removed: summary.removed,
    });
  }
  if (summary.kind === "exitLine") {
    return summary.text;
  }
  if (summary.kind === "lines") {
    return t("tool.summaryLines", { count: summary.count });
  }
  if (summary.kind === "screenshot") {
    return t("tool.summaryScreenshot");
  }
  if (summary.kind === "error") {
    return summary.text;
  }
  return "";
}

export function shouldPreferToolResultImages(
  toolName: string | undefined,
  content: string,
  hasImages: boolean,
  isError = false,
): boolean {
  if (isError || !hasImages) {
    return false;
  }

  const normalized = content.trim();
  if (shouldUseScreenshotSummary(toolName, normalized)) {
    return true;
  }

  return (
    omittedImageOutputPattern.test(normalized) ||
    emptyOutputPattern.test(normalized)
  );
}

export function shouldRenderToolResultText(
  toolName: string | undefined,
  content: string,
  hasImages: boolean,
  isError = false,
): boolean {
  if (!content.trim()) {
    return false;
  }

  return !shouldPreferToolResultImages(toolName, content, hasImages, isError);
}
