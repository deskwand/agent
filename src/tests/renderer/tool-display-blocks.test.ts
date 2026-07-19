import { describe, expect, it } from "vitest";
import {
  buildToolDisplayBlocks,
  collectResultFiles,
  filterAssistantVisibleBlocks,
  formatProcessSummaryLabel,
  formatResultSummaryLabel,
  orderAssistantDisplayBlocks,
} from "../../renderer/utils/tool-display-blocks";
import type {
  ContentBlock,
  ToolResultContent,
  ToolUseContent,
} from "../../renderer/types";

function toolUse(
  id: string,
  name: string,
  input: Record<string, unknown> = {},
): ToolUseContent {
  return {
    type: "tool_use",
    id,
    name,
    input,
  };
}

function toolResult(
  toolUseId: string,
  options: {
    content?: string;
    isError?: boolean;
    diff?: string;
  } = {},
): ToolResultContent {
  return {
    type: "tool_result",
    toolUseId,
    content: options.content ?? "ok",
    isError: options.isError,
    diff: options.diff,
  };
}

describe("filterAssistantVisibleBlocks", () => {
  it("always removes thinking blocks regardless of trace visibility", () => {
    const blocks: ContentBlock[] = [
      { type: "thinking", thinking: "internal" },
      { type: "text", text: "Visible" },
      toolUse("read-1", "read", { path: "src/a.ts" }),
      toolResult("read-1", { content: "ok" }),
    ];

    // thinking should be removed even when trace blocks are visible
    expect(filterAssistantVisibleBlocks(blocks, false)).toEqual([
      { type: "text", text: "Visible" },
      toolUse("read-1", "read", { path: "src/a.ts" }),
      toolResult("read-1", { content: "ok" }),
    ]);
  });

  it("removes tool trace blocks when trace blocks are hidden", () => {
    const blocks: ContentBlock[] = [
      { type: "thinking", thinking: "internal" },
      { type: "text", text: "Visible" },
      toolUse("read-1", "read", { path: "src/a.ts" }),
      toolResult("read-1", { content: "ok" }),
    ];

    expect(filterAssistantVisibleBlocks(blocks, true)).toEqual([
      { type: "text", text: "Visible" },
    ]);
  });
});

describe("orderAssistantDisplayBlocks", () => {
  it("orders assistant blocks as content, result summaries, then process summaries", () => {
    const ordered = orderAssistantDisplayBlocks([
      {
        type: "process-summary",
        items: [toolUse("read-1", "read", { path: "src/a.ts" })],
        summary: {
          readCount: 1,
          hasSearch: false,
          hasWebSearch: false,
          hasBrowse: false,
          commandCount: 0,
          hasGoal: false,
          usedToolCount: 0,
        },
      },
      {
        type: "content",
        block: { type: "text", text: "Final answer" },
      },
      {
        type: "result-summary",
        items: [toolUse("edit-1", "edit", { path: "src/a.ts" })],
        summary: { editedFiles: 1, writtenFiles: 0 },
        files: [],
      },
    ]);

    expect(ordered.map((block) => block.type)).toEqual([
      "content",
      "result-summary",
      "process-summary",
    ]);
  });
});

describe("buildToolDisplayBlocks", () => {
  it("groups adjacent process tools into one block", () => {
    const blocks = buildToolDisplayBlocks([
      toolUse("read-1", "read", { path: "src/a.ts" }),
      toolResult("read-1", { content: "line 1" }),
      toolUse("grep-1", "grep", { pattern: "foo" }),
      toolResult("grep-1", { content: "src/a.ts:1" }),
      toolUse("bash-1", "bash", { command: "npm test" }),
      toolResult("bash-1", { content: "done" }),
    ]);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      type: "process-summary",
      summary: {
        readCount: 1,
        hasSearch: true,
        hasWebSearch: false,
        hasBrowse: false,
        commandCount: 1,
        hasGoal: false,
        usedToolCount: 0,
      },
    });
  });

  it("splits grouped blocks when text appears", () => {
    const blocks = buildToolDisplayBlocks([
      toolUse("read-1", "read", { path: "src/a.ts" }),
      toolResult("read-1", { content: "line 1" }),
      { type: "text", text: "我先看一下。" },
      toolUse("read-2", "read", { path: "src/b.ts" }),
      toolResult("read-2", { content: "line 2" }),
    ]);

    expect(blocks.map((block) => block.type)).toEqual([
      "process-summary",
      "content",
      "process-summary",
    ]);
  });

  it("groups result tools separately from process tools", () => {
    const blocks = buildToolDisplayBlocks([
      toolUse("read-1", "read", { path: "src/a.ts" }),
      toolResult("read-1", { content: "line 1" }),
      toolUse("edit-1", "edit", { path: "src/a.ts" }),
      toolResult("edit-1", {
        content: "updated",
        diff: [
          "--- a/src/a.ts",
          "+++ b/src/a.ts",
          "@@ -1 +1 @@",
          "-before",
          "+after",
        ].join("\n"),
      }),
      toolUse("write-1", "write", { path: "src/b.ts" }),
      toolResult("write-1", { content: "written" }),
    ]);

    expect(blocks.map((block) => block.type)).toEqual([
      "process-summary",
      "result-summary",
    ]);
    expect(blocks[1]).toMatchObject({
      type: "result-summary",
      summary: {
        editedFiles: 1,
        writtenFiles: 1,
      },
    });
  });

  it("deduplicates read files in process summaries", () => {
    const blocks = buildToolDisplayBlocks([
      toolUse("read-1", "read", { path: "src/a.ts" }),
      toolResult("read-1", { content: "line 1" }),
      toolUse("read-2", "read", { path: "src/a.ts" }),
      toolResult("read-2", { content: "line 2" }),
    ]);

    expect(blocks[0]).toMatchObject({
      type: "process-summary",
      summary: {
        readCount: 1,
        hasSearch: false,
        hasWebSearch: false,
        hasBrowse: false,
        commandCount: 0,
        hasGoal: false,
        usedToolCount: 0,
      },
    });
  });

  it("includes failed tools in grouped summaries", () => {
    const blocks = buildToolDisplayBlocks([
      toolUse("read-1", "read", { path: "src/a.ts" }),
      toolResult("read-1", {
        content: "permission denied",
        isError: true,
      }),
    ]);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      type: "process-summary",
      summary: {
        readCount: 1,
        hasSearch: false,
        hasWebSearch: false,
        hasBrowse: false,
        commandCount: 0,
        hasGoal: false,
        usedToolCount: 0,
      },
    });
  });
});

