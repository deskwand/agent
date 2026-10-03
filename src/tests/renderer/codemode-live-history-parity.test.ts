import { describe, expect, it } from "vitest";
import { normalizeNestedToolCalls } from "../../shared/nested-tool-calls";
import type {
  NestedToolCallsUi,
  NestedToolOutput,
  NestedToolRuntimeUi,
  NestedToolStatus,
} from "../../shared/nested-tool-calls";
import { createNestedToolCallTracker } from "../../main/agent/nested-tool-call-tracker";
import type { NestedToolCallStart } from "../../main/agent/nested-tool-call-tracker";
import {
  projectNestedToolBlocks,
  projectNestedToolMessages,
} from "../../renderer/utils/nested-tool-display";
import { buildToolDisplayBlocks } from "../../renderer/utils/tool-display-blocks";
import type {
  ContentBlock,
  Message,
  ToolResultContent,
  ToolUseContent,
} from "../../renderer/types";

const PARENT_ID = "p";
const SCRIPT = "await tools.read({ path: 'a.txt' })";
const MISSING_ERROR =
  "ENOENT: no such file or directory, access '/tmp/codemode/missing.txt'";

/**
 * SDK 管线抓取的记录形状（.superpowers/sdd/.../sdk-pipeline-*.json，已
 * gitignore）：`nestedCalls` 是权威终态，`details.calls` 是旧预览快照，
 * `messages` 是 toolCall/toolResult 序列。这里内联转写，避免测试依赖
 * 未提交的抓取文件，也不引入 agent-runner / store 等重量级生产依赖。
 */
interface SdkNestedCall {
  id: string;
  name?: string;
  status?: string;
  arguments?: Record<string, unknown>;
  argumentsBytes?: number;
  durationMs?: number;
  error?: string;
}

interface SdkNestedRecord {
  calls: SdkNestedCall[];
  complete: boolean;
}

interface Projection {
  blocks: ContentBlock[];
  groups: ReturnType<typeof buildToolDisplayBlocks>;
  runtime: NestedToolRuntimeUi | undefined;
}

function codemode(
  input: Record<string, unknown> = { code: SCRIPT },
): ToolUseContent {
  return { type: "tool_use", id: PARENT_ID, name: "codemode", input };
}

function runLive(
  starts: NestedToolCallStart[],
  outputs: Record<string, NestedToolOutput>,
  finish: { raw: unknown; legacy?: unknown; isError?: boolean },
  lead: ContentBlock[] = [],
): Projection {
  const tracker = createNestedToolCallTracker();
  tracker.startParent(PARENT_ID);
  for (const call of starts) tracker.start(PARENT_ID, call);
  for (const [id, output] of Object.entries(outputs)) {
    tracker.finish(PARENT_ID, id, output);
  }
  tracker.finishParent(
    PARENT_ID,
    finish.raw,
    finish.legacy,
    finish.isError ?? false,
  );
  const runtime = tracker.get(PARENT_ID);
  const blocks = projectNestedToolBlocks(
    [...lead, codemode()],
    runtime ? { [PARENT_ID]: runtime } : {},
    false,
  );
  return { blocks, groups: buildToolDisplayBlocks(blocks), runtime };
}

function renderHistory(
  raw: unknown,
  legacy: unknown,
  parentStatus: NestedToolStatus,
  lead: ContentBlock[] = [],
): Projection {
  const result: ToolResultContent = {
    type: "tool_result",
    toolUseId: PARENT_ID,
    content: "Script completed",
    isError: parentStatus === "error",
    nestedCalls: normalizeNestedToolCalls(PARENT_ID, raw, legacy, parentStatus),
  };
  const blocks = projectNestedToolBlocks(
    [...lead, codemode(), result],
    {},
    false,
  );
  return { blocks, groups: buildToolDisplayBlocks(blocks), runtime: undefined };
}

