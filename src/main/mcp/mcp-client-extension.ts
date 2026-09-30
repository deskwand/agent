/**
 * 把 DeskBand 的部件接到 pi 内置 MCP 扩展的 7 个注入点上。
 *
 * 刻意**不接** `credentials`：OAuth token 用内置默认存储（agent 目录下的 `mcp-auth.json`），
 * 这样本次改动不触碰 DeskBand 既有的 `auth.json` 与凭据体系（设计 §5.4）。
 *
 * 本模块是 inert 的 —— 在被加进会话的 `extensionFactories` 之前不会做任何事。
 */
import {
  createMcpExtension,
  type ExtensionAPI,
  type ExtensionFactory,
  type McpServerEntry,
} from "@earendil-works/pi-coding-agent";
import type { AuthProvider, McpTransport } from "@earendil-works/pi-mcp";
import { app, BrowserWindow, shell } from "electron";
import path from "node:path";
import { mcpConfigStore } from "./mcp-config-store";
import {
  projectMcpServers,
  type ProjectionContext,
  type ProjectedMcpConfig,
} from "./mcp-config-projection";
import { createDeskwandTransport } from "./mcp-transport-adapter";
import {
  findPreferredWindowsNpxPath,
  getBundledNodePath,
} from "./mcp-server-paths";
import { log, logWarn } from "../utils/logger";

const SCOPE = "global" as const;

/**
 * 投影所需实现的注入点。`resolveServerPath` 复用 store 自己的预设路径逻辑
 * （store 本来就在 `createFromPreset` 里解析这两个 token）。
 */
export function createProjectionContext(): ProjectionContext {
  return {
    resolveServerPath(token: string): string {
      const resolved = mcpConfigStore.resolveServerPathToken(token);
      if (!resolved)
        throw new Error(`unresolved server path placeholder: {${token}}`);
      return resolved;
    },
    resolveBundledNode(): string {
      return getBundledNodePath()?.node ?? "node";
    },
    resolveWindowsNpx(command: string): string {
      if (
        process.platform !== "win32" ||
        !command ||
        path.isAbsolute(command)
      ) {
        return command;
      }
      return (
        findPreferredWindowsNpxPath(
          process.env.PATH,
          getBundledNodePath()?.npx ?? null,
        ) ?? command
      );
    },
  };
}

/** 供 `loadConfig` 使用：读自研 store 并投影成内置 MCP 的配置形态。 */
export function loadDeskwandMcpConfig(): ProjectedMcpConfig {
  const servers = mcpConfigStore.getServers();
  const projected = projectMcpServers(servers, createProjectionContext());
  if (projected.errors.length > 0) {
    logWarn("[MCP] projection errors:", projected.errors.join("; "));
  }
  return projected;
}

/**
 * UI 需要的工具清单。内置扩展自己把 MCP 工具注册进会话，`connections()` 又是闭包读不到，
 * 所以从扩展 API 的 `getAllTools()` 里筛 `mcp__<server>__<tool>`。
 */
export interface McpToolSnapshotEntry {
  serverId: string;
  serverName: string;
  name: string;
  description: string;
}

let toolSnapshot: McpToolSnapshotEntry[] = [];

export function getMcpToolsSnapshot(): McpToolSnapshotEntry[] {
  return toolSnapshot;
}

function recordMcpTools(pi: ExtensionAPI): void {
  const servers = mcpConfigStore.getServers();
  const idByEntryName = new Map(
    servers.map((server) => [
      sanitize(server.name),
      { id: server.id, name: server.name },
    ]),
  );
  const next: McpToolSnapshotEntry[] = [];
  for (const tool of pi.getAllTools()) {
    const match = /^mcp__(.+?)__(.+)$/.exec(tool.name);
    if (!match) continue;
    const owner = idByEntryName.get(match[1]);
    if (!owner) continue;
    next.push({
      serverId: owner.id,
      serverName: owner.name,
      name: tool.name,
      description: tool.description ?? "",
    });
  }
  toolSnapshot = next;
}

function mcpLogPath(): string {
  // DeskBand 自己的日志目录，而不是 pi 的 agent 目录
  return path.join(app.getPath("userData"), "logs", "mcp.log");
}

/**
 * 构建内置 MCP 扩展。7 个注入点里接了 6 个（`credentials` 不接，见文件头）。
 */
export function createDeskwandMcpExtension(): ExtensionFactory {
  log("[MCP] creating builtin mcp extension");
  const inner = createMcpExtension({
    loadConfig: (): ProjectedMcpConfig => loadDeskwandMcpConfig(),

    createTransport: (
      entry: McpServerEntry,
      cwd: string,
      authProvider: AuthProvider | undefined,
    ): McpTransport => createDeskwandTransport(entry, cwd, authProvider),

    logPath: mcpLogPath(),

    // 授权页在 DeskBand 自己的窗口里打开（而不是系统浏览器）；拿不到就退回 shell
    openUrl: (url: string): void => {
      const opened = openInDeskwandWindow(url);
      if (!opened) void shell.openExternal(url);
    },

    // `/mcp` 对 server 的改动写回自研 store，使既有 save/delete IPC 的行为不变
    updateConfig: (
      entry: McpServerEntry,
      patch: { enabled?: boolean },
    ): void => {
      const target = mcpConfigStore
        .getServers()
        .find((candidate) => sanitize(candidate.name) === entry.name);
      if (!target) {
        logWarn(`[MCP] updateConfig: unknown server ${entry.name}`);
        return;
      }
      if (patch.enabled !== undefined) {
        mcpConfigStore.saveServer({ ...target, enabled: patch.enabled });
      }
    },

    startupWaitMs: 10_000,
  });

  // 包一层：内置扩展负责连接与注册工具，我们额外把 mcp__* 工具名记下来给设置界面用。
  // 连接是异步的，所以除了 factory 本身，也在会话开始与每次工具执行后刷新快照。
  return async (pi: ExtensionAPI): Promise<void> => {
    await inner(pi);
    recordMcpTools(pi);
    pi.on("session_start", () => recordMcpTools(pi));
    pi.on("tool_execution_end", () => recordMcpTools(pi));
  };
}

function sanitize(name: string): string {
  return name.replace(/\s+/g, "_").replace(/__/g, "_");
}

/** 把 URL 交给 DeskBand 的主窗口打开；没有可用窗口时返回 false。 */
function openInDeskwandWindow(url: string): boolean {
  const target = BrowserWindow.getAllWindows().find(
    (win) => !win.isDestroyed(),
  );
  if (!target) return false;
  void target.loadURL(url);
  target.show();
  return true;
}

export { SCOPE };
