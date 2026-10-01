/**
 * 渲染层 IPC 类型 → SDK 配置类型的转换。
 *
 * 两个 `McpServerConfig` 不是同一个东西：
 *  - `src/shared/ipc-types.ts` 的是旧设置页的表单形状（带 `id` / `name`）
 *  - SDK 的是连接配置（stdio | http，没有 name —— name 是 `mcpServers` 的 key）
 *
 * 旧 IPC（`mcp.saveServer` / `mcp.deleteServer`）保留给设置页的「MCP 服务（高级）」用，
 * 所以这层转换必须留着，把表单形状翻成 `mcp.json` 能存的形状。
 */
import type { McpServerConfig } from "@earendil-works/pi-coding-agent";
import type { McpServerConfig as IpcMcpServerConfig } from "../../shared/ipc-types";
import { logWarn } from "../utils/logger";

export function ipcConfigToSdkConfig(
  config: IpcMcpServerConfig,
): McpServerConfig {
  const enabled = config.enabled;

  if (config.type === "stdio" || config.command) {
    return {
      type: "stdio",
      command: config.command ?? "",
      ...(config.args ? { args: config.args } : {}),
      ...(config.env ? { env: config.env } : {}),
      ...(config.cwd ? { cwd: config.cwd } : {}),
      enabled,
      exposure: "direct",
    };
  }

  // SSE 与 streamable-http 都落到 http：SDK 的配置表达不了 SSE
  // （McpHttpServerConfig.type?: "http"）。SSE 已被 Streamable HTTP 取代，
  // 且多数服务同时提供 /mcp 端点。见设计文档 §8 的边界说明。
  if (config.type === "sse") {
    logWarn(
      `[MCP] "${config.name}" uses the deprecated SSE transport; saving as http — ` +
        "prefer the server's /mcp endpoint",
    );
  }

  return {
    type: "http",
    url: config.url ?? "",
    ...(config.headers ? { headers: config.headers } : {}),
    enabled,
    exposure: "direct",
  };
}

/** SDK 配置 → 渲染层表单形状。设置页要编辑这些字段，所以得反向转换。 */
export function sdkConfigToIpcConfig(
  name: string,
  config: McpServerConfig,
): IpcMcpServerConfig {
  const enabled = config.enabled !== false;

  if ("url" in config) {
    return {
      id: name,
      name,
      // mcp.json 表达不了 sse；回读时统一呈现为 streamable-http
      type: "streamable-http",
      url: config.url,
      ...(config.headers ? { headers: config.headers } : {}),
      enabled,
    };
  }

  return {
    id: name,
    name,
    type: "stdio",
    command: config.command,
    ...(config.args ? { args: [...config.args] } : {}),
    ...(config.env ? { env: config.env } : {}),
    ...(config.cwd ? { cwd: config.cwd } : {}),
    enabled,
  };
}
