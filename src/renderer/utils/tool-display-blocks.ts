import type { TFunction } from "i18next";
import type { ContentBlock, ToolResultContent, ToolUseContent } from "../types";
import { extractFilePathFromToolInput } from "./tool-output-path";

export interface ProcessSummary {
  readCount: number;
  hasSearch: boolean;
  hasWebSearch: boolean;
  hasBrowse: boolean;
  commandCount: number;
  subagentCount: number;
  hasGoal: boolean;
  usedToolCount: number;
}

export interface ResultSummary {
  editedFiles: number;
  writtenFiles: number;
}

export interface ResultFileEntry {
  path: string;
  edits: number;
  writes: number;
  addedLines: number;
  removedLines: number;
}

export type DisplayBlock =
  | {
      type: "content";
      block: ContentBlock;
    }
  | {
      type: "process-summary";
      items: ToolUseContent[];
      summary: ProcessSummary;
    }
  | {
      type: "result-summary";
      items: ToolUseContent[];
      summary: ResultSummary;
      files: ResultFileEntry[];
    };

export type ProcessSummaryDisplayBlock = Extract<
  DisplayBlock,
  { type: "process-summary" }
>;

const PROCESS_TOOLS = new Set([
  "read",
  "read_file",
  "grep",
  "glob",
  "bash",
  "execute_command",
  "agent",
  "websearch",
  "web_fetch",
  "web_search",
  "fetch_content",
  "get_search_content",
  "vision_describe",
  "office_read_xlsx",
  "office_read_docx",
  "office_read_pptx",
  "office_read_pdf",
  "internal_browser_navigate",
  "internal_browser_screenshot",
  "internal_browser_click",
  "internal_browser_fill",
  "internal_browser_scroll",
  "internal_browser_hover",
  "internal_browser_select",
  "internal_browser_press",
  "internal_browser_snapshot",
  "internal_browser_evaluate",
  "internal_browser_wait_for",
  "internal_browser_get_state",
]);

const SEARCH_TOOLS = new Set([
  // grep/glob = code search only; web/browser tools are BROWSE_TOOLS
  "grep",
  "glob",
]);

const WEB_SEARCH_TOOLS = new Set([
  "websearch",
  "web_fetch",
  "web_search",
  "fetch_content",
  "get_search_content",
]);

const BROWSE_TOOLS = new Set([
  // browser automation tools
  "internal_browser_navigate",
  "internal_browser_screenshot",
  "internal_browser_click",
  "internal_browser_fill",
  "internal_browser_scroll",
  "internal_browser_hover",
  "internal_browser_select",
  "internal_browser_press",
  "internal_browser_snapshot",
  "internal_browser_evaluate",
  "internal_browser_wait_for",
  "internal_browser_get_state",
]);

const RESULT_TOOLS = new Set(["edit", "edit_file", "write", "write_file"]);

function isToolResultBlock(block: ContentBlock): block is ToolResultContent {
  return block.type === "tool_result";
}

function isThinkingBlock(block: ContentBlock): boolean {
  return block.type === "thinking";
}

function isToolTraceBlock(block: ContentBlock): boolean {
  return block.type === "tool_use" || block.type === "tool_result";
}

function getToolKind(name: string): "process" | "result" | null {
  const lower = name.toLowerCase();
  if (PROCESS_TOOLS.has(lower) || lower.startsWith("mcp__")) {
    return "process";
  }
  if (RESULT_TOOLS.has(lower)) {
    return "result";
  }
  return null;
}

export function isProcessToolUse(item: ToolUseContent): boolean {
  return getToolKind(item.name) === "process";
}

const GOAL_TOOLS = new Set(["get_goal", "update_goal", "goal_complete"]);

