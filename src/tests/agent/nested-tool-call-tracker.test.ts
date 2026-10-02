import { describe, expect, it } from "vitest";
import { createNestedToolCallTracker } from "../../main/agent/nested-tool-call-tracker";

describe("nested tool call tracker — live observation", () => {
  it("replaces live arguments with the final record but retains output separately", () => {
    const tracker = createNestedToolCallTracker();
    tracker.startParent("p");
    const call = {
      id: "child",
      name: "write",
      input: { path: "src/a.ts", content: "large" },
    };
    tracker.start("p", call);
    tracker.start("p", call);
    tracker.finish("p", "child", {
      content: "saved",
      isError: false,
      diff: "+1",
    });
    tracker.finishParent(
      "p",
      {
        calls: [
          { id: "child", name: "write", status: "ok", argumentsBytes: 9000 },
        ],
        complete: false,
      },
      undefined,
      false,
    );
    const runtime = tracker.get("p");
    expect(runtime?.snapshot.calls).toHaveLength(1);
    expect(runtime?.snapshot.calls[0].input).toBeUndefined();
    expect(runtime?.snapshot.calls[0].argumentsBytes).toBe(9000);
    expect(runtime?.outputs.child.diff).toBe("+1");
    expect(runtime?.snapshot.source).toBe("final");
    expect(runtime?.snapshot.complete).toBe(false);
  });

  it("keeps start order when children finish in reverse order", () => {
    const tracker = createNestedToolCallTracker();
    tracker.startParent("p");
    tracker.start("p", { id: "a", name: "read", input: { path: "a.ts" } });
    tracker.start("p", { id: "b", name: "grep", input: { pattern: "x" } });
    tracker.finish("p", "b", { content: "b done", isError: false });
    tracker.finish("p", "a", { content: "a done", isError: false });
    const runtime = tracker.get("p");
    expect(runtime?.snapshot.calls.map((call) => call.id)).toEqual(["a", "b"]);
    expect(runtime?.snapshot.calls.map((call) => call.status)).toEqual([
      "ok",
      "ok",
    ]);
  });

  it("treats duplicate starts for the same id as idempotent", () => {
    const tracker = createNestedToolCallTracker();
    tracker.startParent("p");
    tracker.start("p", { id: "child", name: "read", input: { path: "a.ts" } });
    tracker.start("p", {
      id: "child",
      name: "read",
      input: { path: "changed.ts" },
    });
    const runtime = tracker.get("p");
    expect(runtime?.snapshot.calls).toHaveLength(1);
    expect(runtime?.snapshot.calls[0].input).toEqual({ path: "a.ts" });
  });

  it("does not let a second parent start reset observed children", () => {
    const tracker = createNestedToolCallTracker();
    tracker.startParent("p");
    tracker.start("p", { id: "child", name: "read", input: { path: "a.ts" } });
    tracker.startParent("p");
    expect(tracker.get("p")?.snapshot.calls).toHaveLength(1);
  });

  it("records parent and child failures independently", () => {
    const tracker = createNestedToolCallTracker();
    tracker.startParent("p1");
    tracker.start("p1", { id: "ok", name: "read", input: { path: "a.ts" } });
    tracker.finish("p1", "ok", { content: "fine", isError: false });
    tracker.finishParent("p1", undefined, undefined, true);
    expect(tracker.get("p1")?.snapshot).toMatchObject({
      parentStatus: "error",
      source: "missing",
      calls: [{ id: "ok", status: "ok" }],
    });

    tracker.startParent("p2");
    tracker.start("p2", {
      id: "bad",
      name: "bash",
      input: { command: "false" },
    });
    tracker.finish("p2", "bad", { content: "boom", isError: true });
    tracker.finishParent("p2", undefined, undefined, false);
    expect(tracker.get("p2")?.snapshot).toMatchObject({
      parentStatus: "ok",
      calls: [{ id: "bad", status: "error", error: "boom" }],
    });
  });

  it("truncates the error summary to the SDK error character limit", () => {
    const tracker = createNestedToolCallTracker();
    tracker.startParent("p");
    tracker.start("p", {
      id: "bad",
      name: "bash",
      input: { command: "false" },
    });
    tracker.finish("p", "bad", { content: "x".repeat(600), isError: true });
    expect(tracker.get("p")?.snapshot.calls[0].error).toHaveLength(500);
  });

  it("resolves an opaque child id to its tracked root", () => {
    const tracker = createNestedToolCallTracker();
    tracker.startParent("outer-1");
    tracker.start("outer-1", { id: "child/7", name: "read" });
    tracker.start("child/7", { id: "grand/2", name: "grep" });
    expect(tracker.get("child/7")?.snapshot.parentToolCallId).toBe("outer-1");
    tracker.finish("child/7", "grand/2", { content: "hit", isError: false });
    expect(
      tracker.get("outer-1")?.snapshot.calls.map((call) => call.id),
    ).toEqual(["child/7", "grand/2"]);
    expect(tracker.get("outer-1")?.snapshot.calls[1].status).toBe("ok");
  });

  it("ignores live events for calls that already have a final record", () => {
    const tracker = createNestedToolCallTracker();
    tracker.startParent("p");
    tracker.finishParent(
      "p",
      { calls: [{ id: "known", name: "read", status: "ok" }], complete: true },
      undefined,
      false,
    );
    tracker.start("p", { id: "late", name: "bash", input: { command: "ls" } });
    const runtime = tracker.get("p");
    expect(runtime?.snapshot.source).toBe("final");
    expect(runtime?.snapshot.calls).toHaveLength(1);
    expect(runtime?.snapshot.calls[0].id).toBe("known");
  });
});

