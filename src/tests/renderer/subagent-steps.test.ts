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
});
