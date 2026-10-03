import { describe, expect, it } from "vitest";
import { projectNestedToolBlocks } from "../../renderer/utils/nested-tool-display";
import type {
  ContentBlock,
  ToolResultContent,
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
): ToolUseContent {
  return { type: "tool_use", id, name, input };
}

function toolResult(
  toolUseId: string,
  content: string,
  extra: Partial<ToolResultContent> = {},
): ToolResultContent {
  return { type: "tool_result", toolUseId, content, ...extra };
}

function snapshot(
  parentToolCallId: string,
  calls: NestedToolCallsUi["calls"],
  extra: Partial<NestedToolCallsUi> = {},
): NestedToolCallsUi {
  return {
    parentToolCallId,
    parentStatus: "ok",
    complete: true,
    source: "final",
    calls,
    ...extra,
  };
}

function runtime(
  snap: NestedToolCallsUi,
  outputs: NestedToolRuntimeUi["outputs"] = {},
): NestedToolRuntimeUi {
  return { snapshot: snap, outputs };
}

const child = (
  id: string,
  name: string,
  input: Record<string, unknown> | undefined,
  status: NestedToolCallsUi["calls"][number]["status"] = "ok",
): NestedToolCallsUi["calls"][number] => ({
  id,
  name,
  status,
  ...(input ? { input } : {}),
});

function codemodeHead(): ContentBlock[] {
  return [
    toolUse("read-1", "read", { path: "a" }),
    toolResult("read-1", "ordinary output"),
    toolUse("parent-1", "codemode", { code: "await tools.read()" }),
  ];
}

function codemodeBlocks(): ContentBlock[] {
  return [
    ...codemodeHead(),
    toolResult("parent-1", "script done", {
      nestedCalls: snapshot("parent-1", [child("c1", "read", { path: "a" })]),
    }),
  ];
}

/**
 * 外层结果尚未写入权威 nestedCalls 的同一会话：运行时快照是唯一来源，
 * 用于验证投影对实时/缺失记录的降级行为。
 */
function liveCodemodeBlocks(): ContentBlock[] {
  return [...codemodeHead(), toolResult("parent-1", "script done")];
}