describe("nested tool call tracker — final record authority", () => {
  it("replaces the live member list, arguments and status with the final record", () => {
    const tracker = createNestedToolCallTracker();
    tracker.startParent("p");
    tracker.start("p", { id: "a", name: "read", input: { path: "a.ts" } });
    tracker.start("p", {
      id: "dropped",
      name: "write",
      input: { path: "b.ts" },
    });
    tracker.finish("p", "a", { content: "read a", isError: false });
    tracker.finish("p", "dropped", { content: "wrote b", isError: false });
    tracker.finishParent(
      "p",
      {
        calls: [
          {
            id: "a",
            name: "read",
            status: "error",
            error: "denied",
            durationMs: 42,
          },
        ],
        complete: false,
      },
      undefined,
      false,
    );
    const runtime = tracker.get("p");
    expect(runtime?.snapshot.source).toBe("final");
    expect(runtime?.snapshot.complete).toBe(false);
    expect(runtime?.snapshot.calls).toEqual([
      {
        id: "a",
        name: "read",
        status: "error",
        error: "denied",
        durationMs: 42,
      },
    ]);
    // 实时输出只作详情保留，不参与终态成员/参数/统计。
    expect(Object.keys(runtime?.outputs ?? {}).sort()).toEqual([
      "a",
      "dropped",
    ]);
    expect(runtime?.outputs.dropped.content).toBe("wrote b");
  });

  it("passes through final unfinished status, error, duration and arguments", () => {
    const tracker = createNestedToolCallTracker();
    tracker.startParent("p");
    tracker.finishParent(
      "p",
      {
        calls: [
          {
            id: "u",
            name: "bash",
            status: "unfinished",
            arguments: { command: "sleep 10" },
          },
          {
            id: "e",
            name: "edit",
            status: "error",
            error: "no match",
            durationMs: 7,
            argumentsBytes: 120,
          },
        ],
        complete: true,
      },
      undefined,
      true,
    );
    expect(tracker.get("p")?.snapshot).toMatchObject({
      source: "final",
      complete: true,
      parentStatus: "error",
      calls: [
        {
          id: "u",
          name: "bash",
          status: "unfinished",
          input: { command: "sleep 10" },
        },
        {
          id: "e",
          name: "edit",
          status: "error",
          error: "no match",
          durationMs: 7,
          argumentsBytes: 120,
        },
      ],
    });
  });

  it("treats a confirmed empty final record as complete", () => {
    const tracker = createNestedToolCallTracker();
    tracker.startParent("p");
    tracker.finishParent("p", { calls: [], complete: true }, undefined, false);
    expect(tracker.get("p")?.snapshot).toMatchObject({
      source: "final",
      complete: true,
      parentStatus: "ok",
      calls: [],
    });
  });

  it("synthesizes an empty final record only when no call was observed", () => {
    const tracker = createNestedToolCallTracker();
    tracker.startParent("p");
    tracker.finishParent("p", undefined, undefined, false);
    expect(tracker.get("p")?.snapshot).toMatchObject({
      source: "final",
      complete: true,
      parentStatus: "ok",
      calls: [],
    });
  });
});