function buildProcessSummary(items: ToolUseContent[]): ProcessSummary {
  const readPaths = new Set<string>();
  let hasSearch = false;
  let hasWebSearch = false;
  let hasBrowse = false;
  let commandCount = 0;
  let subagentCount = 0;
  let hasGoal = false;
  let usedToolCount = 0;

  for (const item of items) {
    const lower = item.name.toLowerCase();
    let countedAsSpecific = false;
    // read / read_file / vision_describe / office_read_* all count as "read files"
    // in the process summary. Using startsWith for office_read_ means future
    // formats (csv, md, etc.) are automatically covered.
    if (
      lower === "read" ||
      lower === "read_file" ||
      lower === "vision_describe" ||
      lower.startsWith("office_read_")
    ) {
      const path = extractFilePathFromToolInput(item.input);
      if (path) {
        readPaths.add(path);
      }
      countedAsSpecific = true;
    }
    if (SEARCH_TOOLS.has(lower)) {
      hasSearch = true;
      countedAsSpecific = true;
    }
    if (WEB_SEARCH_TOOLS.has(lower)) {
      hasWebSearch = true;
      countedAsSpecific = true;
    }
    if (BROWSE_TOOLS.has(lower)) {
      hasBrowse = true;
      countedAsSpecific = true;
    }
    if (lower === "bash" || lower === "execute_command") {
      commandCount += 1;
      countedAsSpecific = true;
    }
    if (lower === "agent") {
      subagentCount += 1;
      countedAsSpecific = true;
    }
    if (GOAL_TOOLS.has(lower)) {
      hasGoal = true;
      countedAsSpecific = true;
    }
    if (!countedAsSpecific) {
      usedToolCount += 1;
    }
  }

  return {
    readCount: readPaths.size,
    hasSearch,
    hasWebSearch,
    hasBrowse,
    commandCount,
    subagentCount,
    hasGoal,
    usedToolCount,
  };
}

function buildResultSummary(items: ToolUseContent[]): ResultSummary {
  const editedFiles = new Set<string>();
  const writtenFiles = new Set<string>();

  for (const item of items) {
    const path = extractFilePathFromToolInput(item.input);
    if (!path) {
      continue;
    }
    const lower = item.name.toLowerCase();
    if (lower === "edit" || lower === "edit_file") {
      editedFiles.add(path);
    }
    if (lower === "write" || lower === "write_file") {
      writtenFiles.add(path);
    }
  }

  return {
    editedFiles: editedFiles.size,
    writtenFiles: writtenFiles.size,
  };
}

export function buildProcessSummaryDisplayBlock(
  items: ToolUseContent[],
): ProcessSummaryDisplayBlock {
  return {
    type: "process-summary",
    items,
    summary: buildProcessSummary(items),
  };
}

function buildSummaryBlock(
  kind: "process" | "result",
  items: ToolUseContent[],
  blocks: ContentBlock[],
): DisplayBlock {
  return kind === "process"
    ? {
        type: "process-summary",
        items,
        summary: buildProcessSummary(items),
      }
    : {
        type: "result-summary",
        items,
        summary: buildResultSummary(items),
        files: collectResultFiles(items, blocks),
      };
}

function findToolResultIndex(
  blocks: ContentBlock[],
  startIndex: number,
  toolUseId: string,
): number {
  for (let index = startIndex + 1; index < blocks.length; index += 1) {
    const next = blocks[index];
    if (!next) {
      continue;
    }
    if (isToolResultBlock(next) && next.toolUseId === toolUseId) {
      return index;
    }
  }
  return -1;
}

export function filterAssistantVisibleBlocks(
  blocks: ContentBlock[],
  hideTraceBlocks: boolean,
): ContentBlock[] {
  return blocks.filter((block) => {
    // thinking blocks are internal reasoning, never shown to users
    if (isThinkingBlock(block)) {
      return false;
    }
    if (hideTraceBlocks && isToolTraceBlock(block)) {
      return false;
    }
    return true;
  });
}

