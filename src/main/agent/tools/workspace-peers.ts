/**
 * @module main/agent/tools/workspace-peers
 *
 * `workspace_peers` —— 并行会话探测。
 *
 * 回答一个问题：**同一个工作目录下，除了我，还有谁在动东西？**
 * 目的是让模型在改共享仓库之前判断"这块是不是别人正在改"，不是继承别人的上下文。
 *
 * 数据来自 `agent-runner` 的 `tool_execution_start`（pi 事件自带完整 `args`），
 * 在内存里记成活动条目：**只留 path / command / 待办**，`write` 的 content 与
 * 工具输出从不进入内存，也就不可能泄漏到模型上下文。
 *
 * 不用 `trace_steps`：实测其 `tool_input` 有 99.4% 是 `{}`（参数流式补，
 * 落库那一刻还没到），基于它只会永远回答"没有改动"。
 *
 * 边界：只认 `toWorkspaceKey` 相同的 cwd（Windows 大小写/分隔符已归一），
 * 排除自己与已归档会话；`bash` 里改的文件推不出来。
 */
import { Type } from "@sinclair/typebox";
import {
  defineTool,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
  resolvePathAgainstWorkspace,
  toWorkspaceKey,
} from "../../../shared/workspace-path";

/**
 * 「最近动了什么」的固定时间窗。故意不做成工具参数：多一个旋钮就多一种用错的方式，
 * 30 分钟窗已经够回答"是不是有人在动"。
 */
export const PEER_WINDOW_MS = 30 * 60 * 1000;

export const MAX_PEERS = 5;
const MAX_ENTRIES_PER_SESSION = 200;
const MAX_FILES_PER_PEER = 10;
const MAX_BASH_PER_PEER = 3;
const MAX_PLAN_ITEMS_PER_PEER = 5;
const MAX_COMMAND_CHARS = 80;
const MAX_REPORT_CHARS = 2_000;

/**
 * 一条"动过什么"的记录。刻意是扁平可选字段而不是原始工具入参：
 * 原始入参里的 `content`（可能上百 KB、可能含密钥）从来不会被保存。
 */
export interface PeerActivityEntry {
  toolName: string;
  /** write / edit 的目标路径（原样，未归一）。 */
  path?: string;
  /** bash 的命令首行（已截断）。 */
  command?: string;
  /** todo_write 之后仍未完成的待办。 */
  plan?: { content: string; status: string }[];
  timestamp: number;
}

function readString(input: unknown, key: string): string | null {
  if (!input || typeof input !== "object") return null;
  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readPlan(input: unknown): { content: string; status: string }[] {
  if (!input || typeof input !== "object") return [];
  const todos = (input as { todos?: unknown }).todos;
  if (!Array.isArray(todos)) return [];
  const open: { content: string; status: string }[] = [];
  for (const entry of todos) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as { content?: unknown; status?: unknown };
    if (typeof item.content !== "string" || typeof item.status !== "string") {
      continue;
    }
    if (item.status === "completed" || item.status === "cancelled") continue;
    open.push({ content: item.content, status: item.status });
    if (open.length >= MAX_PLAN_ITEMS_PER_PEER) break;
  }
  return open;
}

/**
 * 从一次工具调用的入参里提取活动条目。不关心的工具回 `null` ——
 * 这里存的是"动过什么文件"，不是全量调用日志。
 */
export function toPeerActivityEntry(
  toolName: string,
  args: unknown,
  timestamp: number,
): PeerActivityEntry | null {
  if (toolName === "write" || toolName === "edit") {
    const path = readString(args, "path");
    return path ? { toolName, path, timestamp } : null;
  }
  if (toolName === "bash") {
    const command = readString(args, "command")?.split("\n")[0].trim();
    return command
      ? { toolName, command: command.slice(0, MAX_COMMAND_CHARS), timestamp }
      : null;
  }
  if (toolName === "todo_write") {
    return { toolName, plan: readPlan(args), timestamp };
  }
  return null;
}

