import { describe, it, expect } from "vitest";

import { sanitizeMcpServerKey } from "../src/main/mcp/mcp-config-projection";

/**
 * 旧 `MCPManager` 已删除（内置 MCP 扩展接管连接与工具注册）。本文件保留其**仍然有效的
 * 契约**：工具名前缀 `mcp__<serverKey>__<toolName>` 里的 serverKey 换算方式。
 *
 * 「工具返回结构化 Not connected 时重连并重试」的启发式**没有丢** —— 它搬到了传输层
 * （`mcp-transport-adapter.ts` 里对 tools/call 响应的拦截），因为上游的 tool_result 是
 * 只读观察事件、无法改写结果，而该行为必须由我们自己的传输来补。
 */
describe("MCP server key (tool name prefix)", () => {
  it("collapses whitespace to underscores", () => {
    expect(sanitizeMcpServerKey("Software Development")).toBe(
      "Software_Development",
    );
  });

  it("keeps an already-underscored name stable", () => {
    expect(sanitizeMcpServerKey("Software_Development")).toBe(
      "Software_Development",
    );
    expect(sanitizeMcpServerKey("GUI_Operate")).toBe("GUI_Operate");
  });

  it("collapses accidental double underscores so the tool name stays parseable", () => {
    expect(sanitizeMcpServerKey("a__b")).toBe("a_b");
    expect(sanitizeMcpServerKey("Chrome")).toBe("Chrome");
  });

  it("produces a name that round-trips through the mcp__<server>__<tool> pattern", () => {
    const serverKey = sanitizeMcpServerKey("Software Development");
    const toolName = `mcp__${serverKey}__create_or_modify_code`;
    expect(/^mcp__(.+?)__(.+)$/.exec(toolName)?.[1]).toBe(
      "Software_Development",
    );
    expect(/^mcp__(.+?)__(.+)$/.exec(toolName)?.[2]).toBe(
      "create_or_modify_code",
    );
  });
});