describe("formatProcessSummaryLabel", () => {
  const t = ((key: string, options?: { count?: number }) => {
    const map: Record<string, string> = {
      "tool.grouped.readFiles_one": `${options?.count} file read`,
      "tool.grouped.readFiles_other": `${options?.count} files read`,
      "tool.grouped.searchedCode": "searched code",
      "tool.grouped.browsedWeb": "browsed the web",
      "tool.grouped.executedCommands_one": `executed ${options?.count} command`,
      "tool.grouped.executedCommands_other": `executed ${options?.count} commands`,
      "tool.grouped.usedTools_one": `used ${options?.count} tool`,
      "tool.grouped.usedTools_other": `used ${options?.count} tools`,
      "tool.grouped.joinAnd": " and ",
      "tool.grouped.joinComma": ", ",
    };
    return map[key] ?? key;
  }) as never;

  it("formats read, search, and command fragments in order", () => {
    expect(
      formatProcessSummaryLabel(
        {
          readCount: 2,
          hasSearch: true,
          hasWebSearch: false,
          hasBrowse: false,
          commandCount: 1,
          hasGoal: false,
          usedToolCount: 0,
        },
        t,
      ),
    ).toBe("2 files read, searched code and executed 1 command");
  });

  it("formats search-only process summaries", () => {
    expect(
      formatProcessSummaryLabel(
        {
          readCount: 0,
          hasSearch: true,
          hasWebSearch: false,
          hasBrowse: false,
          commandCount: 0,
          hasGoal: false,
          usedToolCount: 0,
        },
        t,
      ),
    ).toBe("searched code");
  });

  it("formats browse-only process summaries", () => {
    const blocks = buildToolDisplayBlocks([
      toolUse("wb-1", "internal_browser_navigate", {
        url: "https://example.com",
      }),
      toolResult("wb-1", { content: "ok" }),
    ]);
    expect(blocks[0]).toMatchObject({
      type: "process-summary",
      summary: {
        readCount: 0,
        hasSearch: false,
        hasWebSearch: false,
        hasBrowse: true,
        commandCount: 0,
        hasGoal: false,
        usedToolCount: 0,
      },
    });
    if (blocks[0]?.type !== "process-summary") {
      throw new Error("expected process summary");
    }
    expect(formatProcessSummaryLabel(blocks[0].summary, t)).toBe(
      "browsed the web",
    );
  });

  it("formats generic tool-only process summaries", () => {
    const blocks = buildToolDisplayBlocks([
      toolUse("mcp-1", "mcp__server__lookup", { query: "foo" }),
      toolResult("mcp-1", { content: "ok" }),
    ]);

    expect(blocks[0]).toMatchObject({
      type: "process-summary",
      summary: {
        hasGoal: false,
        usedToolCount: 1,
      },
    });
    if (blocks[0]?.type !== "process-summary") {
      throw new Error("expected process summary");
    }
    expect(formatProcessSummaryLabel(blocks[0].summary, t)).toBe("used 1 tool");
  });
});

