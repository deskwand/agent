import { describe, expect, it } from "vitest";
import {
  formatCollapsedToolSummary,
  getCollapsedToolSummary,
} from "../../renderer/utils/tool-result-summary";

describe("getCollapsedToolSummary", () => {
  // --- read / read_file ---
  it("shows first line for read tool", () => {
    expect(getCollapsedToolSummary("read", "line1\nline2\nline3", false)).toEqual({
      kind: "text",
      text: "line1",
    });
  });

  it("shows first line for read_file", () => {
    expect(
      getCollapsedToolSummary("read_file", "import { useState }\n\nconst x = 1", false),
    ).toEqual({ kind: "text", text: "import { useState }" });
  });

  it("truncates long first line for read", () => {
    const long = "x".repeat(200);
    expect(getCollapsedToolSummary("read", long, false)).toEqual({
      kind: "text",
      text: `${"x".repeat(79)}…`,
    });
  });

  // --- bash / execute_command ---
  it("shows last non-empty line for bash", () => {
    expect(getCollapsedToolSummary("bash", "building...\ncompiling...\nexit 0", false)).toEqual({
      kind: "exitLine",
      text: "exit 0",
    });
  });

  it("shows last line for execute_command", () => {
    expect(
      getCollapsedToolSummary("execute_command", "ok", false),
    ).toEqual({ kind: "exitLine", text: "ok" });
  });

  // --- write / edit ---
  it("shows modified for write confirmation", () => {
    expect(
      getCollapsedToolSummary("write", "Wrote contents to /path/to/file.ts", false),
    ).toEqual({ kind: "modified" });
  });

  it("shows modified for edit confirmation", () => {
    expect(
      getCollapsedToolSummary(
        "edit",
        "The file /path/to/file.ts has been updated.",
        false,
      ),
    ).toEqual({ kind: "modified" });
  });

  // --- grep / glob ---
  it("counts matches for grep", () => {
    expect(
      getCollapsedToolSummary("grep", "src/a.ts\nsrc/b.ts\nsrc/c.ts", false),
    ).toEqual({ kind: "matches", count: 3 });
  });

  it("counts matches for glob", () => {
    expect(
      getCollapsedToolSummary("glob", "file1.ts\n\nfile2.ts\nfile3.ts", false),
    ).toEqual({ kind: "matches", count: 3 });
  });

  // --- webfetch ---
  it("counts chars for webfetch", () => {
    expect(
      getCollapsedToolSummary("webfetch", "hello world", false),
    ).toEqual({ kind: "chars", count: 11 });
  });

  // --- vision_describe ---
  it("shows line count for vision_describe description", () => {
    expect(
      getCollapsedToolSummary(
        "vision_describe",
        "[Image description of screenshot.png]\n\nA dark-themed code editor with syntax highlighting visible.",
        false,
      ),
    ).toEqual({ kind: "lines", count: 1 });
  });

  it("counts multiple lines for vision_describe output", () => {
    expect(
      getCollapsedToolSummary(
        "vision_describe",
        "[Image description of test.png]\n\nLine one.\nLine two.\nLine three.",
        false,
      ),
    ).toEqual({ kind: "lines", count: 3 });
  });

  it("counts lines without prefix for vision_describe fallback", () => {
    expect(
      getCollapsedToolSummary(
        "vision_describe",
        "Line one.\nLine two.",
        false,
      ),
    ).toEqual({ kind: "lines", count: 2 });
  });

  it("returns none for empty vision_describe output", () => {
    expect(getCollapsedToolSummary("vision_describe", "", false)).toEqual({
      kind: "none",
    });
  });

  // --- screenshot ---
  it("returns screenshot summary for screenshot tools", () => {
    expect(
      getCollapsedToolSummary("internal_browser_screenshot", "saved", false),
    ).toEqual({ kind: "screenshot" });
  });

  it("returns screenshot summary for screenshot success text", () => {
    expect(getCollapsedToolSummary("bash", "Screenshot saved", false)).toEqual({
      kind: "screenshot",
    });
  });

  it("suppresses weak success boilerplate", () => {
    expect(
      getCollapsedToolSummary("bash", "Command completed successfully", false),
    ).toEqual({ kind: "none" });
  });

  it("suppresses omitted image placeholder text", () => {
    expect(
      getCollapsedToolSummary(
        "mcp__GUI_Operate__screenshot_for_display",
        "[1 image output omitted from text context]",
        false,
      ),
    ).toEqual({ kind: "screenshot" });
  });

  // --- edge cases ---
  it("returns none for empty or non-string content", () => {
    expect(getCollapsedToolSummary("read", "", false)).toEqual({ kind: "none" });
    expect(getCollapsedToolSummary("read", null, false)).toEqual({ kind: "none" });
    expect(getCollapsedToolSummary("read", 42, false)).toEqual({ kind: "none" });
  });

  it("returns none when the tool result is missing", () => {
    expect(
      getCollapsedToolSummary("internal_browser_screenshot", undefined, false, false),
    ).toEqual({ kind: "none" });
  });

  it("truncates the first error line", () => {
    expect(getCollapsedToolSummary("bash", "E".repeat(100), true)).toEqual({
      kind: "error",
      text: `${"E".repeat(57)}...`,
    });
  });

  it("uses only the first error line", () => {
    expect(
      getCollapsedToolSummary("bash", "permission denied\nstack trace", true),
    ).toEqual({ kind: "error", text: "permission denied" });
  });

  // --- default fallback ---
  it("falls back to text for short unknown tool output", () => {
    expect(
      getCollapsedToolSummary("unknown_tool", "short output", false),
    ).toEqual({ kind: "text", text: "short output" });
  });

  it("falls back to line count for long unknown tool output", () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line${i}`).join("\n");
    expect(getCollapsedToolSummary("unknown_tool", lines, false)).toEqual({
      kind: "lines",
      count: 10,
    });
  });
});

describe("formatCollapsedToolSummary", () => {
  const t = (key: string, options?: { count?: number }) => {
    const map: Record<string, string> = {
      "tool.summaryLines": `${options?.count} lines`,
      "tool.summaryScreenshot": "Screenshot",
      "tool.summaryMatches": `${options?.count} matches`,
      "tool.summaryChars": `${options?.count} chars`,
      "tool.summaryModified": "Modified",
    };
    return map[key] || key;
  };

  it("formats text summaries with quotes", () => {
    expect(
      formatCollapsedToolSummary(
        { kind: "text", text: "import { useState }" },
        t as never,
      ),
    ).toBe('"import { useState }"');
  });

  it("formats match summaries through i18n", () => {
    expect(
      formatCollapsedToolSummary({ kind: "matches", count: 5 }, t as never),
    ).toBe("5 matches");
  });

  it("formats chars summaries through i18n", () => {
    expect(
      formatCollapsedToolSummary({ kind: "chars", count: 4200 }, t as never),
    ).toBe("4200 chars");
  });

  it("formats modified summaries through i18n", () => {
    expect(
      formatCollapsedToolSummary({ kind: "modified" }, t as never),
    ).toBe("Modified");
  });

  it("formats exitLine summaries directly", () => {
    expect(
      formatCollapsedToolSummary(
        { kind: "exitLine", text: "exit 0" },
        t as never,
      ),
    ).toBe("exit 0");
  });

  it("formats line summaries through i18n", () => {
    expect(
      formatCollapsedToolSummary({ kind: "lines", count: 3 }, t as never),
    ).toBe("3 lines");
  });

  it("formats screenshot summaries through i18n", () => {
    expect(formatCollapsedToolSummary({ kind: "screenshot" }, t as never)).toBe(
      "Screenshot",
    );
  });

  it("passes through error text and suppresses none", () => {
    expect(
      formatCollapsedToolSummary({ kind: "error", text: "boom" }, t as never),
    ).toBe("boom");
    expect(formatCollapsedToolSummary({ kind: "none" }, t as never)).toBe("");
  });
});
