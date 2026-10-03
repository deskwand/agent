import { describe, expect, it } from "vitest";
import {
  buildProcessSummaryDisplayBlock,
  buildToolDisplayBlocks,
  collectResultFiles,
  isProcessToolUse,
} from "../../renderer/utils/tool-display-blocks";
import { projectNestedToolBlocks } from "../../renderer/utils/nested-tool-display";
import type {
  ContentBlock,
  ToolResultContent,
  ToolTraceUi,
  ToolUseContent,
} from "../../renderer/types";
import type {
  NestedToolCallsUi,
  NestedToolRuntimeUi,
} from "../../shared/nested-tool-calls";

function toolUse(
  id: string,
  name: string,
  input: Record<string, unknown> = {},
  trace?: ToolTraceUi,
): ToolUseContent {
  return { type: "tool_use", id, name, input, ...(trace ? { trace } : {}) };
}

function toolResult(
  toolUseId: string,
  options: {
    content?: string;
    isError?: boolean;
    diff?: string;
    status?: ToolResultContent["status"];
    outputUnavailable?: boolean;
    nestedCalls?: NestedToolCallsUi;
  } = {},
): ToolResultContent {
  return {
    type: "tool_result",
    toolUseId,
    content: options.content ?? "ok",
    isError: options.isError,
    diff: options.diff,
    status: options.status,
    outputUnavailable: options.outputUnavailable,
    nestedCalls: options.nestedCalls,
  };
}

function trace(overrides: Partial<ToolTraceUi> = {}): ToolTraceUi {
  return {
    parentToolCallId: "code-1",
    status: "ok",
    parentStatus: "ok",
    complete: true,
    source: "final",
    ...overrides,
  };
}

function processSummary(blocks: ContentBlock[]) {
  const first = buildToolDisplayBlocks(blocks)[0];
  if (first?.type !== "process-summary") {
    throw new Error("expected process summary");
  }
  return first;
}

describe("statusOf-based counting", () => {
  it("counts only successful reads and never counts the wrapper", () => {
    const blocks: ContentBlock[] = [
      toolUse("a", "read", { path: "src/a.ts" }),
      toolResult("a", { content: "ok" }),
      toolUse("b", "read", { path: "src/b.ts" }),
      toolResult("b", { content: "missing", isError: true }),
      toolUse("c", "read", { path: "src/c.ts" }),
    ];
    expect(buildToolDisplayBlocks(blocks)[0]).toMatchObject({
      type: "process-summary",
      summary: { readCount: 1, calledRead: true, scriptCount: 0 },
    });
  });

  it("counts search only when its result is confirmed successful", () => {
    const ok = processSummary([
      toolUse("g1", "grep", { pattern: "foo" }),
      toolResult("g1"),
    ]);
    expect(ok.summary).toMatchObject({ hasSearch: true, calledSearch: true });

    const failed = processSummary([
      toolUse("g2", "grep", { pattern: "foo" }),
      toolResult("g2", { isError: true }),
    ]);
    expect(failed.summary).toMatchObject({
      hasSearch: false,
      calledSearch: true,
    });
  });

  it("does not count a read that has no result yet", () => {
    const summary = processSummary([toolUse("r1", "read", { path: "a.ts" })]);
    expect(summary.summary).toMatchObject({ readCount: 0, calledRead: true });
  });

  it("attaches failed status for an ordinary failed tool call", () => {
    const summary = processSummary([
      toolUse("r1", "read", { path: "a.ts" }),
      toolResult("r1", { isError: true }),
    ]);
    expect(summary.status).toMatchObject({
      failed: true,
      firstFailedToolCallId: "r1",
    });
  });
});

