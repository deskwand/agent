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
import { app, shell } from "electron";
import path from "node:path";
import { readMcpConfig, setServerEnabled } from "../connectors/mcp-config-file";
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
    // 不再补默认值：上游 `exposureOf` 对未带该键的 entry 取 `codemode`。
    activePi.registerMcpServer(name, config);
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
/**
 * 传输层已交还 SDK（不再传 `createTransport`），所以「打包环境找不到 node / npx」这件事
 * 只能在**配置投影**里解决：把 `command` 改写成打包二进制的绝对路径，并注入 `env.PATH`。
 *
 * 两件事的必要性不同（已核实）：
 *  - **改写 `command` 是必需的**。打包的 `npx` 是个 shell wrapper（`exec "$DIR/node" …`），
 *    用绝对路径调用它就能工作；而裸 `npx` / `node` 在 Finder 启动的应用里 PATH 上没有。
 *  - **注入 `env.PATH` 是便宜的保险**，不是第一跳的必需：npm/npx **派生的那个包子进程**
 *    其 bin 常带 `#!/usr/bin/env node`，没有 PATH 就找不到 node。
 *
 * 不显式写 `command: "node"` / `"npx"` 的 server（如绝对路径、`uvx`、自建脚本）原样不动。
 */
function applyTransportPaths(config: McpServerConfig): McpServerConfig {
  if (!("command" in config)) return config;

  const bundled = getBundledNodePath();
  let command = config.command;
  if (command === "node") {
    command = bundled?.node ?? command;
  } else if (command === "npx" && bundled?.npx) {
    command = bundled.npx;
  } else if (process.platform === "win32" && !path.isAbsolute(command)) {
    command =
      findPreferredWindowsNpxPath(process.env.PATH, bundled?.npx ?? null) ??
      command;
  }

  // 用户显式给的 PATH 优先；否则打包 bin 目录前置 + 沿用现有 PATH。
  // 注意：即使配置里**没有** `env` 也要造一个出来 —— 否则对「无 env 的 server」
  // （绝大多数）这步注入就是空操作，那正是本注入存在的理由。
  const env: Record<string, string> = { ...(config.env ?? {}) };
  if (bundled && env.PATH === undefined) {
    env.PATH = [path.dirname(bundled.node), process.env.PATH]
      .filter(Boolean)
      .join(path.delimiter);
  }

  return {
    ...config,
    command,
    ...(Object.keys(env).length > 0 ? { env } : {}),
  };
}

/** 供 `loadConfig` 注入点使用：读 `<agentDir>/mcp.json`，套上传输路径改写。 */
export function loadDeskwandMcpConfig(agentDir: string): LoadedMcpConfig {
  const loaded = readMcpConfig(agentDir);
  if (loaded.errors.length > 0) {
    logWarn("[MCP] mcp.json errors:", loaded.errors.join("; "));
  }
  return {
    // 不再写 `autoEnableCodemode` —— 透传 mcp.json 顶层的值（pi 的全局 opt-out），
    // 无则让上游取默认 true。codemode 的激活按 pi 的设计由「有 codemode exposure
    // 的 server 连上」派生，不由这里决定。
    ...(loaded.autoEnableCodemode === undefined
      ? {}
      : { autoEnableCodemode: loaded.autoEnableCodemode }),
    errors: loaded.errors,
    servers: loaded.servers.map((entry) => ({
      ...entry,
      // 不再补 `exposure` 默认值：不写该键即取上游默认 `codemode`（见 §2.5）。
      config: applyTransportPaths(entry.config),
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

const toolsListeners = new Set<() => void>();

/** 工具快照变化时通知（连接页据此刷新「已连接 / 工具数」）。 */
export function onMcpToolsChange(fn: () => void): () => void {
  toolsListeners.add(fn);
  return () => {
    toolsListeners.delete(fn);
  };
}

export function getMcpToolsSnapshot(): McpToolSnapshotEntry[] {
  return toolSnapshot;
}

function collectMcpTools(pi: ExtensionAPI): McpToolSnapshotEntry[] {
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
  return next;
}

/**
 * 刷新「连接器页」用的工具快照。
 *
 * **整体包在 try 里是必须的**：这只是一个界面用的副作用，但它原先抛异常时会把
 * `createDeskwandMcpExtension()` 的工厂一起带崩 —— 工厂里后面那两句
 * `pi.on("session_start" | "tool_execution_end", …)` 就再也不会注册，
 * 而且**日志里不留任何痕迹**（排查时为此白跑了几轮）。副作用绝不能有这种能力。
 *
 * **不能用正则拆 `mcp__<server>__<tool>`**：server 名里可能含 `__`（用户自建），
 * 非贪婪匹配会把它切错。改成拿已知 server 名做前缀匹配 —— 名字是我们自己写的。
 */
function recordMcpTools(pi: ExtensionAPI): void {
  try {
    toolSnapshot = collectMcpTools(pi);
  } catch (error) {
    // 只是界面用的副作用，绝不能让它把扩展工厂带崩 —— 它曾经在「扩展加载期」调用
    // `getAllTools()`（SDK 禁止 action 方法），抛出后连后面两个 `pi.on(...)` 都不再注册，
    // 且不留痕迹。留着这个 catch 是为了下次能立刻看到原因。
    logWarn("[MCP] recordMcpTools failed:", error);
  }
  for (const listener of toolsListeners) listener();
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
    // **不要在工厂里同步调用 `recordMcpTools`** —— 那是「扩展加载期」，SDK 禁止
    // `getAllTools()` 这类 action 方法：
    //   Error: Extension runtime not initialized. Action methods cannot be called
    //          during extension loading.
    // 只在会话事件里刷新（那时 runtime 已就绪）。
    pi.on("session_start", () => recordMcpTools(pi));
    pi.on("tool_execution_end", () => recordMcpTools(pi));
  };
}

export { SCOPE };