export function buildToolDisplayBlocks(blocks: ContentBlock[]): DisplayBlock[] {
  const displayBlocks: DisplayBlock[] = [];
  const consumedToolResultIndexes = new Set<number>();
  let currentItems: ToolUseContent[] = [];
  let currentKind: "process" | "result" | null = null;

  const flush = () => {
    if (currentKind === null || currentItems.length === 0) {
      currentItems = [];
      currentKind = null;
      return;
    }
    displayBlocks.push(buildSummaryBlock(currentKind, currentItems, blocks));
    currentItems = [];
    currentKind = null;
  };

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (!block) {
      continue;
    }

    if (consumedToolResultIndexes.has(index)) {
      continue;
    }

    if (block.type !== "tool_use") {
      flush();
      displayBlocks.push({ type: "content", block });
      continue;
    }

    const resultIndex = findToolResultIndex(blocks, index, block.id);
    const kind = getToolKind(block.name);

    if (kind === null) {
      flush();
      displayBlocks.push({ type: "content", block });
      if (resultIndex >= 0) {
        consumedToolResultIndexes.add(resultIndex);
      }
      continue;
    }

    if (currentKind !== null && currentKind !== kind) {
      flush();
    }

    currentKind = kind;
    currentItems.push(block);
    if (resultIndex >= 0) {
      consumedToolResultIndexes.add(resultIndex);
    }
  }

  flush();
  return displayBlocks;
}

export function orderAssistantDisplayBlocks(
  blocks: DisplayBlock[],
): DisplayBlock[] {
  const content = blocks.filter((block) => block.type === "content");
  const results = blocks.filter((block) => block.type === "result-summary");
  const process = blocks.filter((block) => block.type === "process-summary");
  return [...content, ...results, ...process];
}

function joinSummaryFragments(fragments: string[], t: TFunction): string {
  if (fragments.length === 0) {
    return "";
  }
  if (fragments.length === 1) {
    return fragments[0] ?? "";
  }
  if (fragments.length === 2) {
    return `${fragments[0]}${t("tool.grouped.joinAnd")}${fragments[1]}`;
  }
  const head = fragments.slice(0, -1).join(t("tool.grouped.joinComma"));
  const tail = fragments[fragments.length - 1] ?? "";
  return `${head}${t("tool.grouped.joinAnd")}${tail}`;
}

function pluralKey(baseKey: string, count: number): string {
  return `${baseKey}_${count === 1 ? "one" : "other"}`;
}

/** @deprecated Use getProcessSummaryFragments for icon-aware rendering */
export function formatProcessSummaryLabel(
  summary: ProcessSummary,
  t: TFunction,
): string {
  const fragments: string[] = [];

  if (summary.readCount > 0) {
    fragments.push(
      t(pluralKey("tool.grouped.readFiles", summary.readCount), {
        count: summary.readCount,
      }),
    );
  }
  if (summary.hasSearch) {
    fragments.push(t("tool.grouped.searchedCode"));
  }
  if (summary.hasWebSearch) {
    fragments.push(t("tool.grouped.searchedWeb"));
  }
  if (summary.hasBrowse) {
    fragments.push(t("tool.grouped.browsedWeb"));
  }
  if (summary.commandCount > 0) {
    fragments.push(
      t(pluralKey("tool.grouped.executedCommands", summary.commandCount), {
        count: summary.commandCount,
      }),
    );
  }
  if (summary.subagentCount > 0) {
    fragments.push(
      t(pluralKey("tool.grouped.startedSubagents", summary.subagentCount), {
        count: summary.subagentCount,
      }),
    );
  }
  if (summary.usedToolCount > 0) {
    fragments.push(
      t(pluralKey("tool.grouped.usedTools", summary.usedToolCount), {
        count: summary.usedToolCount,
      }),
    );
  }

  return joinSummaryFragments(fragments, t);
}

export type ProcessSummaryFragment = {
  text: string;
  iconType:
    | "read"
    | "search"
    | "websearch"
    | "browse"
    | "command"
    | "subagent"
    | "goal"
    | "tool";
};