describe("virtual nested calls in process/result groups", () => {
  it("deduplicates read paths across nested children", () => {
    const blocks: ContentBlock[] = [
      toolUse("c1", "read", { path: "src/a.ts" }, trace()),
      toolResult("c1"),
      toolUse("c2", "read", { file_path: "src/a.ts" }, trace()),
      toolResult("c2"),
    ];
    expect(processSummary(blocks).summary.readCount).toBe(1);
  });

  it("falls back to file_path-style arguments for nested reads", () => {
    const blocks: ContentBlock[] = [
      toolUse("c1", "read", { file_path: "src/nested.ts" }, trace()),
      toolResult("c1"),
    ];
    expect(processSummary(blocks).summary.readCount).toBe(1);
  });

  it("keeps a child failure visible while the parent stays successful", () => {
    const blocks: ContentBlock[] = [
      toolUse("c1", "read", { path: "src/a.ts" }, trace()),
      toolResult("c1"),
      toolUse("c2", "read", { path: "src/b.ts" }, trace({ status: "error" })),
      toolResult("c2", { isError: true }),
    ];
    const block = processSummary(blocks);
    expect(block.summary.readCount).toBe(1);
    expect(block.status).toMatchObject({
      failed: true,
      firstFailedToolCallId: "c2",
    });
    expect(block.status?.running).toBe(false);
  });

  it("reports parent failure even when every child succeeded", () => {
    const parentTrace = { parentStatus: "error" as const };
    const blocks: ContentBlock[] = [
      toolUse("c1", "read", { path: "src/a.ts" }, trace(parentTrace)),
      toolResult("c1"),
      toolUse("c2", "read", { path: "src/b.ts" }, trace(parentTrace)),
      toolResult("c2"),
    ];
    const block = processSummary(blocks);
    expect(block.summary.readCount).toBe(2);
    expect(block.status).toMatchObject({
      failed: true,
      firstFailedToolCallId: "code-1",
    });
  });

  it("counts an unknown tool name as a generic process tool, nested or ordinary", () => {
    const nested = toolUse("c1", "mystery_step", {}, trace());
    const ordinary = toolUse("u1", "mystery_step", {});
    // 未登记的名字一律归组：虚拟嵌套块与普通块没有区别（AGENTS.md §4）。
    expect(isProcessToolUse(nested)).toBe(true);
    expect(isProcessToolUse(ordinary)).toBe(true);

    const blocks = buildToolDisplayBlocks([nested, toolResult("c1"), ordinary]);
    expect(blocks.map((block) => block.type)).toEqual(["process-summary"]);
    expect(blocks[0]).toMatchObject({
      type: "process-summary",
      summary: { usedToolCount: 2, scriptCount: 0 },
    });
  });

  it("counts the turn-level mixed group once without a parent script count", () => {
    const parent = toolUse("code-1", "codemode", { script: "x" });
    const nestedCalls: NestedToolCallsUi = {
      parentToolCallId: "code-1",
      parentStatus: "ok",
      complete: true,
      source: "final",
      calls: [
        { id: "c1", name: "read", input: { path: "src/a.ts" }, status: "ok" },
        { id: "c2", name: "mystery_step", input: {}, status: "ok" },
      ],
    };
    const projected = projectNestedToolBlocks(
      [parent, toolResult("code-1", { content: "{}", nestedCalls })],
      {},
      false,
    );
    const items = projected.filter(
      (block): block is ToolUseContent => block.type === "tool_use",
    );
    const block = buildProcessSummaryDisplayBlock(items, projected);

    expect(items.map((item) => item.id)).toEqual(["c1", "c2"]);
    expect(block.summary).toMatchObject({
      readCount: 1,
      scriptCount: 0,
      usedToolCount: 1,
    });
    expect(block.scripts).toEqual([{ id: "code-1", input: { script: "x" } }]);
  });

  it("keeps the wrapper as scriptCount when there are no usable children", () => {
    const wrapper = toolUse("code-1", "codemode", { script: "return 1" });
    const snapshot: NestedToolCallsUi = {
      parentToolCallId: "code-1",
      parentStatus: "ok",
      calls: [],
      complete: true,
      source: "final",
    };
    const projected = projectNestedToolBlocks(
      [wrapper, toolResult("code-1", { content: "{}", nestedCalls: snapshot })],
      {},
      false,
    );
    const block = processSummary(projected);
    expect(block.summary).toMatchObject({
      scriptCount: 1,
      usedToolCount: 0,
      readCount: 0,
    });
    expect(block.scripts).toEqual([
      { id: "code-1", input: { script: "return 1" } },
    ]);
    expect(block.status).toMatchObject({
      failed: false,
      running: false,
      unavailable: false,
    });
  });

  it("projects mixed read/edit/unknown children exactly once without a parent script count", () => {
    const parent = toolUse("code-1", "codemode", { script: "x" });
    const nestedCalls: NestedToolCallsUi = {
      parentToolCallId: "code-1",
      parentStatus: "ok",
      complete: true,
      source: "final",
      calls: [
        { id: "c1", name: "read", input: { path: "src/a.ts" }, status: "ok" },
        { id: "c2", name: "edit", input: { path: "src/a.ts" }, status: "ok" },
        { id: "c3", name: "mystery_step", input: {}, status: "ok" },
      ],
    };
    const runtime: Record<string, NestedToolRuntimeUi> = {
      "code-1": {
        snapshot: nestedCalls,
        outputs: { c2: { content: "ok", isError: false, diff: "+added\n" } },
      },
    };
    const projected = projectNestedToolBlocks(
      [parent, toolResult("code-1", { content: "{}", nestedCalls })],
      runtime,
      false,
    );
    const blocks = buildToolDisplayBlocks(projected);

    expect(blocks.map((block) => block.type)).toEqual([
      "process-summary",
      "result-summary",
      "process-summary",
    ]);
    const [readGroup, editGroup] = blocks;
    expect(readGroup).toMatchObject({
      type: "process-summary",
      summary: { readCount: 1, scriptCount: 0, usedToolCount: 0 },
      scripts: [{ id: "code-1" }],
    });
    expect(editGroup).toMatchObject({
      type: "result-summary",
      summary: { editedFiles: 1, calledEdit: true },
      files: [{ path: "src/a.ts", edits: 1, addedLines: 1 }],
    });
    expect(blocks[2]).toMatchObject({
      type: "process-summary",
      summary: { usedToolCount: 1 },
    });

    const ids = blocks.flatMap((block) =>
      block.type === "process-summary" || block.type === "result-summary"
        ? block.items.map((item) => item.id)
        : block.type === "content" && block.block.type === "tool_use"
          ? [block.block.id]
          : [],
    );
    expect(ids).toEqual(["c1", "c2", "c3"]);
    expect(ids).not.toContain("code-1");
  });
});

