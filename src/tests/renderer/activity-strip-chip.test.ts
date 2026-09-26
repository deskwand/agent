// @vitest-environment jsdom
//
// 活动区右区（chip）的组件级测试。
// 注意：仓库里没有 .tsx 测试文件，且 vitest 的 include 只收 `{js,ts}`——
// 所以这里一律用 React.createElement，不要写 JSX（本仓库既有渲染测试同样如此）。
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatInputStatusBar } from "../../renderer/components/ChatInputStatusBar";
import type { ChatInputStatus } from "../../renderer/components/ChatInputStatusBar";
import type { BackgroundAgentRow } from "../../renderer/utils/subagent-card";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

const TODOS = [
  { content: "建表", status: "completed" as const },
  { content: "写迁移", status: "in_progress" as const },
];

function row(status: BackgroundAgentRow["status"]): BackgroundAgentRow {
  return {
    toolCallId: "c1",
    name: "curie",
    type: "explore",
    status,
    stepCount: 1,
    durationMs: 100,
  };
}

/** 状态条工厂：默认"什么都没在跑"，各用例只覆盖自己关心的 props。 */
function strip(
  props: Partial<React.ComponentProps<typeof ChatInputStatusBar>> = {},
): React.ReactElement {
  return React.createElement(ChatInputStatusBar, {
    status: null,
    currentTodos: null,
    backgroundAgentRows: [],
    ...props,
  });
}

describe("activity chip", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  function render(element: React.ReactElement) {
    act(() => root.render(element));
  }

  it("renders progress as a fraction when a task list exists", () => {
    render(strip({ currentTodos: TODOS }));
    expect(container.textContent).toContain("1/2");
    expect(container.querySelector("[role='progressbar']")).toBeTruthy();
  });

  it("renders nothing on the right when there is no activity", () => {
    render(strip());
    expect(container.querySelector("[role='progressbar']")).toBeNull();
    expect(container.querySelector("button")).toBeNull();
  });

  it("renders nothing when the list was explicitly cleared", () => {
    render(strip({ currentTodos: [] }));
    expect(container.textContent).not.toContain("1/2");
    expect(container.querySelector("button")).toBeNull();
  });

  it("keeps the subagent count visible while the model is responding", () => {
    // 改动前这里什么都看不到：background-agent 在优先级链末位，被 responding 吃掉。
    render(
      strip({
        status: { type: "responding" },
        currentTodos: TODOS,
        backgroundAgentRows: [row("running")],
      }),
    );
    expect(container.textContent).toContain("activity.subagents");
    expect(container.textContent).toContain("1/2");
  });

  it("shows only the count when there is no task list", () => {
    render(
      strip({
        status: { type: "responding" },
        backgroundAgentRows: [row("running")],
      }),
    );
    expect(container.textContent).toContain("activity.subagents");
    expect(container.querySelector("[role='progressbar']")).toBeNull();
  });

  it("目标长跑中右区仍然存在（本次要修的典型场景）", () => {
    // 目标态是独立的一条渲染分支、有自己的 early return：右区必须在那条分支里也在，
    // 否则「长跑时看不到计划与后台计数」这个原 bug 在目标态下原样复现。
    render(
      strip({
        status: {
          type: "goal-active",
          objective: "跑一个长任务",
          iteration: 1,
        },
        currentTodos: TODOS,
        backgroundAgentRows: [row("running")],
      }),
    );
    expect(container.textContent).toContain("1/2");
    expect(container.querySelector("[role='progressbar']")).toBeTruthy();
    expect(container.textContent).toContain("activity.subagents");
    expect(
      container.querySelector("button[aria-haspopup='dialog']"),
    ).not.toBeNull();
  });

  // 两个承载者（左区细化文案 / chip 计数）的互斥律：无论哪种状态，计数都必须
  // 落在其中一个上，且面板入口永远可达。
  const STATUS_VARIANTS: ChatInputStatus[] = [
    { type: "sending" },
    { type: "thinking" },
    { type: "responding" },
    { type: "compacting" },
    { type: "compaction-success" },
    { type: "compaction-failed" },
    { type: "compaction-aborted" },
    { type: "goal-active", objective: "x", iteration: 1 },
    { type: "goal-paused", objective: "x" },
    { type: "goal-complete", objective: "x" },
    { type: "goal-blocked", objective: "x" },
    { type: "goal-budget-limited", objective: "x", iteration: 1 },
    { type: "background-agent", count: 1, done: false },
    { type: "background-agent", count: 1, done: true },
  ];

  it.each(STATUS_VARIANTS)("计数与面板入口在 $type 下始终可达", (status) => {
    render(strip({ status, backgroundAgentRows: [row("running")] }));
    const body = container.textContent ?? "";
    expect(
      body.includes("activity.subagents") || body.includes("subagent.status"),
    ).toBe(true);
    expect(
      container.querySelector("button[aria-haspopup='dialog']"),
    ).not.toBeNull();
  });

  it("活动归零后重开，面板不会自己弹开", () => {
    const withActivity = strip({
      currentTodos: TODOS,
      backgroundAgentRows: [row("running")],
    });
    render(withActivity);
    act(() => {
      container.querySelector("button")?.click();
    });
    expect(container.querySelector("[role='dialog']")).toBeTruthy();

    render(strip());
    expect(container.querySelector("[role='dialog']")).toBeNull();

    render(withActivity);
    expect(container.querySelector("[role='dialog']")).toBeNull();
  });

  it("展开态按「计划 → 子代理」两区块渲染", () => {
    render(
      strip({ currentTodos: TODOS, backgroundAgentRows: [row("running")] }),
    );
    act(() => {
      container.querySelector<HTMLButtonElement>("button")?.click();
    });
    const panel = container.querySelector("[role='dialog']");
    expect(panel).toBeTruthy();
    const body = panel?.textContent ?? "";
    expect(body).toContain("activity.planSection");
    expect(body).toContain("activity.planDone");
    expect(body).toContain("建表");
    expect(body).toContain("写迁移");
    expect(body).toContain("activity.subagentsSection");
    expect(body).toContain("curie");
    // 区块顺序：计划在子代理之前
    expect(body.indexOf("activity.planSection")).toBeLessThan(
      body.indexOf("activity.subagentsSection"),
    );
  });

  it("展开态只有计划时不渲染子代理区块", () => {
    render(strip({ currentTodos: TODOS }));
    act(() => {
      container.querySelector<HTMLButtonElement>("button")?.click();
    });
    const body = container.querySelector("[role='dialog']")?.textContent ?? "";
    expect(body).toContain("建表");
    expect(body).not.toContain("activity.subagentsSection");
  });

  it("左区已经在说计数时，chip 不再重复一遍", () => {
    render(
      strip({
        status: { type: "background-agent", count: 1, done: false },
        backgroundAgentRows: [row("running")],
      }),
    );
    // 左区（无更高优先级状态时）保留原有的细化文案，包含"有失败"这类信号
    expect(container.textContent).toContain("subagent.statusRunning");
    // 同一句信息不在 chip 里再说一遍
    expect(container.textContent).not.toContain("activity.subagents");
  });
});