export function getProcessSummaryFragments(
  summary: ProcessSummary,
  t: TFunction,
): ProcessSummaryFragment[] {
  const fragments: ProcessSummaryFragment[] = [];

  if (summary.readCount > 0) {
    fragments.push({
      text: t(pluralKey("tool.grouped.readFiles", summary.readCount), {
        count: summary.readCount,
      }),
      iconType: "read",
    });
  }
  if (summary.hasSearch) {
    fragments.push({
      text: t("tool.grouped.searchedCode"),
      iconType: "search",
    });
  }
  if (summary.hasWebSearch) {
    fragments.push({
      text: t("tool.grouped.searchedWeb"),
      iconType: "websearch",
    });
  }
  if (summary.hasBrowse) {
    fragments.push({
      text: t("tool.grouped.browsedWeb"),
      iconType: "browse",
    });
  }
  if (summary.commandCount > 0) {
    fragments.push({
      text: t(
        pluralKey("tool.grouped.executedCommands", summary.commandCount),
        {
          count: summary.commandCount,
        },
      ),
      iconType: "command",
    });
  }
  if (summary.subagentCount > 0) {
    fragments.push({
      text: t(
        pluralKey("tool.grouped.startedSubagents", summary.subagentCount),
        {
          count: summary.subagentCount,
        },
      ),
      iconType: "subagent",
    });
  }
  if (summary.hasGoal) {
    fragments.push({
      text: t("tool.grouped.managedGoal"),
      iconType: "goal",
    });
  }
  if (summary.usedToolCount > 0) {
    fragments.push({
      text: t(pluralKey("tool.grouped.usedTools", summary.usedToolCount), {
        count: summary.usedToolCount,
      }),
      iconType: "tool",
    });
  }

  return fragments;
}

export function formatResultSummaryLabel(
  summary: ResultSummary,
  t: TFunction,
): string {
  const fragments: string[] = [];

  if (summary.editedFiles > 0) {
    fragments.push(
      t(pluralKey("tool.grouped.modifiedFiles", summary.editedFiles), {
        count: summary.editedFiles,
      }),
    );
  }
  if (summary.writtenFiles > 0) {
    fragments.push(
      t(pluralKey("tool.grouped.writtenFiles", summary.writtenFiles), {
        count: summary.writtenFiles,
      }),
    );
  }

  return joinSummaryFragments(fragments, t);
}

function countDiffLines(diff: string | undefined): {
  added: number;
  removed: number;
} {
  if (!diff) return { added: 0, removed: 0 };
  let added = 0;
  let removed = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) added += 1;
    if (line.startsWith("-") && !line.startsWith("---")) removed += 1;
  }
  return { added, removed };
}

function countWriteLines(content: unknown): number {
  if (typeof content !== "string") return 0;
  const normalized = content.replace(/\r\n/g, "\n");
  if (!normalized) return 0;
  const withoutLastNewline = normalized.replace(/\n$/, "");
  if (!withoutLastNewline) {
    return normalized.endsWith("\n") ? 1 : 0;
  }
  return withoutLastNewline.split("\n").length;
}

export function collectResultFiles(
  items: ToolUseContent[],
  blocks: ContentBlock[],
): ResultFileEntry[] {
  const files = new Map<string, ResultFileEntry>();

  for (const item of items) {
    const path = extractFilePathFromToolInput(item.input);
    if (!path) {
      continue;
    }

    const current = files.get(path) ?? {
      path,
      edits: 0,
      writes: 0,
      addedLines: 0,
      removedLines: 0,
    };
    const lower = item.name.toLowerCase();

    if (lower === "edit" || lower === "edit_file") {
      current.edits += 1;
      const result = blocks.find(
        (b) => b.type === "tool_result" && b.toolUseId === item.id,
      );
      if (result && result.type === "tool_result") {
        const { added, removed } = countDiffLines(result.diff);
        current.addedLines += added;
        current.removedLines += removed;
      }
    }
    if (lower === "write" || lower === "write_file") {
      current.writes += 1;
      current.addedLines += countWriteLines(item.input.content);
    }

    files.set(path, current);
  }

  return [...files.values()];
}
