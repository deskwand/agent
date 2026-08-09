/**
 * Renderer crash safety tests — verifies defensive data handling
 * in MessageCard helpers to prevent white-screen crashes.
 */
import { describe, it, expect } from "vitest";
import {
  formatCollapsedToolSummary,
  getCollapsedToolSummary,
} from "../renderer/utils/tool-result-summary";

// We can't import React components directly without a DOM environment,
// so we re-implement the pure logic functions to test them in isolation.
// These mirror the logic in MessageCard.tsx exactly.

/** shortenPath — mirrors MessageCard.tsx */
function shortenPath(p: string): string {
  if (typeof p !== "string") return String(p);
  const segments = p.replace(/\\/g, "/").split("/").filter(Boolean);
  if (segments.length <= 2) return segments.join("/");
  return segments.slice(-2).join("/");
}

/** getToolLabel — mirrors MessageCard.tsx */
function getToolLabel(name: string, input: unknown): string {
  const inp = (input as Record<string, unknown>) || {};
  if (name.startsWith("mcp__")) {
    const match = name.match(/^mcp__(.+?)__(.+)$/);
    return match?.[2] || name;
  }
  const nameLower = name.toLowerCase();
  if (nameLower === "read" || nameLower === "read_file") {
    const p = String(inp.file_path || inp.path || "");
    return p ? `Read ${shortenPath(p)}` : "Read file";
  }
  if (nameLower === "write" || nameLower === "write_file") {
    const p = String(inp.file_path || inp.path || "");
    return p ? `Write ${shortenPath(p)}` : "Write file";
  }
  if (nameLower === "edit" || nameLower === "edit_file") {
    const p = String(inp.file_path || inp.path || "");
    return p ? `Edit ${shortenPath(p)}` : "Edit file";
  }
  if (nameLower === "bash" || nameLower === "execute_command") {
    const cmd = String(inp.command || inp.cmd || "");
    if (cmd) {
      const short = cmd.length > 60 ? cmd.substring(0, 57) + "..." : cmd;
      return `$ ${short}`;
    }
    return "Run command";
  }
  if (nameLower === "glob")
    return inp.pattern ? `Glob ${String(inp.pattern)}` : "Glob";
  if (nameLower === "grep")
    return inp.pattern ? `Grep "${String(inp.pattern)}"` : "Grep";
  if (nameLower === "websearch")
    return inp.query ? `Search "${String(inp.query)}"` : "Web search";
  if (nameLower === "webfetch") {
    const url = String(inp.url || "");
    return url
      ? `Fetch ${url.length > 50 ? url.substring(0, 47) + "..." : url}`
      : "Fetch URL";
  }
  return name;
}

// ─── shortenPath ────────────────────────────────────────────
describe("shortenPath", () => {
  it("handles normal file path", () => {
    expect(shortenPath("/Users/foo/project/src/main.ts")).toBe("src/main.ts");
  });

  it("handles short path", () => {
    expect(shortenPath("main.ts")).toBe("main.ts");
  });

  it("handles Windows path", () => {
    expect(shortenPath("C:\\Users\\foo\\file.ts")).toBe("foo/file.ts");
  });

  it("does not crash on non-string input", () => {
    // @ts-expect-error testing runtime safety
    expect(shortenPath(undefined)).toBe("undefined");
    // @ts-expect-error testing runtime safety
    expect(shortenPath(null)).toBe("null");
    // @ts-expect-error testing runtime safety
    expect(shortenPath(42)).toBe("42");
  });

  it("handles empty string", () => {
    expect(shortenPath("")).toBe("");
  });
});

// ─── getToolLabel ───────────────────────────────────────────
describe("getToolLabel", () => {
  it("returns label for Read with file_path", () => {
    expect(getToolLabel("Read", { file_path: "/a/b/c.ts" })).toBe(
      "Read b/c.ts",
    );
  });

  it("returns fallback for Read with no path", () => {
    expect(getToolLabel("Read", {})).toBe("Read file");
    expect(getToolLabel("Read", null)).toBe("Read file");
  });

  it("does not crash when file_path is a number", () => {
    expect(getToolLabel("Read", { file_path: 123 })).toBe("Read 123");
  });

  it("handles MCP tool names", () => {
    expect(getToolLabel("mcp__server__doSomething", {})).toBe("doSomething");
  });

  it("handles bash with command", () => {
    expect(getToolLabel("bash", { command: "ls -la" })).toBe("$ ls -la");
  });

  it("handles bash with no command", () => {
    expect(getToolLabel("bash", {})).toBe("Run command");
  });

  it("truncates long commands", () => {
    const longCmd = "a".repeat(100);
    const result = getToolLabel("bash", { command: longCmd });
    expect(result.length).toBeLessThanOrEqual(62); // "$ " + 57 + "..."
  });

  it("does not crash on undefined input", () => {
    expect(getToolLabel("unknown_tool", undefined)).toBe("unknown_tool");
  });
});

// ─── getCollapsedToolSummary ─────────────────────────────────
describe("getCollapsedToolSummary (defensive)", () => {
  it("returns none for missing toolResult", () => {
    expect(getCollapsedToolSummary("Read", null, false)).toEqual({
      kind: "none",
    });
  });

  it("does not show screenshot when the tool result is missing", () => {
    expect(
      getCollapsedToolSummary(
        "internal_browser_screenshot",
        undefined,
        false,
        false,
      ),
    ).toEqual({ kind: "none" });
  });

  it("returns first-line preview for file read content", () => {
    // Read tools now return a first-line text preview instead of a line count
    expect(getCollapsedToolSummary("Read", "hello", false)).toEqual({
      kind: "text",
      text: "hello",
    });
  });

  it("handles error content", () => {
    expect(
      getCollapsedToolSummary("Read", "Error: file not found", true),
    ).toEqual({
      kind: "error",
      text: "Error: file not found",
    });
  });

  it("truncates long error first line", () => {
    const longLine = "E".repeat(100);
    const result = getCollapsedToolSummary("Read", longLine, true);
    expect(result).toEqual({
      kind: "error",
      text: `${"E".repeat(57)}...`,
    });
  });

  it("does not crash when content is null", () => {
    expect(getCollapsedToolSummary("Read", null, false)).toEqual({
      kind: "none",
    });
  });

  it("does not crash when content is undefined", () => {
    expect(getCollapsedToolSummary("Read", undefined, false)).toEqual({
      kind: "none",
    });
  });

  it("does not crash when content is a number", () => {
    expect(getCollapsedToolSummary("Read", 42, false)).toEqual({
      kind: "none",
    });
  });

  it("returns line count for long multi-line content of non-file tools", () => {
    const content = "line1\nline2\nline3\nline4\nline5\n" + "x".repeat(60);
    // "Read" is a file-read tool (first-line preview); line counting applies
    // to tools without a specific summary strategy.
    expect(getCollapsedToolSummary("SomeTool", content, false)).toEqual({
      kind: "lines",
      count: 6,
    });
  });
});

describe("formatCollapsedToolSummary (defensive)", () => {
  const t = (key: string, options?: { count?: number }) => {
    if (key === "tool.summaryLines") {
      return `${options?.count} lines`;
    }
    if (key === "tool.summaryScreenshot") {
      return "Screenshot";
    }
    return key;
  };

  it("returns empty for kind none", () => {
    expect(formatCollapsedToolSummary({ kind: "none" }, t as never)).toBe("");
  });

  it("returns error text unchanged", () => {
    expect(
      formatCollapsedToolSummary(
        { kind: "error", text: "permission denied" },
        t as never,
      ),
    ).toBe("permission denied");
  });
});