describe("nested tool call tracker — missing final metadata", () => {
  it("retains observed calls, arguments and outputs when final metadata is unavailable", () => {
    const tracker = createNestedToolCallTracker();
    tracker.startParent("p");
    tracker.start("p", {
      id: "done",
      name: "read",
      input: { path: "src/a.ts" },
    });
    tracker.start("p", {
      id: "pending",
      name: "grep",
      input: { pattern: "x" },
    });
    tracker.finish("p", "done", { content: "saved output", isError: false });
    tracker.finishParent("p", undefined, undefined, false);
    const runtime = tracker.get("p");
    expect(runtime?.snapshot).toMatchObject({
      source: "missing",
      complete: false,
      parentStatus: "ok",
      calls: [
        { id: "done", status: "ok", input: { path: "src/a.ts" } },
        { id: "pending", status: "unfinished" },
      ],
    });
    expect(runtime?.outputs.done.content).toBe("saved output");
    tracker.interrupt();
    expect(tracker.get("p")?.snapshot.parentStatus).toBe("ok");
    expect(tracker.get("p")?.snapshot.calls[0].status).toBe("ok");
  });

  it("keeps confirmed error calls and outputs when final metadata is unavailable", () => {
    const tracker = createNestedToolCallTracker();
    tracker.startParent("p");
    tracker.start("p", {
      id: "bad",
      name: "bash",
      input: { command: "false" },
    });
    tracker.start("p", { id: "slow", name: "read" });
    tracker.finish("p", "bad", { content: "boom", isError: true });
    tracker.finishParent("p", undefined, undefined, true);
    expect(tracker.get("p")?.snapshot).toMatchObject({
      source: "missing",
      parentStatus: "error",
      calls: [
        { id: "bad", status: "error", error: "boom" },
        { id: "slow", status: "unfinished" },
      ],
    });
    expect(tracker.get("p")?.outputs.bad.isError).toBe(true);
  });

  it("reports a public accessor only for tracked parents", () => {
    const tracker = createNestedToolCallTracker();
    expect(tracker.get("unknown")).toBeUndefined();
    tracker.startParent("p");
    expect(tracker.get("p")?.snapshot.parentToolCallId).toBe("p");
    expect(tracker.get("p")?.snapshot.source).toBe("live");
    expect(tracker.get("p")?.snapshot.parentStatus).toBe("running");
    expect(tracker.get("p")?.snapshot.calls).toEqual([]);
  });
});

describe("nested tool call tracker — interrupt", () => {
  it("only turns the running parent and pending children into unfinished", () => {
    const tracker = createNestedToolCallTracker();
    tracker.startParent("live");
    tracker.start("live", {
      id: "done",
      name: "read",
      input: { path: "a.ts" },
    });
    tracker.start("live", { id: "running", name: "bash" });
    tracker.finish("live", "done", { content: "ok", isError: false });

    tracker.startParent("finished");
    tracker.finishParent(
      "finished",
      { calls: [{ id: "c", name: "read", status: "ok" }], complete: true },
      undefined,
      false,
    );

    tracker.startParent("missing");
    tracker.start("missing", { id: "open", name: "grep" });
    tracker.finishParent("missing", undefined, undefined, false);

    const intents = tracker.interrupt();
    expect(
      intents.map((runtime) => runtime.snapshot.parentToolCallId).sort(),
    ).toEqual(["finished", "live", "missing"]);

    expect(tracker.get("live")?.snapshot).toMatchObject({
      parentStatus: "unfinished",
      complete: false,
      source: "live",
      calls: [
        { id: "done", status: "ok" },
        { id: "running", status: "unfinished" },
      ],
    });
    // 已确认终态的父记录不得被改成未完成。
    expect(tracker.get("finished")?.snapshot).toMatchObject({
      parentStatus: "ok",
      source: "final",
      calls: [{ id: "c", status: "ok" }],
    });
    // missing 来源已在 finishParent 收尾，interrupt 不再改写。
    expect(tracker.get("missing")?.snapshot).toMatchObject({
      parentStatus: "ok",
      source: "missing",
      calls: [{ id: "open", status: "unfinished" }],
    });
  });

  it("is idempotent and keeps outputs", () => {
    const tracker = createNestedToolCallTracker();
    tracker.startParent("p");
    tracker.start("p", { id: "c", name: "read" });
    tracker.finish("p", "c", { content: "kept", isError: false });
    tracker.interrupt();
    tracker.interrupt();
    expect(tracker.get("p")?.snapshot.parentStatus).toBe("unfinished");
    expect(tracker.get("p")?.outputs.c.content).toBe("kept");
  });

  it("keeps a late confirmed child terminal state while the parent stays unfinished", () => {
    const tracker = createNestedToolCallTracker();
    tracker.startParent("p");
    tracker.start("p", { id: "c", name: "bash" });
    tracker.interrupt();
    // 子调用自己的 end 事件仍是该子调用的确认终态；父脚本缺终态记录，保持未完成。
    tracker.finish("p", "c", { content: "late", isError: false });
    expect(tracker.get("p")?.snapshot).toMatchObject({
      parentStatus: "unfinished",
      calls: [{ id: "c", status: "ok" }],
    });
    expect(tracker.get("p")?.outputs.c.content).toBe("late");
  });
});