/** 两条链路必须先满足的稳定字段：ID、状态、参数、来源、脚本引用。 */
function traceUses(blocks: ContentBlock[]) {
  return blocks.flatMap((block) =>
    block.type === "tool_use"
      ? [
          {
            id: block.id,
            name: block.name,
            input: block.input,
            status: block.trace?.status,
            parentStatus: block.trace?.parentStatus,
            source: block.trace?.source,
            complete: block.trace?.complete,
            argumentsBytes: block.trace?.argumentsBytes,
            cancelled: block.trace?.cancelled,
            script: block.trace?.script,
          },
        ]
      : [],
  );
}

function groupSummaries(groups: ReturnType<typeof buildToolDisplayBlocks>) {
  return groups.flatMap((group) =>
    group.type === "content"
      ? []
      : [
          {
            type: group.type,
            summary: group.summary,
            status: group.status,
            scripts: group.scripts,
            ...(group.type === "result-summary"
              ? {
                  files: group.files.map(({ path, edits, writes }) => ({
                    path,
                    edits,
                    writes,
                  })),
                }
              : {}),
          },
        ],
  );
}

// 只取虚拟投影子调用的结果：普通工具结果没有投影 status，不属于本对比。
function childResults(blocks: ContentBlock[]): ToolResultContent[] {
  return blocks.flatMap((block) =>
    block.type === "tool_result" &&
    block.toolUseId !== PARENT_ID &&
    block.status !== undefined
      ? [block]
      : [],
  );
}

/**
 * 断言实时终态与原始历史记录投影出同一摘要。唯一允许的差异是运行时
 * 仍持有子调用正文：历史只有 outputUnavailable 标记。
 */
function expectParity(live: Projection, history: Projection) {
  expect(traceUses(live.blocks)).toEqual(traceUses(history.blocks));
  expect(groupSummaries(live.groups)).toEqual(groupSummaries(history.groups));
  const liveResults = childResults(live.blocks);
  const historyResults = childResults(history.blocks);
  expect(
    liveResults.map(({ toolUseId, status, isError }) => ({
      toolUseId,
      status,
      isError,
    })),
  ).toEqual(
    historyResults.map(({ toolUseId, status, isError }) => ({
      toolUseId,
      status,
      isError,
    })),
  );
  expect(
    historyResults.every((result) => result.outputUnavailable === true),
  ).toBe(true);
  for (const result of liveResults) {
    const output = live.runtime?.outputs[result.toolUseId];
    if (output) {
      expect(result.outputUnavailable).toBe(false);
      expect(result.content).toBe(output.content);
    }
  }
  const liveProcess = live.groups.find(
    (group) => group.type === "process-summary",
  );
  const historyProcess = history.groups.find(
    (group) => group.type === "process-summary",
  );
  expect(liveProcess?.summary).toEqual(historyProcess?.summary);
  expect(liveProcess?.status?.firstFailedToolCallId).toBe(
    historyProcess?.status?.firstFailedToolCallId,
  );
  return { liveResults, historyResults };
}

/** sdk-pipeline-mixed.json：两条 read 同路径 + 一条成功 bash + 一条失败 read。 */
const MIXED_RECORD: SdkNestedRecord = {
  complete: true,
  calls: [
    {
      id: "p/1",
      name: "read",
      status: "ok",
      arguments: { path: "a.txt" },
      durationMs: 1,
    },
    {
      id: "p/2",
      name: "read",
      status: "ok",
      arguments: { path: "a.txt" },
      durationMs: 0,
    },
    {
      id: "p/3",
      name: "bash",
      status: "ok",
      arguments: { command: "grep hello a.txt" },
      durationMs: 6,
    },
    {
      id: "p/4",
      name: "read",
      status: "error",
      arguments: { path: "missing.txt" },
      durationMs: 5,
      error: MISSING_ERROR,
    },
  ],
};

const MIXED_LEGACY = [
  { id: "p/1", name: "read", args: '{"path":"a.txt"}', status: "ok" },
  { id: "p/2", name: "read", args: '{"path":"a.txt"}', status: "ok" },
  {
    id: "p/3",
    name: "bash",
    args: '{"command":"grep hello a.txt"}',
    status: "ok",
  },
  { id: "p/4", name: "read", args: '{"path":"missing.txt"}', status: "error" },
];

