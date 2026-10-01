import { describe, it, expect } from "vitest";

/**
 * 旧 `MCPManager` 与 `sanitizeMcpServerKey` 已删除（内置 MCP 扩展接管连接与工具注册，
 * 配置改为通用 `mcp.json`，server 名不再做 sanitize）。
 *
 * 本文件保留其**仍然有效的契约**：工具名前缀是 `mcp__<server>__<tool>`，
 * 且 `<server>` 与 `mcp.json` 里的 key 逐字一致（工具名一变就破坏提示词缓存）。
 *
 * 历史坑：旧实现会 sanitize 名字（空格→下划线、`__`→`_`）。新路径**不做**这件事 ——
 * 名字逐字落盘，因为改名会让所有 MCP 工具名变化。因此反解工具名时不能靠正则拆，
 * 必须用已知名字做前缀匹配（见 `mcp-client-extension.ts` 的 `recordMcpTools`）。
 */

/** 与 recordMcpTools 同样的前缀匹配策略。 */
function serverForToolName(toolName: string, names: readonly string[]): string | undefined {
  const sorted = [...names].sort((a, b) => b.length - a.length);
  return sorted.find((name) => toolName.startsWith(`mcp__${name}__`));
}

describe("MCP tool name prefix", () => {
  it("extracts the server name for plain names", () => {
    expect(serverForToolName("mcp__Chrome__click", ["Chrome"])).toBe("Chrome");
  });

  it("handles the builtin preset names", () => {
    const names = ["Chrome", "GUI_Operate", "Software_Development"];
    expect(serverForToolName("mcp__Chrome__click", names)).toBe("Chrome");
    expect(serverForToolName("mcp__GUI_Operate__list_windows", names)).toBe("GUI_Operate");
    expect(
      serverForToolName("mcp__Software_Development__create_or_modify_code", names),
    ).toBe("Software_Development");
  });

  it("keeps whitespace in a user-chosen name (names are no longer sanitized)", () => {
    expect(serverForToolName("mcp__My Server__do", ["My Server"])).toBe("My Server");
  });

  it("matches the longest name when one is a prefix of another", () => {
    // 正则非贪婪拆分会把 "a__b" 切成 "a"，这正是不能靠正则的原因
    expect(serverForToolName("mcp__a__b__tool", ["a", "a__b"])).toBe("a__b");
  });

  it("returns undefined for tools that are not MCP tools", () => {
    expect(serverForToolName("read_file", ["Chrome"])).toBeUndefined();
    expect(serverForToolName("mcp__Unknown__x", ["Chrome"])).toBeUndefined();
  });

  it("does not confuse a tool name that merely contains the prefix", () => {
    expect(serverForToolName("xmcp__Chrome__t", ["Chrome"])).toBeUndefined();
  });
});