/** 写入时与读取时都过一遍：丢窗外条目，再保留最近 `MAX_ENTRIES_PER_SESSION` 条。 */
export function pruneActivity(
  entries: readonly PeerActivityEntry[],
  now: number,
): PeerActivityEntry[] {
  const since = now - PEER_WINDOW_MS;
  return entries
    .filter((entry) => entry.timestamp >= since)
    .slice(-MAX_ENTRIES_PER_SESSION);
}

export interface WorkspacePeerSnapshot {
  title: string;
  isRunning: boolean;
  lastActivityAt: number;
  /** 窗内 write/edit 过的路径，按出现顺序去重后**保留最近**的 `MAX_FILES_PER_PEER` 条。 */
  files: string[];
  /** 窗内去重后的文件总数；比 `files.length` 大就说明这一行被折叠过。 */
  fileCount: number;
  /** 窗内最近几条 bash 命令（首行、已截断）。 */
  bashCommands: string[];
  /** 最后一条 `todo_write` 的未完成项；`null` = 这个会话没用过待办。 */
  plan: { content: string; status: string }[] | null;
}

export interface WorkspacePeersResult {
  peers: WorkspacePeerSnapshot[];
  /** 因为 `MAX_PEERS` 没被列出的同目录会话数 —— 报告里要如实说明，不静默截断。 */
  omittedCount: number;
}

export function selectWorkspacePeerIds(
  sessions: readonly { id: string; cwd?: string; archived?: boolean }[],
  selfId: string,
  selfCwd: string,
): string[] {
  const key = toWorkspaceKey(selfCwd);
  if (!key) return [];
  return sessions
    .filter(
      (session) =>
        session.id !== selfId &&
        !session.archived &&
        typeof session.cwd === "string" &&
        toWorkspaceKey(session.cwd) === key,
    )
    .map((session) => session.id);
}

/** 把一次会话的活动条目折成报告要用的快照。纯函数：不做时间过滤（调用方已剪枝）。 */
export function extractPeerActivity(input: {
  title: string;
  isRunning: boolean;
  lastActivityAt: number;
  entries: readonly PeerActivityEntry[];
}): WorkspacePeerSnapshot {
  const allFiles: string[] = [];
  const seen = new Set<string>();
  const commands: string[] = [];
  let plan: { content: string; status: string }[] | null = null;

  for (const entry of input.entries) {
    if (entry.path && !seen.has(entry.path)) {
      seen.add(entry.path);
      allFiles.push(entry.path);
    }
    if (entry.command) commands.push(entry.command);
    if (entry.plan) plan = entry.plan;
  }

  return {
    title: input.title,
    isRunning: input.isRunning,
    lastActivityAt: input.lastActivityAt,
    // 冲突最可能来自最近的改动：折叠时丢最早的，不是丢最新的。
    files: allFiles.slice(-MAX_FILES_PER_PEER),
    fileCount: allFiles.length,
    bashCommands: commands.slice(-MAX_BASH_PER_PEER),
    plan,
  };
}

/** 折叠过就说清楚「这是最近 N 个，共 M 个」——静默截断会让模型以为看全了。 */
function describeFileScope(peer: WorkspacePeerSnapshot): string {
  return peer.fileCount > peer.files.length
    ? ` (last ${peer.files.length} of ${peer.fileCount})`
    : "";
}

function describeAgo(timestamp: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - timestamp) / 60_000));
  return minutes < 1 ? "just now" : `${minutes}m ago`;
}

/** cwd 内的路径折回相对路径（沙盒会话给的是 `/workspace/...`），窗外路径原样返回。 */
function displayPath(path: string, selfCwd: string): string {
  const resolved = resolvePathAgainstWorkspace(path, selfCwd);
  const trimmedCwd = selfCwd.replace(/[/\\]+$/, "");
  if (!trimmedCwd) return resolved;
  const inside =
    resolved.startsWith(`${trimmedCwd}/`) ||
    resolved.startsWith(`${trimmedCwd}\\`);
  return inside
    ? resolved.slice(trimmedCwd.length + 1).replaceAll("\\", "/")
    : resolved;
}

