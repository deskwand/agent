import { describe, expect, it } from "vitest";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  createNestedToolSessionEventHandler,
  isMetadataOnlyCodemodeUpdate,
} from "../../main/agent/nested-tool-events";
import { createNestedToolCallTracker } from "../../main/agent/nested-tool-call-tracker";
import type { NestedToolRuntimeUi } from "../../shared/nested-tool-calls";

function finalResult(toolCallId = "parent"): AgentSessionEvent {
  return {
    type: "message_end",
    message: {
      role: "toolResult",
      toolCallId,
      toolName: "codemode",
      content: [{ type: "text", text: "parent output" }],
      isError: false,
      timestamp: 1,
      nestedCalls: {
        complete: false,
        calls: [
          { id: "child", name: "write", status: "ok", argumentsBytes: 9000 },
        ],
      },
    },
  };
}

function makeSubscription() {
  const tracker = createNestedToolCallTracker();
  const published: NestedToolRuntimeUi[] = [];
  const delivered: string[] = [];
  let aborted = false;
  const handle = createNestedToolSessionEventHandler({
    tracker,
    isAborted: () => aborted,
    publish: (parentId) => {
      const runtime = tracker.get(parentId);
      if (runtime) published.push(runtime);
    },
    handleEvent: (event) => delivered.push(event.type),
  });
  return {
    tracker,
    published,
    delivered,
    handle,
    abort: () => {
      aborted = true;
    },
  };
}

describe("codemode production subscription boundary", () => {
  it("registers real starts and uses the later parent result as the final record", () => {
    const { handle, tracker, published } = makeSubscription();
    handle({
      type: "tool_execution_start",
      toolCallId: "parent",
      toolName: "codemode",
      args: { code: "source" },
    });
    handle({
      type: "tool_execution_start",
      toolCallId: "child",
      toolName: "write",
      parentToolCallId: "parent",
      args: { path: "src/a.ts", content: "large" },
    });
    tracker.finish("parent", "child", {
      content: "saved",
      isError: false,
      diff: "+1",
    });
    handle({
      type: "tool_execution_end",
      toolCallId: "parent",
      toolName: "codemode",
      result: { content: [], details: {} },
      isError: false,
    });
    expect(tracker.get("parent")?.snapshot.source).toBe("live");
    handle(finalResult());
    expect(published.at(-1)?.snapshot).toMatchObject({
      source: "final",
      complete: false,
      calls: [{ id: "child", status: "ok", argumentsBytes: 9000 }],
    });
    expect(published.at(-1)?.snapshot.calls[0].input).toBeUndefined();
    expect(published.at(-1)?.outputs.child.diff).toBe("+1");
  });

  it("accepts only a tracked outer final result after abort and blocks normal events", () => {
    const { handle, tracker, published, delivered, abort } = makeSubscription();
    tracker.startParent("parent");
    tracker.start("parent", {
      id: "child",
      name: "write",
      input: { path: "src/a.ts" },
    });
    abort();
    handle(finalResult("child")); // Child IDs resolve to the root, but cannot finalize it.
    handle(finalResult("unknown"));
    handle({
      type: "tool_execution_start",
      toolCallId: "late",
      toolName: "read",
      args: { path: "src/b.ts" },
    });
    const message: AssistantMessage = {
      role: "assistant",
      content: [{ type: "text", text: "late text" }],
      api: "openai-completions",
      provider: "openai",
      model: "test",
      timestamp: 1,
      stopReason: "stop",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    };
    handle({
      type: "message_update",
      message,
      assistantMessageEvent: {
        type: "text_delta",
        contentIndex: 0,
        delta: "late text",
        partial: message,
      },
    });
    expect(published).toHaveLength(0);
    expect(delivered).toEqual([]);
    expect(tracker.get("parent")?.snapshot.parentStatus).toBe("running");
    handle(finalResult());
    expect(published).toHaveLength(1);
    expect(tracker.get("parent")?.snapshot.source).toBe("final");
    expect(delivered).toEqual([]); // No second parent message is delivered.
  });

  it("does not treat another tool's final result as codemode metadata", () => {
    const { handle, delivered, published } = makeSubscription();
    handle(finalResult("ordinary"));
    expect(delivered).toEqual(["message_end"]);
    expect(published).toEqual([]);
  });

  it("does not register duplicate temporary snapshot IDs or clear observed state", () => {
    const { tracker, handle } = makeSubscription();
    tracker.startParent("parent");
    tracker.start("parent", {
      id: "real",
      name: "read",
      input: { path: "src/a.ts" },
    });
    const partialResult = {
      content: [],
      details: {
        calls: [
          { id: "parent/?", name: "read", status: "running" },
          { id: "parent/?", name: "read", status: "running" },
        ],
      },
    };
    handle({
      type: "tool_execution_update",
      toolCallId: "parent",
      toolName: "codemode",
      args: { code: "source" },
      partialResult,
    });
    expect(
      tracker.get("parent")?.snapshot.calls.map((call) => call.id),
    ).toEqual(["real"]);
    expect(isMetadataOnlyCodemodeUpdate("codemode", partialResult)).toBe(true);
  });
});

it("distinguishes metadata-only codemode updates from real output", () => {
  expect(
    isMetadataOnlyCodemodeUpdate("codemode", {
      content: [],
      details: { calls: [] },
    }),
  ).toBe(true);
  expect(isMetadataOnlyCodemodeUpdate("read", { content: [] })).toBe(false);
  expect(
    isMetadataOnlyCodemodeUpdate("codemode", {
      content: [{ type: "text", text: "text" }],
    }),
  ).toBe(false);
  expect(
    isMetadataOnlyCodemodeUpdate("codemode", {
      content: [],
      details: { diff: "+1" },
    }),
  ).toBe(false);
  expect(
    isMetadataOnlyCodemodeUpdate("codemode", {
      content: [{ type: "image", data: "a", mimeType: "image/png" }],
    }),
  ).toBe(false);
  expect(
    isMetadataOnlyCodemodeUpdate("codemode", {
      content: [],
      details: { openCoworkImages: [{ data: "a", mimeType: "image/png" }] },
    }),
  ).toBe(false);
});