describe("nested group states", () => {
  it("marks a running child and excludes its path from read counts", () => {
    const block = buildProcessSummaryDisplayBlock([
      toolUse("c1", "read", { path: "src/a.ts" }, trace({ status: "running" })),
    ]);
    expect(block.summary).toMatchObject({ readCount: 0, calledRead: true });
    expect(block.status).toMatchObject({ running: true, failed: false });
  });

  it("marks missing history as unavailable without calling it incomplete", () => {
    const item = toolUse(
      "c1",
      "read",
      { path: "src/a.ts" },
      trace({
        source: "missing",
        status: "unfinished",
        parentStatus: "unfinished",
        complete: false,
      }),
    );
    const block = buildProcessSummaryDisplayBlock([item], [item]);
    expect(block.summary.readCount).toBe(0);
    expect(block.status).toMatchObject({
      incomplete: false,
      unavailable: true,
      unfinished: true,
    });
  });

  it("marks a live unfinished parent as unavailable", () => {
    const item = toolUse(
      "c1",
      "read",
      { path: "src/a.ts" },
      trace({
        source: "live",
        status: "ok",
        parentStatus: "unfinished",
        complete: false,
      }),
    );
    const block = buildProcessSummaryDisplayBlock([item], [item]);
    expect(block.status).toMatchObject({
      incomplete: true,
      unavailable: true,
      unfinished: true,
    });
  });

  it("keeps legacy snapshots marked incomplete", () => {
    const item = toolUse(
      "c1",
      "read",
      {},
      trace({ source: "legacy", complete: false }),
    );
    const block = buildProcessSummaryDisplayBlock([item], [item]);
    expect(block.summary.readCount).toBe(0);
    expect(block.status).toMatchObject({
      incomplete: true,
      unavailable: false,
    });
  });

  it("omits status and scripts for stateless legacy groups", () => {
    const block = buildProcessSummaryDisplayBlock([
      toolUse("r1", "read", { path: "a.ts" }),
    ]);
    expect(block.status).toBeUndefined();
    expect(block.scripts).toBeUndefined();
  });
});

