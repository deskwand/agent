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
  it("keeps thinking blocks when trace blocks are visible", () => {
    const blocks: ContentBlock[] = [
      { type: "thinking", thinking: "internal" },
      { type: "text", text: "Visible" },
      toolUse("read-1", "read", { path: "src/a.ts" }),
      toolResult("read-1", { content: "ok" }),
    ];

    expect(filterAssistantVisibleBlocks(blocks, false)).toEqual([
      { type: "thinking", thinking: "internal" },
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
          commandCount: 0,
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
        commandCount: 1,
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
        commandCount: 0,
        usedToolCount: 0,
      },
    });
  });

  it("keeps failed tools out of grouped summaries", () => {
    const blocks = buildToolDisplayBlocks([
      toolUse("read-1", "read", { path: "src/a.ts" }),
      toolResult("read-1", {
        content: "permission denied",
        isError: true,
      }),
    ]);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      type: "content",
      block: {
        type: "tool_use",
        id: "read-1",
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
          commandCount: 1,
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
          commandCount: 0,
          usedToolCount: 0,
        },
        t,
      ),
    ).toBe("searched code");
  });

  it("formats generic tool-only process summaries", () => {
    const blocks = buildToolDisplayBlocks([
      toolUse("mcp-1", "mcp__server__lookup", { query: "foo" }),
      toolResult("mcp-1", { content: "ok" }),
    ]);

    expect(blocks[0]).toMatchObject({
      type: "process-summary",
      summary: {
        usedToolCount: 1,
      },
    });
    if (blocks[0]?.type !== "process-summary") {
      throw new Error("expected process summary");
    }
    expect(formatProcessSummaryLabel(blocks[0].summary, t)).toBe("used 1 tool");
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
      collectResultFiles([
        toolUse("edit-1", "edit", { path: "src/a.ts" }),
        toolUse("edit-2", "edit", { path: "src/a.ts" }),
        toolUse("write-1", "write", { path: "src/b.ts" }),
      ]),
    ).toEqual([
      { path: "src/a.ts", edits: 2, writes: 0 },
      { path: "src/b.ts", edits: 0, writes: 1 },
    ]);
  });
});