const MIXED_STARTS: NestedToolCallStart[] = [
  { id: "p/1", name: "read", input: { path: "a.txt" } },
  { id: "p/2", name: "read", input: { path: "a.txt" } },
  { id: "p/3", name: "bash", input: { command: "grep hello a.txt" } },
  { id: "p/4", name: "read", input: { path: "missing.txt" } },
];

const MIXED_OUTPUTS: Record<string, NestedToolOutput> = {
  "p/1": { content: "hello\nworld\n", isError: false },
  "p/2": { content: "hello\nworld\n", isError: false },
  "p/3": { content: "hello", isError: false },
  "p/4": { content: MISSING_ERROR, isError: true },
};

describe("codemode live and history parity", () => {
  it("matches the completed record for repeated paths and a failed read", () => {
    const live = runLive(MIXED_STARTS, MIXED_OUTPUTS, { raw: MIXED_RECORD });
    const history = renderHistory(MIXED_RECORD, MIXED_LEGACY, "ok");
    const { liveResults } = expectParity(live, history);

    expect(liveResults.map((result) => result.toolUseId)).toEqual([
      "p/1",
      "p/2",
      "p/3",
      "p/4",
    ]);
    expect(traceUses(live.blocks).map((use) => use.status)).toEqual([
      "ok",
      "ok",
      "ok",
      "error",
    ]);
    const group = live.groups.find((item) => item.type === "process-summary");
    expect(group?.summary).toMatchObject({
      readCount: 1,
      calledRead: true,
      commandCount: 1,
      scriptCount: 0,
    });
    expect(group?.status).toMatchObject({
      failed: true,
      unfinished: false,
      firstFailedToolCallId: "p/4",
    });
    // 运行时有正文，历史从权威记录里取同一段失败原文。
    expect(liveResults[3]?.content).toBe(MISSING_ERROR);
    expect(
      history.blocks.find(
        (block) => block.type === "tool_result" && block.toolUseId === "p/4",
      ),
    ).toMatchObject({ content: MISSING_ERROR, outputUnavailable: true });
  });

  it("aggregates an ordinary successful read with a nested read under one group", () => {
    const lead: ContentBlock[] = [
      {
        type: "tool_use",
        id: "ordinary-read",
        name: "read",
        input: { path: "a.txt" },
      },
      {
        type: "tool_result",
        toolUseId: "ordinary-read",
        content: "hello",
        isError: false,
      },
    ];
    const record: SdkNestedRecord = {
      complete: true,
      calls: [
        { id: "p/1", name: "read", status: "ok", arguments: { path: "a.txt" } },
        { id: "p/2", name: "bash", status: "ok", arguments: { command: "ls" } },
      ],
    };
    const live = runLive(
      [
        { id: "p/1", name: "read", input: { path: "a.txt" } },
        { id: "p/2", name: "bash", input: { command: "ls" } },
      ],
      {
        "p/1": { content: "hello", isError: false },
        "p/2": { content: "a.txt", isError: false },
      },
      { raw: record },
      lead,
    );
    const history = renderHistory(record, undefined, "ok", lead);
    expectParity(live, history);

    expect(live.groups).toHaveLength(1);
    expect(live.groups[0]).toMatchObject({
      type: "process-summary",
      summary: { readCount: 1, calledRead: true, commandCount: 1 },
    });
    expect(
      live.groups.map((item) =>
        item.type === "process-summary" ? item.scripts?.length : undefined,
      ),
    ).toEqual([1]);
  });

  it("never restores a live path omitted by the authoritative record", () => {
    const record: SdkNestedRecord = {
      complete: true,
      calls: [{ id: "c1", name: "read", status: "ok", argumentsBytes: 4200 }],
    };
    const live = runLive(
      [{ id: "c1", name: "read", input: { path: "secret.ts" } }],
      { c1: { content: "classified", isError: false } },
      { raw: record },
    );
    const history = renderHistory(record, undefined, "ok");
    expectParity(live, history);

    const [use] = traceUses(live.blocks);
    expect(use).toMatchObject({
      id: "c1",
      source: "final",
      argumentsBytes: 4200,
      input: {},
    });
    expect(JSON.stringify(traceUses(live.blocks))).not.toContain("secret.ts");
    expect(live.runtime?.snapshot.calls[0]?.input).toBeUndefined();
    const group = live.groups.find((item) => item.type === "process-summary");
    expect(group?.summary).toMatchObject({ readCount: 0, calledRead: true });
    expect(groupSummaries(history.groups)).toEqual(groupSummaries(live.groups));
  });

  const recordCases: Array<{
    name: string;
    raw: unknown;
    legacy: unknown;
    source: NestedToolCallsUi["source"];
    complete: boolean;
    unavailable: boolean;
    incomplete: boolean;
    scriptCount: number;
    childIds: string[];
  }> = [
    {
      name: "explicit empty final record",
      raw: { complete: true, calls: [] },
      legacy: undefined,
      source: "final",
      complete: true,
      unavailable: false,
      incomplete: false,
      scriptCount: 1,
      childIds: [],
    },
    {
      name: "legacy preview without a final record",
      raw: undefined,
      legacy: [{ name: "read", args: '{"path":"a.ts"}', status: "ok" }],
      source: "legacy",
      complete: false,
      unavailable: false,
      incomplete: true,
      scriptCount: 0,
      childIds: ["p:legacy:0"],
    },
    {
      name: "missing record",
      raw: undefined,
      legacy: undefined,
      source: "missing",
      complete: false,
      unavailable: true,
      incomplete: false,
      scriptCount: 1,
      childIds: [],
    },
    {
      name: "truncated rows mark the record incomplete",
      raw: {
        complete: true,
        calls: [
          { id: "c1", name: "read", status: "ok", arguments: { path: "a.ts" } },
          { id: "c2" },
        ],
      },
      legacy: undefined,
      source: "final",
      complete: false,
      unavailable: false,
      incomplete: true,
      scriptCount: 0,
      childIds: ["c1"],
    },
  ];

  it.each(recordCases)(
    "matches both projections for $name",
    ({
      raw,
      legacy,
      source,
      complete,
      unavailable,
      incomplete,
      scriptCount,
      childIds,
    }) => {
      const live = runLive([], {}, { raw, legacy });
      const history = renderHistory(raw, legacy, "ok");
      expectParity(live, history);

      expect(live.runtime?.snapshot).toMatchObject({ source, complete });
      expect(traceUses(live.blocks).map((use) => use.id)).toEqual(
        childIds.length > 0 ? childIds : [PARENT_ID],
      );
      const group = live.groups.find((item) => item.type === "process-summary");
      expect(group?.summary.scriptCount).toBe(scriptCount);
      expect(group?.status?.unavailable).toBe(unavailable);
      expect(group?.status?.incomplete).toBe(incomplete);
    },
  );

  it("does not revive a completed parent through late or duplicate terminal events", () => {
    const tracker = createNestedToolCallTracker();
    tracker.startParent(PARENT_ID);
    tracker.start(PARENT_ID, {
      id: "c1",
      name: "read",
      input: { path: "a.ts" },
    });
    tracker.finish(PARENT_ID, "c1", { content: "output", isError: false });
    tracker.finishParent(
      PARENT_ID,
      {
        complete: true,
        calls: [
          { id: "c1", name: "read", status: "ok", arguments: { path: "a.ts" } },
        ],
      },
      undefined,
      false,
    );
    const completed = JSON.parse(
      JSON.stringify(tracker.get(PARENT_ID)?.snapshot),
    ) as NestedToolCallsUi;

    // 迟到的 start / finish 与重复的终态都不能改写已完成的成员与状态。
    tracker.start(PARENT_ID, {
      id: "late",
      name: "write",
      input: { path: "late.ts" },
    });
    tracker.finish(PARENT_ID, "c1", { content: "failed", isError: true });
    tracker.finishParent(
      PARENT_ID,
      { complete: true, calls: [] },
      undefined,
      true,
    );
    expect(tracker.get(PARENT_ID)?.snapshot).toEqual(completed);
    expect(completed).toMatchObject({
      source: "final",
      complete: true,
      parentStatus: "ok",
      calls: [{ id: "c1", status: "ok" }],
    });

    // abort 后已跟踪的父结果 message_end 仍能落地终态元数据。
    const aborted = createNestedToolCallTracker();
    aborted.startParent("q");
    aborted.start("q", {
      id: "q/1",
      name: "bash",
      input: { command: "sleep 20" },
    });
    aborted.interrupt();
    expect(aborted.get("q")?.snapshot).toMatchObject({
      source: "live",
      parentStatus: "unfinished",
      calls: [{ id: "q/1", status: "unfinished" }],
    });
    aborted.finishParent(
      "q",
      {
        complete: false,
        calls: [
          {
            id: "q/1",
            name: "bash",
            status: "unfinished",
            arguments: { command: "sleep 20" },
          },
        ],
      },
      undefined,
      true,
    );
    expect(aborted.get("q")?.snapshot).toMatchObject({
      source: "final",
      parentStatus: "error",
      complete: false,
    });
    expect(aborted.get("q")?.snapshot.calls[0]?.status).toBe("unfinished");
  });
});

