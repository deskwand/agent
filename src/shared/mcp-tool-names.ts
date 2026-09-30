/**
 * MCP 工具名的识别。
 *
 * 大多数 MCP 工具是 `mcp__<server>__<tool>`（DeskBend 自研客户端与内置扩展都用这个格式），
 * 但内置扩展额外注册了三个 **resource** 工具，名字里没有 `mcp__` 前缀：
 *   list_mcp_resources / list_mcp_resource_templates / read_mcp_resource
 *
 * 它们本身就是 MCP 工具，必须和 `mcp__*` 走**同一套**归类与展示逻辑 —— 否则会在
 * 聊天摘要里作为「未分组工具」出现，违反 AGENTS.md §4。
 */
const MCP_RESOURCE_TOOL_NAMES = new Set([
  "list_mcp_resources",
  "list_mcp_resource_templates",
  "read_mcp_resource",
]);

export const MCP_TOOL_PREFIX = "mcp__";

export function isMcpToolName(name: string | undefined): boolean {
  if (!name) return false;
  const lower = name.toLowerCase();
  return (
    lower.startsWith(MCP_TOOL_PREFIX) || MCP_RESOURCE_TOOL_NAMES.has(lower)
  );
}

/** 解析 `mcp__<server>__<tool>`；resource 工具没有 server 前缀，返回 undefined。 */
export function parseMcpToolName(
  name: string,
): { server: string; tool: string } | undefined {
  const match = /^mcp__(.+?)__(.+)$/.exec(name);
  if (!match) return undefined;
  return { server: match[1], tool: match[2] };
}