describe("projectNestedToolBlocks", () => {
  it("preserves ordinary blocks by identity and expands codemode children", () => {
    const blocks = codemodeBlocks();
    const runtimes = {
      "parent-1": runtime(snapshot("parent-1", []), {
        c1: { content: "child output", isError: false },
      }),
    };

    const out = projectNestedToolBlocks(blocks, runtimes, false);

    expect(out[0]).toBe(blocks[0]);
    expect(out[1]).toBe(blocks[1]);
    expect(out.some((b) => b.type === "tool_use" && b.id === "parent-1")).toBe(
      false,
    );
    expect(
      out.some((b) => b.type === "tool_result" && b.toolUseId === "parent-1"),
    ).toBe(false);

    const childUse = out.find(
      (b): b is ToolUseContent => b.type === "tool_use" && b.id === "c1",
    );
    expect(childUse).toBeDefined();
    expect(childUse?.name).toBe("read");
    expect(childUse?.input).toEqual({ path: "a" });
    expect(childUse?.trace).toMatchObject({
      parentToolCallId: "parent-1",
      status: "ok",
      parentStatus: "ok",
      source: "final",
      script: { id: "parent-1", input: { code: "await tools.read()" } },
    });

    const childResult = out.find(
      (b): b is ToolResultContent =>
        b.type === "tool_result" && b.toolUseId === "c1",
    );
    expect(childResult?.content).toBe("child output");
    expect(childResult?.status).toBe("ok");
    expect(childResult?.outputUnavailable).toBe(false);
  });

  it("is idempotent", () => {
    const blocks = codemodeBlocks();
    const runtimes = {
      "parent-1": runtime(snapshot("parent-1", []), {
        c1: { content: "child output", isError: false },
      }),
    };
    const once = projectNestedToolBlocks(blocks, runtimes, false);
    const twice = projectNestedToolBlocks(once, runtimes, false);
    expect(twice).toEqual(once);
    expect(twice).toHaveLength(once.length);
  });

  it("retains an empty parent as a script fallback", () => {
    const blocks = liveCodemodeBlocks();
    const runtimes = {
      "parent-1": runtime(snapshot("parent-1", [], { complete: false })),
    };

    const out = projectNestedToolBlocks(blocks, runtimes, false);

    const parent = out.find(
      (b): b is ToolUseContent => b.type === "tool_use" && b.id === "parent-1",
    );
    expect(parent).toBeDefined();
    expect(parent?.trace).toMatchObject({
      parentToolCallId: "parent-1",
      source: "final",
      complete: false,
      script: { id: "parent-1", input: { code: "await tools.read()" } },
    });
    const result = out.find(
      (b): b is ToolResultContent =>
        b.type === "tool_result" && b.toolUseId === "parent-1",
    );
    expect(result).toBe(blocks[3]);
  });

  it("keeps a parent with no record and no runtime as a missing script fallback", () => {
    const blocks: ContentBlock[] = [
      toolUse("parent-1", "codemode", { code: "x" }),
    ];
    const out = projectNestedToolBlocks(blocks, {}, false);
    const parent = out[0];
    expect(parent.type).toBe("tool_use");
    if (parent.type !== "tool_use") throw new Error("unreachable");
    expect(parent.trace).toMatchObject({
      source: "missing",
      status: "unfinished",
      parentStatus: "unfinished",
      complete: false,
    });
  });

  it("marks an active parent without a result as running", () => {
    const out = projectNestedToolBlocks(
      [toolUse("parent-1", "codemode", { code: "x" })],
      {},
      true,
    );
    const parent = out[0];
    if (parent.type !== "tool_use") throw new Error("unreachable");
    expect(parent.trace).toMatchObject({
      source: "missing",
      status: "running",
    });
  });

  it("does not refill omitted child arguments from runtime outputs", () => {
    const blocks = liveCodemodeBlocks();
    const runtimes = {
      "parent-1": runtime(
        snapshot("parent-1", [child("c1", "write", undefined)]),
        { c1: { content: "wrote file", isError: false } },
      ),
    };

    const out = projectNestedToolBlocks(blocks, runtimes, false);
    const childUse = out.find(
      (b): b is ToolUseContent => b.type === "tool_use" && b.id === "c1",
    );
    expect(childUse?.input).toEqual({});
  });

  it("does not invent output for a historical call with no runtime output", () => {
    const blocks = codemodeBlocks();
    const runtimes = {
      "parent-1": runtime(
        snapshot("parent-1", [child("c1", "read", { path: "a" })]),
        {},
      ),
    };

    const out = projectNestedToolBlocks(blocks, runtimes, false);
    const childResult = out.find(
      (b): b is ToolResultContent =>
        b.type === "tool_result" && b.toolUseId === "c1",
    );
    expect(childResult).toBeDefined();
    expect(childResult?.content).toBe("");
    expect(childResult?.outputUnavailable).toBe(true);
  });

  it("emits no result for a still-running call without output", () => {
    const blocks = liveCodemodeBlocks();
    const runtimes = {
      "parent-1": runtime(
        snapshot("parent-1", [child("c1", "read", { path: "a" }, "running")], {
          complete: false,
          source: "live",
          parentStatus: "running",
        }),
      ),
    };

    const out = projectNestedToolBlocks(blocks, runtimes, true);
    expect(
      out.some((b) => b.type === "tool_result" && b.toolUseId === "c1"),
    ).toBe(false);
    const childUse = out.find(
      (b): b is ToolUseContent => b.type === "tool_use" && b.id === "c1",
    );
    expect(childUse?.trace?.status).toBe("running");
  });

  it("prefers the final record over the live runtime snapshot", () => {
    const blocks = codemodeBlocks();
    const runtimes = {
      "parent-1": runtime(
        snapshot("parent-1", [child("stale", "read", { path: "z" })], {
          source: "live",
          parentStatus: "running",
          complete: false,
        }),
      ),
    };

    const out = projectNestedToolBlocks(blocks, runtimes, false);
    expect(out.some((b) => b.type === "tool_use" && b.id === "c1")).toBe(true);
    expect(out.some((b) => b.type === "tool_use" && b.id === "stale")).toBe(
      false,
    );
  });

  it("uses externally supplied lookup blocks for same-turn parents", () => {
    const parentUse = toolUse("parent-1", "codemode", { code: "x" });
    const parentResult = toolResult("parent-1", "done", {
      nestedCalls: snapshot("parent-1", [child("c1", "read", { path: "a" })]),
    });
    const out = projectNestedToolBlocks(
      [parentUse],
      { "parent-1": runtime(parentResult.nestedCalls as NestedToolCallsUi) },
      false,
      [parentUse, parentResult],
    );
    const childUse = out.find(
      (b): b is ToolUseContent => b.type === "tool_use" && b.id === "c1",
    );
    expect(childUse).toBeDefined();
    expect(out.some((b) => b.type === "tool_use" && b.id === "parent-1")).toBe(
      false,
    );
  });

  it("propagates cancelled child traces", () => {
    const blocks = liveCodemodeBlocks();
    const runtimes = {
      "parent-1": runtime(
        snapshot("parent-1", [
          {
            ...child("c1", "read", { path: "a" }, "unfinished"),
            cancelled: true,
          },
        ]),
        {},
      ),
    };
    const out = projectNestedToolBlocks(blocks, runtimes, false);
    const childUse = out.find(
      (b): b is ToolUseContent => b.type === "tool_use" && b.id === "c1",
    );
    expect(childUse?.trace?.cancelled).toBe(true);
  });
});

it("does not re-project a virtual child named codemode", () => {
  const blocks: ContentBlock[] = [
    toolUse("parent", "codemode", { code: "source" }),
    toolResult("parent", "done", {
      nestedCalls: snapshot("parent", [
        child("nested", "codemode", { code: "nested source" }),
      ]),
    }),
  ];
  const once = projectNestedToolBlocks(blocks, {}, false);
  expect(projectNestedToolBlocks(once, {}, false)).toEqual(once);
});
