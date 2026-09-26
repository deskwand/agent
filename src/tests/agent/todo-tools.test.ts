import { describe, expect, it } from "vitest";
import { createTodoTools } from "../../main/agent/tools/todo-tools";

const tool = createTodoTools()[0]!;

// ctx 传 `undefined as never` 是房屋惯例（src/tests/agent/web-access/web-tools.test.ts:47-53）。
// params 传 unknown 不会被拦：工厂声明返回 `ToolDefinition[]`，会把参数推断 widen 掉；
// 而实现内部 `const todoWrite = defineTool(...)` 仍保有精确推断。这不是 bug。
const run = (todos: unknown) =>
  tool.execute("call-1", { todos }, undefined, undefined, undefined as never);

const runDone = (todos: unknown, done: boolean) =>
  tool.execute(
    "call-1",
    { todos, done },
    undefined,
    undefined,
    undefined as never,
  );

describe("todo_write", () => {
  it("工具名是 snake_case", () => {
    expect(tool.name).toBe("todo_write");
  });

  it("接受合法清单并回报进度", async () => {
    const result = await run([
      { content: "写 spec", status: "completed" },
      { content: "写计划", status: "in_progress", activeForm: "正在写计划" },
      { content: "写代码", status: "pending" },
    ]);
    const text = JSON.stringify(result.content);
    expect(text).toContain("1/3");
    expect(text).toContain("正在写计划");
  });

  it("拒绝多于一条 in_progress", async () => {
    const result = await run([
      { content: "a", status: "in_progress" },
      { content: "b", status: "in_progress" },
    ]);
    expect(JSON.stringify(result.content)).toContain("in_progress");
    expect(JSON.stringify(result.content)).toContain("Rejected");
  });

  it("拒绝空 content", async () => {
    const result = await run([{ content: "   ", status: "pending" }]);
    expect(JSON.stringify(result.content)).toContain("Rejected");
  });

  it("接受空数组（清空清单）", async () => {
    const result = await run([]);
    expect(JSON.stringify(result.content)).toContain("cleared");
  });
  it("done: true 且已结算 → 回执确认结束", async () => {
    const result = await runDone([{ content: "a", status: "completed" }], true);
    const text = JSON.stringify(result.content);
    expect(text).toContain("1/1 completed");
    expect(text).toContain("Plan finished");
  });

  it("done: true 但留着未结算项 → 拒绝并提示先结算", async () => {
    const result = await runDone([{ content: "a", status: "pending" }], true);
    const text = JSON.stringify(result.content);
    expect(text).toContain("Rejected");
    expect(text).toContain("completed or cancelled");
  });

  it("空数组上的 done 被忽略（仍按清空处理，不声称完成）", async () => {
    const result = await runDone([], true);
    expect(JSON.stringify(result.content)).toContain("Task list cleared.");
  });
});
