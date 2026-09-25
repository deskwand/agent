import { describe, expect, it } from "vitest";
import {
  MAX_STEPS,
  applySessionEvent,
  buildSnapshot,
  createActivityState,
  pickStepArgs,
} from "../../main/agent/subagent/activity-state";

describe("pickStepArgs", () => {
  it("read 只留 path（file_path 优先），截断超长值", () => {
    expect(pickStepArgs("read", { path: "src/a.ts" })).toEqual({
      path: "src/a.ts",
    });
    expect(
      pickStepArgs("read_file", { file_path: "src/b.ts", path: "x" }),
    ).toEqual({ path: "src/b.ts" });
    const long = "a".repeat(500);
    expect(
      pickStepArgs("read", { path: long }).path?.length,
    ).toBeLessThanOrEqual(201);
  });

  it("bash 只留 command", () => {
    expect(pickStepArgs("bash", { command: "npm test", timeout: 30 })).toEqual({
      command: "npm test",
    });
  });

  it("grep 留 pattern 与可选 path", () => {
    expect(pickStepArgs("grep", { pattern: "foo", path: "src" })).toEqual({
      pattern: "foo",
      path: "src",
    });
  });

  it("write 的正文绝不外发", () => {
    expect(pickStepArgs("write", { path: "a.ts", content: "secret" })).toEqual({
      path: "a.ts",
    });
    expect(
      pickStepArgs("edit", { path: "a.ts", old_string: "s", new_string: "t" }),
    ).toEqual({ path: "a.ts" });
  });

  it("未知工具与 mcp 工具只给空对象（只显示工具名）", () => {
    expect(pickStepArgs("mcp__foo__bar", { anything: 1 })).toEqual({});
    expect(pickStepArgs("todo_write", { todos: [] })).toEqual({});
  });

  it("截断不会把 emoji 劈成半个代理对", () => {
    const path = `${"a".repeat(199)}😀`;
    const result = pickStepArgs("read", { path }).path ?? "";
    expect(/[\uD800-\uDBFF]$/.test(result)).toBe(false);
  });
});

describe("applySessionEvent", () => {
  it("tool start 追加步骤并设为 current，end 收尾并算耗时", () => {
    const state = createActivityState();
    expect(
      applySessionEvent(
        state,
        {
          type: "tool_execution_start",
          toolCallId: "t1",
          toolName: "read",
          args: { path: "a.ts" },
        },
        1000,
      ),
    ).toBe(true);
    expect(state.current?.id).toBe("t1");
    expect(state.steps).toHaveLength(1);

    applySessionEvent(
      state,
      { type: "tool_execution_end", toolCallId: "t1", isError: false },
      1300,
    );
    expect(state.current).toBeUndefined();
    expect(state.steps[0].done).toBe(true);
    expect(state.steps[0].durationMs).toBe(300);
  });

  it("turn_end 计轮次", () => {
    const state = createActivityState();
    applySessionEvent(state, { type: "turn_end" }, 1);
    applySessionEvent(state, { type: "turn_end" }, 2);
    expect(state.turnCount).toBe(2);
  });

  it("无关事件返回 false 且不改状态", () => {
    const state = createActivityState();
    expect(applySessionEvent(state, { type: "message_start" }, 1)).toBe(false);
  });

  it("tool end 没匹配到步骤时返回 false（没有可见变化）", () => {
    const state = createActivityState();
    expect(
      applySessionEvent(
        state,
        { type: "tool_execution_end", toolCallId: "missing", isError: false },
        10,
      ),
    ).toBe(false);
  });

  it("步骤超过 MAX_STEPS 时丢最旧", () => {
    const state = createActivityState();
    for (let i = 0; i < MAX_STEPS + 5; i++) {
      applySessionEvent(
        state,
        {
          type: "tool_execution_start",
          toolCallId: `t${i}`,
          toolName: "read",
          args: {},
        },
        i,
      );
    }
    expect(state.steps).toHaveLength(MAX_STEPS);
    expect(state.steps[0].id).toBe("t5");
  });
});

describe("buildSnapshot", () => {
  const base = {
    sessionId: "s1",
    agentId: "a1",
    toolCallId: "call-1",
    state: createActivityState(),
    now: 2000,
  };

  it("tokens 口径为 input+output+cacheWrite（不含 cacheRead）", () => {
    const snapshot = buildSnapshot({
      ...base,
      record: {
        toolUses: 1,
        startedAt: 1000,
        lifetimeUsage: {
          input: 10,
          output: 5,
          cacheWrite: 2,
          cacheRead: 999,
          cost: 0.1,
        },
      },
    });
    expect(snapshot.stats.tokens).toBe(17);
    expect(snapshot.stats.durationMs).toBe(1000);
    expect(snapshot.status).toBe("running");
  });

  it("无 usage 时不发 tokens（不用 0 冒充）", () => {
    const snapshot = buildSnapshot({ ...base, record: {} });
    expect(snapshot.stats.tokens).toBeUndefined();
    expect(snapshot.model).toBeUndefined();
  });

  it("别名与模型信息按实际生效值带出", () => {
    const snapshot = buildSnapshot({
      ...base,
      record: {
        alias: "turing",
        invocation: {
          modelName: "deepseek-flash",
          modelId: "deskwand:deepseek/x",
          thinking: "high",
          maxTurns: 20,
        },
      },
    });
    expect(snapshot.name).toBe("turing");
    expect(snapshot.stats.maxTurns).toBe(20);
    expect(snapshot.model).toEqual({
      name: "deepseek-flash",
      id: "deskwand:deepseek/x",
      thinking: "high",
    });
  });

  it("显式 status 覆盖 record 状态（收尾时不改上游对象）", () => {
    expect(
      buildSnapshot({
        ...base,
        record: { status: "aborted" },
        status: "completed",
      }).status,
    ).toBe("completed");
  });

  it("只有明确标了 isBackground 才算后台", () => {
    expect(
      buildSnapshot({ ...base, record: { isBackground: true } }).background,
    ).toBe(true);
    expect(
      buildSnapshot({ ...base, record: { isBackground: false } }).background,
    ).toBeUndefined();
    expect(buildSnapshot({ ...base, record: {} }).background).toBeUndefined();
  });

  it("带出子代理的类型与描述（面板对已完成的 agent 只能靠它）", () => {
    const withMeta = buildSnapshot({
      ...base,
      record: { type: "Explore", description: "find bug" },
    });
    expect(withMeta.type).toBe("Explore");
    expect(withMeta.description).toBe("find bug");
    expect(buildSnapshot({ ...base, record: {} }).type).toBeUndefined();
  });

  it("终止状态映射成 completed / error", () => {
    expect(
      buildSnapshot({ ...base, record: { status: "completed" } }).status,
    ).toBe("completed");
    expect(
      buildSnapshot({ ...base, record: { status: "aborted" } }).status,
    ).toBe("error");
    expect(
      buildSnapshot({ ...base, record: { status: "running" } }).status,
    ).toBe("running");
  });
});
