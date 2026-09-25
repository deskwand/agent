// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SubagentSteps } from "../../renderer/components/message/SubagentSteps";
import i18n from "../../renderer/i18n/config";
import type { SubagentActivity } from "../../shared/subagent-activity";

const activity: SubagentActivity = {
  sessionId: "s1",
  agentId: "a1",
  parentToolCallId: "call-1",
  status: "running",
  name: "turing",
  current: {
    id: "t2",
    toolName: "bash",
    args: { command: "npm test" },
    done: false,
  },
  steps: [
    {
      id: "t1",
      toolName: "read",
      args: { path: "src/a.ts" },
      done: true,
      durationMs: 300,
    },
    { id: "t2", toolName: "bash", args: { command: "npm test" }, done: false },
  ],
  stats: {
    toolUses: 2,
    turnCount: 1,
    maxTurns: 20,
    tokens: 12400,
    durationMs: 8300,
  },
  model: { name: "deepseek-flash", thinking: "high" },
};

describe("SubagentSteps", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    await i18n.changeLanguage("zh");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("当前步骤高亮、已完成步骤带耗时、统计行含 token 与模型", () => {
    act(() => root.render(createElement(SubagentSteps, { activity })));
    const text = container.textContent ?? "";
    expect(text).toContain("npm test");
    expect(text).toContain("src/a.ts");
    expect(text).toContain("2 步");
    expect(text).toContain("1/20 轮");
    expect(text).toContain("12.4K");
    expect(text).toContain("deepseek-flash");
    expect(text).toContain("thinking high");
    // 别名可见，才不会出现「看到图灵、实际要打 @turing」的认知差
    expect(text).toContain("@turing");
    // 前台（未标 background）不显示「后台运行中」
    expect(text).not.toContain("后台运行中");
  });

  it("只有后台并发型才显示「后台运行中」", () => {
    act(() =>
      root.render(
        createElement(SubagentSteps, {
          activity: { ...activity, background: true },
        }),
      ),
    );
    expect(container.textContent ?? "").toContain("后台运行中");
  });

  it("没有 maxTurns 时不显示 ∞，模型走 provider/model 展示", () => {
    const noMax: SubagentActivity = {
      ...activity,
      stats: { ...activity.stats, maxTurns: undefined },
      model: { name: "deepseek-flash", id: "deskwand:deepseek/deepseek-flash" },
    };
    act(() => root.render(createElement(SubagentSteps, { activity: noMax })));
    const text = container.textContent ?? "";
    expect(text).toContain("1 轮");
    expect(text).not.toContain("∞");
    expect(text).toContain("deepseek / deepseek-flash");
  });

  it("失败步骤打上失败标记", () => {
    const failed: SubagentActivity = {
      ...activity,
      current: undefined,
      steps: [
        {
          id: "t1",
          toolName: "bash",
          args: { command: "boom" },
          done: true,
          isError: true,
          durationMs: 10,
        },
      ],
    };
    act(() => root.render(createElement(SubagentSteps, { activity: failed })));
    expect(container.textContent ?? "").toContain("失败");
  });

  it("完成态改用勾图标，且不残留「正在…」那行（current 仍存在）", () => {
    const done: SubagentActivity = {
      ...activity,
      status: "completed",
      // 故意**不**清 current：完成态的正常情况就是最后一步还没等到 tool_end，
      // 只有保留它才能真测到 `status === "running"` 那道闸门。
      current: activity.current,
      background: true,
      steps: activity.steps.map((step) => ({ ...step, done: true })),
    };
    act(() => root.render(createElement(SubagentSteps, { activity: done })));
    const text = container.textContent ?? "";
    // 表头不再是 Loader2：LoaderCircle 只有 <path>，CircleCheck/XCircle 都含 <circle>
    const header = container.querySelector(".mb-1");
    expect(header?.querySelector("circle")).not.toBeNull();
    expect(container.querySelectorAll(".animate-spin")).toHaveLength(0);
    expect(text).not.toContain("◐");
    expect(text).not.toContain("后台运行中");
  });

  it("运行态仍有转圈图标与「正在…」那行", () => {
    act(() => root.render(createElement(SubagentSteps, { activity })));
    expect(container.querySelectorAll(".animate-spin").length).toBeGreaterThan(
      0,
    );
    expect(container.textContent ?? "").toContain("◐");
  });

  it("失败态用错误色图标", () => {
    const failed: SubagentActivity = { ...activity, status: "error" };
    act(() => root.render(createElement(SubagentSteps, { activity: failed })));
    expect(container.querySelectorAll(".text-error").length).toBeGreaterThan(0);
  });

  it("从未收到 tool_end 的步骤不打勾（空心中点）", () => {
    const interrupted: SubagentActivity = {
      ...activity,
      status: "completed",
      current: undefined,
      steps: [
        {
          id: "t9",
          toolName: "bash",
          args: { command: "sleep 100" },
          done: false,
        },
      ],
    };
    act(() =>
      root.render(createElement(SubagentSteps, { activity: interrupted })),
    );
    // 结构断言：那一步的行里没有完成图标。
    // 注意：Circle 与 CheckCircle2 **都**会渲染一个 <circle>，所以只能靠有没有 <path>（勾）来区分。
    const row = container.querySelectorAll(".space-y-0\\.5 > div")[0];
    expect(row?.querySelectorAll("svg").length).toBe(1);
    expect(row?.querySelector("path")).toBeNull();
  });
});
