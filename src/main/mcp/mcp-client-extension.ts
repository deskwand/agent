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
  type LoadedMcpConfig,
  type McpServerConfig,
  type McpServerEntry,
} from "@earendil-works/pi-coding-agent";
import type { AuthProvider, McpTransport } from "@earendil-works/pi-mcp";
import { app, shell } from "electron";
import path from "node:path";
import { readMcpConfig, setServerEnabled } from "../connectors/mcp-config-file";
import { createDeskwandTransport } from "./mcp-transport-adapter";
import {
  findPreferredWindowsNpxPath,
  getBundledNodePath,
} from "./mcp-server-paths";
import { log, logWarn } from "../utils/logger";

const SCOPE = "global" as const;

/**
 * 会话存活期间持有扩展 API。
 *
 * `loadConfig` 注入点**只在 `session_start` 时调用一次**（SDK `extensions/mcp/index.js:708`），
 * 所以光写 `mcp.json` 不会让新 server 立刻连上 —— 本仓旧代码注释里那句
 * "takes effect on the next session" 是准确的。
 *
 * `pi.registerMcpServer()` 才能立即生效（文档原话：「servers registered later **right away**」），
 * 而 `ExtensionAPI` 只在扩展工厂内部拿得到，所以这里留个模块级把手。
 * 会话结束时置空，主进程据此回退到「下次对话生效」。
 */
let activePi: ExtensionAPI | undefined;

/**
 * 让一个刚写进 `mcp.json` 的 server 立刻连上。
 *
 * @returns true = 已交给 SDK 立即连接；false = 没有活跃会话，调用方应提示「下次对话生效」
 */
export function activateDeskwandMcpServer(
  name: string,
  config: McpServerConfig,
): boolean {
  if (!activePi) return false;
  try {
    activePi.registerMcpServer(name, {
      ...config,
      exposure: config.exposure ?? "direct",
    });
    log(`[MCP] registered ${name} for immediate connection`);
    return true;
  } catch (e) {
    logWarn(`[MCP] activate ${name} failed`, e);
    return false;
  }
}

/**
 * 打开授权页 —— **系统浏览器**，不是 App 自己的窗口。
 *
 * 曾经的实现在 `getAllWindows()` 里挑第一个窗口 `loadURL`，有两个问题：
 *  1. 会顶掉 App 界面（用户授权完回来发现 UI 没了）；
 *  2. 「第一个窗口」可能是宠物窗口/状态栏小窗，授权页会开在那种地方。
 * OAuth 授权页本身就该在浏览器里，用户能看见地址栏与自己的登录态。
 */
export function openExternalUrl(url: string): void {
  void shell.openExternal(url);
}

/**
 * 传输层需要的改写：打包的 Node、Windows 下的 npx 真实路径。
 *
 * 这两件都是 DeskBand 特有的（SDK 的 `createDefaultTransport` 用裸 `node` 和
 * `process.env.PATH`，打包环境会挂），所以即使配置改成了通用 `mcp.json`，改写仍要做。
 *
 * 注意：不重写 server 名 —— 名字直接决定 `mcp__<server>__<tool>`，改了就破坏提示词缓存。
 * 路径占位符已在写入 `mcp.json` 时解析（见 `builtin-presets.ts`）。
 */
function applyTransportPaths(config: McpServerConfig): McpServerConfig {
  if (!("command" in config)) return config;

  const command =
    config.command === "node"
      ? (getBundledNodePath()?.node ?? "node")
      : process.platform === "win32" && !path.isAbsolute(config.command)
        ? (findPreferredWindowsNpxPath(
            process.env.PATH,
            getBundledNodePath()?.npx ?? null,
          ) ?? config.command)
        : config.command;

  return { ...config, command };
}