describe("codemode SDK pipeline message parity", () => {
  function assistantMessage(
    id: string,
    content: ContentBlock[],
    turnId = "turn-1",
  ): Message {
    return {
      id,
      sessionId: "s",
      role: "assistant",
      turnId,
      timestamp: 1,
      content,
    };
  }

  interface Pipeline {
    raw: unknown;
    legacy: unknown;
    isError: boolean;
    starts: NestedToolCallStart[];
    outputs: Record<string, NestedToolOutput>;
  }

  const pipelines: Record<string, Pipeline> = {
    // sdk-pipeline-mixed.json
    mixed: {
      raw: MIXED_RECORD,
      legacy: MIXED_LEGACY,
      isError: false,
      starts: MIXED_STARTS,
      outputs: MIXED_OUTPUTS,
    },
    // sdk-pipeline-cancelled.json
    cancelled: {
      raw: {
        complete: false,
        calls: [
          {
            id: "p/1",
            name: "read",
            status: "ok",
            arguments: { path: "a.txt" },
          },
          {
            id: "p/2",
            name: "bash",
            status: "unfinished",
            arguments: { command: "sleep 20" },
          },
        ],
      },
      legacy: [
        { id: "p/1", name: "read", args: '{"path":"a.txt"}', status: "ok" },
        {
          id: "p/2",
          name: "bash",
          args: '{"command":"sleep 20"}',
          status: "unfinished",
        },
      ],
      isError: true,
      starts: [
        { id: "p/1", name: "read", input: { path: "a.txt" } },
        { id: "p/2", name: "bash", input: { command: "sleep 20" } },
      ],
      outputs: { "p/1": { content: "hello", isError: false } },
    },
    // sdk-pipeline-empty.json：没有 nestedCalls，只有空的 details.calls
    empty: {
      raw: undefined,
      legacy: [],
      isError: false,
      starts: [],
      outputs: {},
    },
    // sdk-pipeline-large.json：write 正文被裁成 argumentsBytes
    large: {
      raw: {
        complete: false,
        calls: [
          { id: "p/1", name: "write", status: "ok", argumentsBytes: 10033 },
        ],
      },
      legacy: [
        {
          id: "p/1",
          name: "write",
          args: '{"path":"large.txt"}',
          status: "ok",
        },
      ],
      isError: false,
      starts: [
        {
          id: "p/1",
          name: "write",
          input: { path: "large.txt", content: "x".repeat(10000) },
        },
      ],
      outputs: { "p/1": { content: "written", isError: false } },
    },
  };

  function buildMessages(
    raw: unknown,
    legacy: unknown,
    isError: boolean,
    withNestedCalls: boolean,
  ): Message[] {
    return [
      assistantMessage("use-message", [codemode()]),
      assistantMessage("result-message", [
        {
          type: "tool_result",
          toolUseId: PARENT_ID,
          content: "Script completed",
          isError,
          ...(withNestedCalls
            ? {
                nestedCalls: normalizeNestedToolCalls(
                  PARENT_ID,
                  raw,
                  legacy,
                  isError ? "error" : "ok",
                ),
              }
            : {}),
        },
      ]),
    ];
  }

  function runLivePipeline(
    pipeline: Pipeline,
  ): Record<string, NestedToolRuntimeUi> {
    const tracker = createNestedToolCallTracker();
    tracker.startParent(PARENT_ID);
    for (const call of pipeline.starts) tracker.start(PARENT_ID, call);
    for (const [id, output] of Object.entries(pipeline.outputs)) {
      tracker.finish(PARENT_ID, id, output);
    }
    tracker.finishParent(
      PARENT_ID,
      pipeline.raw,
      pipeline.legacy,
      pipeline.isError,
    );
    const runtime = tracker.get(PARENT_ID);
    return runtime ? { [PARENT_ID]: runtime } : {};
  }

  it.each(Object.keys(pipelines))(
    "projects the %s capture identically from runtime and history",
    (name) => {
      const pipeline = pipelines[name] as Pipeline;
      // 实时链路只有运行时快照；历史链路只有落库的 nestedCalls。
      const liveMessages = buildMessages(
        pipeline.raw,
        pipeline.legacy,
        pipeline.isError,
        false,
      );
      const historyMessages = buildMessages(
        pipeline.raw,
        pipeline.legacy,
        pipeline.isError,
        true,
      );
      const live = projectNestedToolMessages(
        liveMessages,
        runLivePipeline(pipeline),
      );
      const history = projectNestedToolMessages(historyMessages, {});

      expect(live.map((message) => message.id)).toEqual(["use-message"]);
      expect(history.map((message) => message.id)).toEqual(["use-message"]);
      expect(traceUses(live[0]?.content ?? [])).toEqual(
        traceUses(history[0]?.content ?? []),
      );
      expect(
        groupSummaries(buildToolDisplayBlocks(live[0]?.content ?? [])),
      ).toEqual(
        groupSummaries(buildToolDisplayBlocks(history[0]?.content ?? [])),
      );
    },
  );

  it("replaces the mixed capture parent with its real children", () => {
    const pipeline = pipelines.mixed as Pipeline;
    const messages = buildMessages(
      pipeline.raw,
      pipeline.legacy,
      pipeline.isError,
      true,
    );
    const projected = projectNestedToolMessages(
      messages,
      runLivePipeline(pipeline),
    );
    const group = buildToolDisplayBlocks(projected[0]?.content ?? []).find(
      (item) => item.type === "process-summary",
    );
    expect(traceUses(projected[0]?.content ?? []).map((use) => use.id)).toEqual(
      ["p/1", "p/2", "p/3", "p/4"],
    );
    expect(group?.summary).toMatchObject({ readCount: 1, commandCount: 1 });
    expect(group?.status?.firstFailedToolCallId).toBe("p/4");
  });

  it("keeps result-before-use messages in one turn without moving the parent host", () => {
    const messages: Message[] = [
      assistantMessage("result-message", [
        {
          type: "tool_result",
          toolUseId: PARENT_ID,
          content: "Script completed",
          isError: false,
          nestedCalls: normalizeNestedToolCalls(
            PARENT_ID,
            {
              complete: true,
              calls: [
                {
                  id: "c1",
                  name: "read",
                  status: "ok",
                  arguments: { path: "a.ts" },
                },
              ],
            },
            undefined,
            "ok",
          ),
        },
      ]),
      assistantMessage("use-message", [
        { type: "text", text: "kept text" },
        codemode(),
      ]),
    ];
    const projected = projectNestedToolMessages(messages, {});
    expect(projected.map((message) => message.id)).toEqual(["use-message"]);
    expect(projected[0]?.content[0]).toEqual({
      type: "text",
      text: "kept text",
    });
    expect(
      projected
        .flatMap((message) => message.content)
        .flatMap((block) => (block.type === "tool_use" ? [block.id] : [])),
    ).toEqual(["c1"]);
    expect(
      projected[0]?.content.find((block) => block.type === "tool_use")?.trace
        ?.script?.id,
    ).toBe(PARENT_ID);
    // 投影不修改原始消息：历史 result 原位保留。
    expect(messages[0]?.content[0]).toMatchObject({
      type: "tool_result",
      toolUseId: PARENT_ID,
    });
  });
});
