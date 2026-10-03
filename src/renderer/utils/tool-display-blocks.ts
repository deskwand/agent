import type { TFunction } from "i18next";
import type { NestedToolStatus } from "../../shared/nested-tool-calls";
import type { ContentBlock, ToolResultContent, ToolUseContent } from "../types";
import { extractFilePathFromToolInput } from "./tool-output-path";
import { countDiffLines } from "./tool-result-summary";

export interface SubagentSummary {
  name: string;
  description: string;
}

export interface ProcessSummary {
  readCount: number;
  todoUpdateCount: number;
  browseDirCount?: number;
  hasSearch: boolean;
  hasWebSearch: boolean;
  hasBrowse: boolean;
  hasMemory: boolean;
  commandCount: number;
  subagentCount: number;
  subagents?: SubagentSummary[];
  subagentResultCount?: number;
  subagentSteerCount?: number;
  subagentWorkflowCount?: number;
  hasGoal: boolean;
  usedToolCount: number;
  scriptCount?: number;
  /** 朗读工具被调用的次数。与 scriptCount 一样是可选：老测试字面量不必跟着改。 */
  ttsCount?: number;
  calledRead?: boolean;
  calledSearch?: boolean;
}

export interface ResultSummary {
  editedFiles: number;
  writtenFiles: number;
  calledEdit?: boolean;
  calledWrite?: boolean;
}

/** 分组状态：只在分组含有虚拟 trace 或普通失败时附加。 */
export interface ToolGroupStatusUi {
  running: boolean;
  failed: boolean;
  unfinished: boolean;
  incomplete: boolean;
  unavailable: boolean;
  firstFailedToolCallId?: string;
}

type GroupScriptUi = { id: string; input: Record<string, unknown> };

export interface ResultFileEntry {
  path: string;
  edits: number;
  writes: number;
  addedLines: number;
  removedLines: number;
  lineStatsUnavailable?: boolean;
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
      status?: ToolGroupStatusUi;
      scripts?: GroupScriptUi[];
    }
  | {
      type: "result-summary";
      items: ToolUseContent[];
      summary: ResultSummary;
      files: ResultFileEntry[];
      status?: ToolGroupStatusUi;
      scripts?: GroupScriptUi[];
    };

export type ProcessSummaryDisplayBlock = Extract<
  DisplayBlock,
  { type: "process-summary" }
>;

/**
 * 必须独立渲染的工具：它们要在折叠状态下就能看见（ask_user 的核心交付物就是内联
 * 问题卡片，折进摘要后要展开才能看见，提问就失效了）。除此以外没有豁免 ——
 * 名字不认识也要归组，见 getToolKind。
 */
const DEDICATED_CARD_TOOLS = new Set(["ask_user", "askuserquestion"]);

const SEARCH_TOOLS = new Set([
  // grep/glob = code search only; web/browser tools are BROWSE_TOOLS
  "grep",
  "glob",
  "find",
]);

const FILE_BROWSE_TOOLS = new Set([
  // ls lists directory contents — its own summary group
  "ls",
]);

const WEB_SEARCH_TOOLS = new Set([
  "websearch",
  "web_fetch",
  "web_search",
  "fetch_content",
  "get_search_content",
]);