describe("result semantics for nested edits and writes", () => {
  it("sets calledWrite even when no arguments are available", () => {
    const blocks = buildToolDisplayBlocks([
      toolUse("w1", "write", {}),
      toolResult("w1"),
    ]);
    expect(blocks[0]).toMatchObject({
      type: "result-summary",
      summary: { writtenFiles: 0, calledWrite: true },
    });
  });

  it("sets calledEdit even when no path is available", () => {
    const blocks = buildToolDisplayBlocks([
      toolUse("e1", "edit", {}),
      toolResult("e1"),
    ]);
    expect(blocks[0]).toMatchObject({
      type: "result-summary",
      summary: { editedFiles: 0, calledEdit: true },
    });
  });

  it("skips missing-source children when aggregating artifact files", () => {
    const item = toolUse(
      "c1",
      "write",
      { path: "src/a.ts", content: "a\nb\n" },
      trace({ source: "missing", status: "unfinished" }),
    );
    expect(collectResultFiles([item], [])).toEqual([]);
  });

  it("does not infer write lines when the nested output is unavailable", () => {
    const item = toolUse("c1", "write", {
      path: "src/a.ts",
      content: "a\nb\n",
    });
    expect(
      collectResultFiles(
        [item],
        [toolResult("c1", { outputUnavailable: true })],
      ),
    ).toEqual([
      { path: "src/a.ts", edits: 0, writes: 1, addedLines: 0, removedLines: 0 },
    ]);
    expect(
      collectResultFiles(
        [item],
        [toolResult("c1", { outputUnavailable: false })],
      ),
    ).toEqual([
      { path: "src/a.ts", edits: 0, writes: 1, addedLines: 2, removedLines: 0 },
    ]);
  });

  it("does not report unknown historical diffs as zero-line edits", () => {
    const blocks = buildToolDisplayBlocks([
      toolUse(
        "c1",
        "edit",
        { path: "src/a.ts" },
        trace({ status: "ok", source: "final" }),
      ),
      toolResult("c1", { outputUnavailable: true }),
    ]);
    expect(blocks[0]).toMatchObject({
      type: "result-summary",
      files: [{ path: "src/a.ts", edits: 1, addedLines: 0, removedLines: 0 }],
    });
  });

  it("still counts a real diff on a nested edit", () => {
    const blocks = buildToolDisplayBlocks([
      toolUse("c1", "edit", { path: "src/a.ts" }, trace()),
      toolResult("c1", { diff: "+a\n-b\n", outputUnavailable: false }),
    ]);
    expect(blocks[0]).toMatchObject({
      type: "result-summary",
      files: [{ path: "src/a.ts", edits: 1, addedLines: 1, removedLines: 1 }],
    });
  });
});

describe("group boundaries", () => {
  it("lets body text interrupt a nested process group", () => {
    const blocks = buildToolDisplayBlocks([
      toolUse("c1", "read", { path: "src/a.ts" }, trace()),
      toolResult("c1"),
      { type: "text", text: "interruption" },
      toolUse("c2", "read", { path: "src/b.ts" }, trace()),
      toolResult("c2"),
    ]);
    expect(blocks.map((block) => block.type)).toEqual([
      "process-summary",
      "content",
      "process-summary",
    ]);
    expect(blocks[0]).toMatchObject({ summary: { readCount: 1 } });
    expect(blocks[2]).toMatchObject({ summary: { readCount: 1 } });
  });
});

it("counts diff content beginning with triple signs consistently with result summaries", () => {
  const item = toolUse("c", "edit", { path: "a" }, trace());
  const result = toolResult("c");
  result.diff = "+++ a\n--- a\n+++x\n---x";
  expect(collectResultFiles([item], [result])[0]).toMatchObject({
    addedLines: 1,
    removedLines: 1,
  });
});