describe("Web Access process grouping", () => {
  it("groups all new Web Access tools as web search", () => {
    const blocks = buildToolDisplayBlocks([
      toolUse("search-1", "web_search", { query: "test" }),
      toolResult("search-1"),
      toolUse("fetch-1", "fetch_content", { url: "https://example.com" }),
      toolResult("fetch-1"),
      toolUse("cache-1", "get_search_content", { responseId: "id" }),
      toolResult("cache-1"),
    ]);
    expect(blocks[0]).toMatchObject({
      type: "process-summary",
      summary: { hasWebSearch: true, usedToolCount: 0 },
    });
  });
});

describe("formatResultSummaryLabel", () => {
  const t = ((key: string, options?: { count?: number }) => {
    const map: Record<string, string> = {
      "tool.grouped.modifiedFiles_one": `modified ${options?.count} file`,
      "tool.grouped.modifiedFiles_other": `modified ${options?.count} files`,
      "tool.grouped.writtenFiles_one": `wrote ${options?.count} file`,
      "tool.grouped.writtenFiles_other": `wrote ${options?.count} files`,
      "tool.grouped.joinAnd": " and ",
      "tool.grouped.joinComma": ", ",
    };
    return map[key] ?? key;
  }) as never;

  it("formats edit and write fragments", () => {
    expect(
      formatResultSummaryLabel(
        {
          editedFiles: 2,
          writtenFiles: 1,
        },
        t,
      ),
    ).toBe("modified 2 files and wrote 1 file");
  });
});

describe("collectResultFiles", () => {
  it("merges repeated result entries by file", () => {
    expect(
      collectResultFiles(
        [
          toolUse("edit-1", "edit", { path: "src/a.ts" }),
          toolUse("edit-2", "edit", { path: "src/a.ts" }),
          toolUse("write-1", "write", { path: "src/b.ts" }),
        ],
        [],
      ),
    ).toEqual([
      { path: "src/a.ts", edits: 2, writes: 0, addedLines: 0, removedLines: 0 },
      { path: "src/b.ts", edits: 0, writes: 1, addedLines: 0, removedLines: 0 },
    ]);
  });

  it("counts write lines, trimming trailing newline", () => {
    expect(
      collectResultFiles(
        [toolUse("w-1", "write", { path: "a.ts", content: "foo\n" })],
        [],
      ),
    ).toEqual([
      { path: "a.ts", edits: 0, writes: 1, addedLines: 1, removedLines: 0 },
    ]);
  });

  it("handles CRLF in write content", () => {
    expect(
      collectResultFiles(
        [toolUse("w-1", "write", { path: "a.ts", content: "foo\r\nbar\r\n" })],
        [],
      ),
    ).toEqual([
      { path: "a.ts", edits: 0, writes: 1, addedLines: 2, removedLines: 0 },
    ]);
  });

  it("counts whitespace-only as one line", () => {
    expect(
      collectResultFiles(
        [toolUse("w-1", "write", { path: "a.ts", content: "   " })],
        [],
      ),
    ).toEqual([
      { path: "a.ts", edits: 0, writes: 1, addedLines: 1, removedLines: 0 },
    ]);
  });

  it("counts a single newline as one blank line", () => {
    expect(
      collectResultFiles(
        [toolUse("w-1", "write", { path: "a.ts", content: "\n" })],
        [],
      ),
    ).toEqual([
      { path: "a.ts", edits: 0, writes: 1, addedLines: 1, removedLines: 0 },
    ]);
  });

  it("counts content with empty trailing line correctly", () => {
    expect(
      collectResultFiles(
        [toolUse("w-1", "write", { path: "a.ts", content: "foo\n\n" })],
        [],
      ),
    ).toEqual([
      { path: "a.ts", edits: 0, writes: 1, addedLines: 2, removedLines: 0 },
    ]);
  });

  it("handles truly empty content", () => {
    expect(
      collectResultFiles(
        [toolUse("w-1", "write", { path: "a.ts", content: "" })],
        [],
      ),
    ).toEqual([
      { path: "a.ts", edits: 0, writes: 1, addedLines: 0, removedLines: 0 },
    ]);
  });

  it("parses diff lines from tool result", () => {
    expect(
      collectResultFiles(
        [toolUse("e-1", "edit", { path: "src/a.ts" })],
        [toolResult("e-1", { diff: "+added line\n-removed line\n context\n" })],
      ),
    ).toEqual([
      { path: "src/a.ts", edits: 1, writes: 0, addedLines: 1, removedLines: 1 },
    ]);
  });

  it("accumulates lines across multiple edits and writes on same file", () => {
    expect(
      collectResultFiles(
        [
          toolUse("e-1", "edit", { path: "a.ts" }),
          toolUse("e-2", "edit", { path: "a.ts" }),
          toolUse("w-1", "write", { path: "a.ts", content: "new\nfile\n" }),
        ],
        [
          toolResult("e-1", { diff: "+line1\n-line2\n" }),
          toolResult("e-2", { diff: "+line3\n" }),
        ],
      ),
    ).toEqual([
      { path: "a.ts", edits: 2, writes: 1, addedLines: 4, removedLines: 1 },
    ]);
  });
});