const MEMORY_TOOLS = new Set([
  "memory_search",
  "memory_read",
  "memory_upsert",
  "memory_delete",
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

/**
 * 归类只决定摘要措辞与计数，不决定“是否归组”。
 *
 * 除专用卡片外一律进过程摘要：模型幻觉出的工具名、漏登记的新工具、MCP 工具
 * 都会以通用工具（`usedToolCount`）身份计入，绝不渲染成裸 `tool_use` 行
 * —— AGENTS.md §4 禁止工具作为未分组工具展示。
 */
function getToolKind(name: string): "process" | "result" | null {
  const lower = name.toLowerCase();
  if (DEDICATED_CARD_TOOLS.has(lower)) {
    return null;
  }
  return RESULT_TOOLS.has(lower) ? "result" : "process";
}

export function isProcessToolUse(item: ToolUseContent): boolean {
  const kind = getToolKind(item.name);
  if (kind) {
    return kind === "process";
  }
  // 只剩专用卡片会返回 null；虚拟投影的嵌套块仍归过程分组，不退回普通内容块。
  return Boolean(item.trace);
}

/**
 * 分组统计只采信成功状态：虚拟块读 trace，普通块读自己的结果。
 * 没有结果就是未知，不能算作已读取 / 已搜索。
 */
function statusOf(
  item: ToolUseContent,
  blocks: ContentBlock[],
): NestedToolStatus | undefined {
  if (item.trace) {
    return item.trace.status;
  }
  const result = blocks.find(
    (block): block is ToolResultContent =>
      block.type === "tool_result" && block.toolUseId === item.id,
  );
  return result
    ? (result.status ?? (result.isError ? "error" : "ok"))
    : undefined;
}

const GOAL_TOOLS = new Set(["get_goal", "update_goal", "goal_complete"]);

function buildProcessSummary(
  items: ToolUseContent[],
  blocks: ContentBlock[] = [],
): ProcessSummary {
  const readPaths = new Set<string>();
  let browseDirCount = 0;
  let hasSearch = false;
  let hasWebSearch = false;
  let hasBrowse = false;
  let hasMemory = false;
  let commandCount = 0;
  let subagentCount = 0;
  const subagents: SubagentSummary[] = [];
  let subagentResultCount = 0;
  let subagentSteerCount = 0;
  let subagentWorkflowCount = 0;
  let hasGoal = false;
  let usedToolCount = 0;
  let ttsCount = 0;
  let todoUpdateCount = 0;
  let scriptCount = 0;
  let calledRead = false;
  let calledSearch = false;

  for (const item of items) {
    const lower = item.name.toLowerCase();
    let countedAsSpecific = false;
    // 朗读工具：它在过程摘要里有自己的措辞（「朗读了 N 段文字」），
    // 不能被算进通用的 usedToolCount —— AGENTS.md §4 要求新工具必须归类。
    if (lower === "tts") {
      ttsCount += 1;
      continue;
    }
    if (lower === "codemode") {
      // 投影只会保留没有可用子条目的父调用；它本身不是一次通用工具使用。
      scriptCount += 1;
      continue;
    }
    // read / read_file / vision_describe / office_read_* all count as "read files"
    // in the process summary. Using startsWith for office_read_ means future
    // formats (csv, md, etc.) are automatically covered.
    if (
      lower === "read" ||
      lower === "read_file" ||
      lower === "vision_describe" ||
      lower.startsWith("office_read_")
    ) {
      calledRead = true;
      const path = extractFilePathFromToolInput(item.input);
      // 只统计已确认成功且参数未因历史缺失而丢失的读取。
      if (
        path &&
        statusOf(item, blocks) === "ok" &&
        item.trace?.source !== "missing"
      ) {
        readPaths.add(path);
      }
      countedAsSpecific = true;
    }
    if (SEARCH_TOOLS.has(lower)) {
      calledSearch = true;
      if (statusOf(item, blocks) === "ok") {
        hasSearch = true;
      }
      countedAsSpecific = true;
    }
    if (FILE_BROWSE_TOOLS.has(lower)) {
      // Count invocations (not unique directories) — same convention as
      // commandCount / subagentResultCount; readCount dedupes by path.
      browseDirCount += 1;
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
    if (MEMORY_TOOLS.has(lower)) {
      hasMemory = true;
      countedAsSpecific = true;
    }
    if (lower === "bash" || lower === "execute_command") {
      commandCount += 1;
      countedAsSpecific = true;
    }
    if (lower === "agent") {
      subagentCount += 1;
      const input = item.input as Record<string, unknown>;
      subagents.push({
        name:
          typeof input.subagent_type === "string"
            ? input.subagent_type.trim()
            : "",
        description:
          typeof input.description === "string" ? input.description.trim() : "",
      });
      countedAsSpecific = true;
    }
    if (lower === "get_subagent_result") {
      subagentResultCount += 1;
      countedAsSpecific = true;
    }
    if (lower === "steer_subagent") {
      subagentSteerCount += 1;
      countedAsSpecific = true;
    }
    if (lower === "subagentworkflow") {
      subagentWorkflowCount += 1;
      countedAsSpecific = true;
    }
    if (GOAL_TOOLS.has(lower)) {
      hasGoal = true;
      countedAsSpecific = true;
    }
    if (lower === "todo_write" || lower === "todowrite") {
      todoUpdateCount += 1;
      countedAsSpecific = true;
    }
    if (!countedAsSpecific) {
      usedToolCount += 1;
    }
  }

  return {
    readCount: readPaths.size,
    browseDirCount,
    hasSearch,
    hasWebSearch,
    hasBrowse,
    hasMemory,
    commandCount,
    subagentCount,
    subagents,
    subagentResultCount,
    subagentSteerCount,
    subagentWorkflowCount,
    hasGoal,
    ttsCount,
    usedToolCount,
    todoUpdateCount,
    scriptCount,
    calledRead,
    calledSearch,
  };
}

function buildResultSummary(items: ToolUseContent[]): ResultSummary {
  const editedFiles = new Set<string>();
  const writtenFiles = new Set<string>();
  let calledEdit = false;
  let calledWrite = false;

  for (const item of items) {
    const lower = item.name.toLowerCase();
    const isEdit = lower === "edit" || lower === "edit_file";
    const isWrite = lower === "write" || lower === "write_file";
    if (!isEdit && !isWrite) {
      continue;
    }
    if (isEdit) {
      calledEdit = true;
    }
    if (isWrite) {
      calledWrite = true;
    }
    // missing 来源的参数只能用于详情展示，不作为已持久化文件统计。
    const path =
      item.trace?.source === "missing"
        ? null
        : extractFilePathFromToolInput(item.input);
    if (!path) {
      continue;
    }
    if (isEdit) {
      editedFiles.add(path);
    }
    if (isWrite) {
      writtenFiles.add(path);
    }
  }

  return {
    editedFiles: editedFiles.size,
    writtenFiles: writtenFiles.size,
    calledEdit,
    calledWrite,
  };
}

function buildGroupStatus(
  items: ToolUseContent[],
  blocks: ContentBlock[],
): ToolGroupStatusUi | undefined {
  const traces = items.flatMap((item) => (item.trace ? [item.trace] : []));
  const failedItems = items.filter(
    (item) => statusOf(item, blocks) === "error",
  );
  // 无 trace 也无普通失败时不附加状态，保持旧调用方输出稳定。
  if (traces.length === 0 && failedItems.length === 0) {
    return undefined;
  }
  return {
    running: traces.some(
      (trace) => trace.status === "running" || trace.parentStatus === "running",
    ),
    failed:
      failedItems.length > 0 ||
      traces.some((trace) => trace.parentStatus === "error"),
    unfinished: traces.some(
      (trace) =>
        trace.status === "unfinished" || trace.parentStatus === "unfinished",
    ),
    incomplete: traces.some(
      (trace) => !trace.complete && trace.source !== "missing",
    ),
    unavailable: traces.some(
      (trace) =>
        trace.source === "missing" ||
        (trace.source === "live" && trace.parentStatus === "unfinished"),
    ),
    firstFailedToolCallId:
      failedItems[0]?.id ??
      traces.find((trace) => trace.parentStatus === "error")?.parentToolCallId,
  };
}

function collectGroupScripts(items: ToolUseContent[]): GroupScriptUi[] {
  return [
    ...new Map(
      items.flatMap((item) =>
        item.trace?.script
          ? [[item.trace.script.id, item.trace.script] as const]
          : [],
      ),
    ).values(),
  ];
}

export function buildProcessSummaryDisplayBlock(
  items: ToolUseContent[],
  blocks: ContentBlock[] = [],
): ProcessSummaryDisplayBlock {
  const status = buildGroupStatus(items, blocks);
  const scripts = collectGroupScripts(items);
  return {
    type: "process-summary",
    items,
    summary: buildProcessSummary(items, blocks),
    ...(status ? { status } : {}),
    ...(scripts.length > 0 ? { scripts } : {}),
  };
}

function buildSummaryBlock(
  kind: "process" | "result",
  items: ToolUseContent[],
  blocks: ContentBlock[],
): DisplayBlock {
  const status = buildGroupStatus(items, blocks);
  const scripts = collectGroupScripts(items);
  const group = {
    ...(status ? { status } : {}),
    ...(scripts.length > 0 ? { scripts } : {}),
  };
  return kind === "process"
    ? {
        type: "process-summary",
        items,
        summary: buildProcessSummary(items, blocks),
        ...group,
      }
    : {
        type: "result-summary",
        items,
        summary: buildResultSummary(items),
        files: collectResultFiles(items, blocks),
        ...group,
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

export function buildToolDisplayBlocks(
  blocks: ContentBlock[],
  lookupBlocks: ContentBlock[] = blocks,
): DisplayBlock[] {
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
    displayBlocks.push(
      buildSummaryBlock(currentKind, currentItems, lookupBlocks),
    );
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
    // 除专用卡片外一律归组；虚拟嵌套块连专用卡片名字也不豁免（它只能来自投影）。
    const kind = getToolKind(block.name) ?? (block.trace ? "process" : null);

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

function formatSubagentDetails(
  subagents: SubagentSummary[] | undefined,
  t: TFunction,
): string {
  const details = (subagents ?? [])
    .map(({ name, description }) => {
      if (name && description) {
        return t("tool.grouped.subagentDetail", { name, description });
      }
      return name || description;
    })
    .filter(Boolean);

  return details.join(t("tool.grouped.subagentDetailSeparator"));
}

export type ProcessSummaryFragment = {
  text: string;
  iconType:
    | "read"
    | "search"
    | "filebrowse"
    | "websearch"
    | "browse"
    | "memory"
    | "command"
    | "subagent"
    | "goal"
    | "tasklist"
    | "tts"
    | "tool";
};

export function getProcessSummaryFragments(
  summary: ProcessSummary,
  t: TFunction,
  status?: ToolGroupStatusUi,
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
  if (summary.readCount === 0 && summary.calledRead) {
    fragments.push({ text: t("tool.grouped.calledRead"), iconType: "read" });
  }
  if ((summary.browseDirCount ?? 0) > 0) {
    fragments.push({
      text: t(
        pluralKey(
          "tool.grouped.browsedDirectories",
          summary.browseDirCount ?? 0,
        ),
        { count: summary.browseDirCount ?? 0 },
      ),
      iconType: "filebrowse",
    });
  }
  if (summary.hasSearch) {
    fragments.push({
      text: t("tool.grouped.searchedCode"),
      iconType: "search",
    });
  }
  if (!summary.hasSearch && summary.calledSearch) {
    fragments.push({
      text: t("tool.grouped.calledSearch"),
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
  if (summary.hasMemory) {
    fragments.push({
      text: t("tool.grouped.consultedMemory"),
      iconType: "memory",
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
    const countLabel = t(
      pluralKey("tool.grouped.startedSubagents", summary.subagentCount),
      { count: summary.subagentCount },
    );
    const details = formatSubagentDetails(summary.subagents, t);
    fragments.push({
      text: details ? `${countLabel} · ${details}` : countLabel,
      iconType: "subagent",
    });
  }
  if ((summary.subagentResultCount ?? 0) > 0) {
    const count = summary.subagentResultCount ?? 0;
    fragments.push({
      text: t(pluralKey("tool.grouped.gotSubagentResults", count), { count }),
      iconType: "subagent",
    });
  }
  if ((summary.subagentSteerCount ?? 0) > 0) {
    const count = summary.subagentSteerCount ?? 0;
    fragments.push({
      text: t(pluralKey("tool.grouped.steeredSubagents", count), { count }),
      iconType: "subagent",
    });
  }
  if ((summary.subagentWorkflowCount ?? 0) > 0) {
    const count = summary.subagentWorkflowCount ?? 0;
    fragments.push({
      text: t(pluralKey("tool.grouped.ranSubagentWorkflows", count), { count }),
      iconType: "subagent",
    });
  }
  if (summary.hasGoal) {
    fragments.push({
      text: t("tool.grouped.managedGoal"),
      iconType: "goal",
    });
  }
  if (summary.todoUpdateCount > 0) {
    fragments.push({
      text: t(
        pluralKey("tool.grouped.updatedTaskList", summary.todoUpdateCount),
        {
          count: summary.todoUpdateCount,
        },
      ),
      iconType: "tasklist",
    });
  }
  if ((summary.ttsCount ?? 0) > 0) {
    fragments.push({
      text: t(pluralKey("tool.grouped.spokeText", summary.ttsCount ?? 0), {
        count: summary.ttsCount ?? 0,
      }),
      iconType: "tts",
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

  if ((summary.scriptCount ?? 0) > 0) {
    const count = summary.scriptCount ?? 0;
    fragments.push({
      text: status?.running
        ? t("tool.grouped.runningScript")
        : t(
            pluralKey(
              status?.failed || status?.unfinished || status?.unavailable
                ? "tool.grouped.calledScripts"
                : "tool.grouped.executedScripts",
              count,
            ),
            { count },
          ),
      iconType: "command",
    });
  } else if (fragments.length === 0 && status?.running) {
    fragments.push({
      text: t("tool.grouped.runningScript"),
      iconType: "command",
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

  if (summary.editedFiles === 0 && summary.calledEdit)
    fragments.push(t("tool.grouped.calledEdit"));
  if (summary.writtenFiles === 0 && summary.calledWrite)
    fragments.push(t("tool.grouped.calledWrite"));
  return joinSummaryFragments(fragments, t);
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
    // 缺失权威记录的详情参数不能进入 artifact 文件统计。
    if (item.trace?.source === "missing") {
      continue;
    }
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
    const found = blocks.find(
      (block) => block.type === "tool_result" && block.toolUseId === item.id,
    );
    const result = found?.type === "tool_result" ? found : undefined;

    if (item.trace && !result?.diff) current.lineStatsUnavailable = true;

    if (lower === "edit" || lower === "edit_file") {
      current.edits += 1;
      // 只有已有真实 diff 才计算增删，运行时明细缺失时不推算。
      if (result && !result.outputUnavailable) {
        const { added, removed } = countDiffLines(result.diff ?? "");
        current.addedLines += added;
        current.removedLines += removed;
      }
    }
    if (lower === "write" || lower === "write_file") {
      current.writes += 1;
      // 终态但正文不可用时，参数里的内容不代表已落盘的结果。
      if (item.trace) {
        if (result?.diff) {
          const { added, removed } = countDiffLines(result.diff ?? "");
          current.addedLines += added;
          current.removedLines += removed;
        }
      } else if (!result?.outputUnavailable) {
        current.addedLines += countWriteLines(item.input.content);
      }
    }

    files.set(path, current);
  }

  return [...files.values()];
}
