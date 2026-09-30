/**
 * 自研 MCP 配置 → pi 内置 MCP 的 `McpServerEntry[]`。
 *
 * 三条硬约束（见设计 §4 陷阱①②）：
 *  1. 每个 server 强制 `exposure: "direct"` —— 上游默认是 `codemode`，那会让 MCP 工具
 *     对模型不可见，并触发 `autoEnableCodemode` 自动打开 codemode 工具（我们没批准的 A 项）。
 *  2. `autoEnableCodemode: false` —— 与上一条配对，缺一不可。
 *  3. store 专有字段（`id` / `requiresEnv` / `envDescription`）**不投影** —— 上游配置形态里
 *     没有它们的位置；它们留在自研 store 里供设置界面使用。
 *
 * 两个容易搞错的地方：
 *  - **名称必须 sanitize**，与旧客户端逐字一致（`mcp-manager.ts` 的
 *    `name.replace(/\s+/g,"_").replace(/__/g,"_")`）。否则含空格的 server 名会让
 *    `mcp__<server>__<tool>` 的工具名变更，破坏已有会话与提示词缓存。
 *  - **SSE 与 streamable HTTP 都投影成 `type: "http"`**：上游配置表达不了 SSE，
 *    真正的传输选择由适配器按 server 名回查自研 store 的原始 `type`。
 *
 * 本函数是纯函数：占位符解析、打包 Node、Windows npx 路径都由 `ProjectionContext` 注入，
 * 便于单测。
 */
import type {
  McpServerConfig,
  McpServerEntry,
} from "@earendil-works/pi-coding-agent";
import type { MCPServerConfig } from "./mcp-config-store";

export interface ProjectionContext {
  /** 解析 `{..._SERVER_PATH}` 一类占位符（真实实现见 mcp-server-paths.ts）。 */
  resolveServerPath(token: string): string;
  /** stdio 的 `command: "node"` 要换成 DeskBand 打包的 Node。 */
  resolveBundledNode(): string;
  /** Windows 上把非绝对路径的 npx 命令换成受信目录下的实际路径。 */
  resolveWindowsNpx(command: string): string;
}

export interface ProjectedMcpConfig {
  servers: McpServerEntry[];
  autoEnableCodemode: false;
  errors: string[];
}

const PLACEHOLDER = /\{([A-Z0-9_]+)\}/g;

/**
 * 与旧客户端 `mcp-manager.ts` 的 serverKey 计算逐字一致。
 * 改动这里等于改动对外可见的工具名 —— 不要"顺手优化"。
 */
export function sanitizeMcpServerKey(name: string): string {
  return name.replace(/\s+/g, "_").replace(/__/g, "_");
}

function resolveArgs(
  args: readonly string[],
  ctx: ProjectionContext,
): string[] {
  return args.map((arg) =>
    arg.replace(PLACEHOLDER, (_match, token: string) =>
      ctx.resolveServerPath(token),
    ),
  );
}

function projectStdio(
  server: MCPServerConfig,
  ctx: ProjectionContext,
): McpServerConfig {
  return {
    type: "stdio",
    command:
      server.command === "node"
        ? ctx.resolveBundledNode()
        : ctx.resolveWindowsNpx(server.command ?? ""),
    ...(server.args ? { args: resolveArgs(server.args, ctx) } : {}),
    // env 原样带过去；登录 shell 环境的合并发生在 spawn 时（见 transport 适配器）
    ...(server.env ? { env: server.env } : {}),
    ...(server.cwd ? { cwd: server.cwd } : {}),
    enabled: server.enabled,
    exposure: "direct",
  };
}

function projectHttp(
  server: MCPServerConfig,
  ctx: ProjectionContext,
): McpServerConfig {
  void ctx;
  return {
    type: "http",
    url: server.url ?? "",
    ...(server.headers ? { headers: server.headers } : {}),
    enabled: server.enabled,
    exposure: "direct",
  };
}

export function projectMcpServers(
  servers: readonly MCPServerConfig[],
  ctx: ProjectionContext,
): ProjectedMcpConfig {
  const out: McpServerEntry[] = [];
  const errors: string[] = [];

  for (const server of servers) {
    try {
      const config =
        server.type === "stdio"
          ? projectStdio(server, ctx)
          : projectHttp(server, ctx);
      out.push({
        name: sanitizeMcpServerKey(server.name),
        config,
        source: "deskwand",
        scope: "global",
      });
    } catch (error) {
      errors.push(
        `${server.name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return { servers: out, autoEnableCodemode: false, errors };
}