/** 供 `loadConfig` 注入点使用：读 `<agentDir>/mcp.json`，套上传输路径改写。 */
export function loadDeskwandMcpConfig(agentDir: string): LoadedMcpConfig {
  const loaded = readMcpConfig(agentDir);
  if (loaded.errors.length > 0) {
    logWarn("[MCP] mcp.json errors:", loaded.errors.join("; "));
  }
  return {
    // autoEnableCodemode: false 与每个条目的 exposure:"direct" 配对；
    // 缺任何一个都会让 MCP 工具对模型不可见。
    autoEnableCodemode: false,
    errors: loaded.errors,
    servers: loaded.servers.map((entry) => ({
      ...entry,
      config: {
        ...applyTransportPaths(entry.config),
        // 用户从别的客户端拷进来的标准配置不带 exposure，SDK 会默认
        // codemode 把工具藏掉且不报错；这里补成 direct，但保留用户显式写的值。
        exposure: entry.config.exposure ?? "direct",
      },
    })),
  };
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
  // server 名即 id —— 配置的真相源现在是 mcp.json，不再有 store 生成的 uuid。
  //
  // **不能用正则拆 `mcp__<server>__<tool>`**：server 名里可能含 `__`（用户自建），
  // 非贪婪匹配会把它切错。改成拿已知 server 名去前缀匹配 —— 名字是我们自己写的，
  // 唯一确定，不需要从工具名反推。
  const names = readMcpConfig(piAgentDirRef())
    .servers.map((s) => s.name)
    // 长的优先，避免 "a" 抢走 "a__b" 的工具
    .sort((a, b) => b.length - a.length);

  const next: McpToolSnapshotEntry[] = [];
  for (const tool of pi.getAllTools()) {
    for (const serverName of names) {
      const prefix = `mcp__${serverName}__`;
      if (!tool.name.startsWith(prefix)) continue;
      next.push({
        serverId: serverName,
        serverName,
        name: tool.name,
        description: tool.description ?? "",
      });
      break;
    }
  }
  toolSnapshot = next;
}

/**
 * agent 目录在启动时确定；扩展是惰性的，可能在设置之前就被构建，
 * 所以用一个可注入的引用而不是常量。
 */
let agentDirRef: string | undefined;
export function setMcpAgentDir(dir: string): void {
  agentDirRef = dir;
}
function piAgentDirRef(): string {
  if (!agentDirRef)
    throw new Error("mcp agent dir not set; call setMcpAgentDir first");
  return agentDirRef;
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
    loadConfig: (): LoadedMcpConfig => loadDeskwandMcpConfig(piAgentDirRef()),

    createTransport: (
      entry: McpServerEntry,
      cwd: string,
      authProvider: AuthProvider | undefined,
    ): McpTransport => createDeskwandTransport(entry, cwd, authProvider),

    logPath: mcpLogPath(),

    // 授权页在 DeskBand 自己的窗口里打开（而不是系统浏览器）；拿不到就退回 shell
    openUrl: (url: string): void => {
      openExternalUrl(url);
    },

    // SDK 内部（如 /mcp 管理器）对 server 的改动写回 mcp.json，与 IPC 走同一条路
    updateConfig: (
      entry: McpServerEntry,
      patch: { enabled?: boolean },
    ): void => {
      if (patch.enabled === undefined) return;
      if (!setServerEnabled(piAgentDirRef(), entry.name, patch.enabled)) {
        logWarn(`[MCP] updateConfig: unknown server ${entry.name}`);
      }
    },

    startupWaitMs: 10_000,
  });

  // 包一层：内置扩展负责连接与注册工具，我们额外把 mcp__* 工具名记下来给设置界面用。
  // 连接是异步的，所以除了 factory 本身，也在会话开始与每次工具执行后刷新快照。
  return async (pi: ExtensionAPI): Promise<void> => {
    activePi = pi;
    pi.on("session_shutdown", () => {
      activePi = undefined;
    });
    await inner(pi);
    recordMcpTools(pi);
    pi.on("session_start", () => recordMcpTools(pi));
    pi.on("tool_execution_end", () => recordMcpTools(pi));
  };
}

export { SCOPE };
