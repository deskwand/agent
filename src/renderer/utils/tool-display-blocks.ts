import type { TFunction } from "i18next";
import type { ContentBlock, ToolResultContent, ToolUseContent } from "../types";
import { extractFilePathFromToolInput } from "./tool-output-path";

export interface ProcessSummary {
  readCount: number;
  hasSearch: boolean;
  hasBrowse: boolean;
  commandCount: number;
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

const PROCESS_TOOLS = new Set([
  "read",
  "read_file",
  "grep",
  "glob",
  "bash",
  "execute_command",
  "websearch",
  "webfetch",
  "vision_describe",
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

const BROWSE_TOOLS = new Set([
  // web fetch/search + all browser automation tools
  "websearch",
  "webfetch",
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

function buildProcessSummary(items: ToolUseContent[]): ProcessSummary {
  const readPaths = new Set<string>();
  let hasSearch = false;
  let hasBrowse = false;
  let commandCount = 0;
  let usedToolCount = 0;

  for (const item of items) {
    const lower = item.name.toLowerCase();
    let countedAsSpecific = false;
    if (
      lower === "read" ||
      lower === "read_file" ||
      lower === "vision_describe"
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
    if (BROWSE_TOOLS.has(lower)) {
      hasBrowse = true;
      countedAsSpecific = true;
    }
    if (lower === "bash" || lower === "execute_command") {
      commandCount += 1;
      countedAsSpecific = true;
    }
    if (!countedAsSpecific) {
      usedToolCount += 1;
    }
  }

  return {
    readCount: readPaths.size,
    hasSearch,
    hasBrowse,
    commandCount,
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

function buildSummaryBlock(
  kind: "process" | "result",
  items: ToolUseContent[],
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
        files: collectResultFiles(items),
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
    displayBlocks.push(buildSummaryBlock(currentKind, currentItems));
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
  iconType: "read" | "search" | "browse" | "command" | "tool";
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

export function collectResultFiles(items: ToolUseContent[]): ResultFileEntry[] {
  const files = new Map<string, ResultFileEntry>();

  for (const item of items) {
    const path = extractFilePathFromToolInput(item.input);
    if (!path) {
      continue;
    }

    const current = files.get(path) ?? { path, edits: 0, writes: 0 };
    const lower = item.name.toLowerCase();

    if (lower === "edit" || lower === "edit_file") {
      current.edits += 1;
    }
    if (lower === "write" || lower === "write_file") {
      current.writes += 1;
    }

    files.set(path, current);
  }

  return [...files.values()];
}