export function formatPeersReport(input: {
  selfCwd: string;
  peers: readonly WorkspacePeerSnapshot[];
  omittedCount: number;
  now: number;
}): string {
  const windowMinutes = Math.round(PEER_WINDOW_MS / 60_000);
  if (input.peers.length === 0) {
    return `No other session is working in ${input.selfCwd} (window ${windowMinutes}m).`;
  }

  const running = input.peers.filter((peer) => peer.isRunning).length;
  const lines = [
    `Peers in ${input.selfCwd} — ${input.peers.length} other${
      input.peers.length === 1 ? "" : "s"
    }, ${running} running (window ${windowMinutes}m)`,
    "",
  ];

  input.peers.forEach((peer, index) => {
    lines.push(
      `${index + 1}. ${peer.title} — ${
        peer.isRunning ? "running" : "idle"
      }, last activity ${describeAgo(peer.lastActivityAt, input.now)}`,
    );
    lines.push(
      peer.files.length > 0
        ? `   touched${describeFileScope(peer)}: ${peer.files
            .map((file) => displayPath(file, input.selfCwd))
            .join(", ")}`
        : `   no file activity in ${windowMinutes}m`,
    );
    if (peer.bashCommands.length > 0) {
      lines.push(`   bash: ${peer.bashCommands.join("; ")}`);
    }
    if (peer.plan) {
      lines.push(
        `   plan: ${
          peer.plan.length > 0
            ? peer.plan
                .map((item) => `[${item.status}] ${item.content}`)
                .join(" · ")
            : "all items done"
        }`,
      );
    }
  });

  if (input.omittedCount > 0) {
    lines.push(
      "",
      `… and ${input.omittedCount} more session${
        input.omittedCount === 1 ? "" : "s"
      } in this workspace`,
    );
  }

  const report = lines.join("\n");
  return report.length <= MAX_REPORT_CHARS
    ? report
    : `${report.slice(0, MAX_REPORT_CHARS - 1)}…`;
}

export interface WorkspacePeersToolOptions {
  selfSessionId: string;
  selfCwd: string;
  /**
   * 由 `SessionManager` 注入：已按同 cwd 过滤、排好序、截断好、并把内存条目折成快照的 peer 列表。
   * 注入而不是直接 import 单例 —— 测试与后台 review runner 都能喂自己的数据。
   */
  listPeers: (selfSessionId: string, selfCwd: string) => WorkspacePeersResult;
  now?: () => number;
}

function text(body: string) {
  return {
    content: [{ type: "text" as const, text: body }],
    details: undefined,
  };
}

export function createWorkspacePeersTool(
  options: WorkspacePeersToolOptions,
): ToolDefinition {
  return defineTool({
    name: "workspace_peers",
    label: "Workspace Peers",
    description:
      "List the other sessions working in the same project directory: which files each of them " +
      "touched recently, the commands they ran, and their current plan. Use it to avoid editing " +
      "the same files at the same time as another session. Read-only: it never returns another " +
      "session's file contents, tool output, or conversation.",
    promptSnippet:
      "Check which other sessions are editing this project before you write files.",
    promptGuidelines: [
      "In a project session, call workspace_peers once before your first write or edit in the shared repo.",
      "If a running peer touched the same files you are about to change, tell the user the conflict before changing them.",
      "This tool reports file names, commands and plans only; it never returns another session's file contents or conversation.",
    ],
    parameters: Type.Object({}),
    async execute() {
      try {
        const { peers, omittedCount } = options.listPeers(
          options.selfSessionId,
          options.selfCwd,
        );
        return text(
          formatPeersReport({
            selfCwd: options.selfCwd,
            peers,
            omittedCount,
            now: (options.now ?? Date.now)(),
          }),
        );
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return text(`workspace_peers failed: ${reason}`);
      }
    },
  });
}
