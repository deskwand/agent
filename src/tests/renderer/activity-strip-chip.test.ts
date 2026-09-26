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
    lastNonEmptyTodos: null,
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

  it("step text: 有进行中项时显示该项文案", () => {
    render(
      strip({
        currentTodos: [
          { content: "建表", status: "completed" },
          { content: "写迁移", status: "in_progress" },
          { content: "补测试", status: "pending" },
        ],
      }),
    );
    expect(container.textContent).toContain("写迁移");
    expect(container.textContent).toContain("1/3");
  });

  it("step text: activeForm 优先于 content", () => {
    render(
      strip({
        currentTodos: [
          {
            content: "写迁移脚本",
            status: "in_progress",
            activeForm: "正在迁移",
          },
        ],
      }),
    );
    expect(container.textContent).toContain("正在迁移");
    // 两条文案不能互为子串，否则这条断言区分不了到底显示了哪个
    expect(container.textContent).not.toContain("写迁移脚本");
  });

  it("finishing: 清空后显示收尾态，带 ✓ 与末项文案", () => {
    render(
      strip({
        currentTodos: [],
        lastNonEmptyTodos: [
          { content: "建表", status: "completed" },
          { content: "补 registry 单测", status: "completed" },
        ],
      }),
    );
    expect(container.textContent).toContain("2/2");
    expect(container.textContent).toContain("✓");
    expect(container.textContent).toContain("补 registry 单测");
  });

  it("finishing: 没跑完就清空时不加 ✓", () => {
    render(
      strip({
        currentTodos: [],
        lastNonEmptyTodos: [
          { content: "建表", status: "completed" },
          { content: "补 registry 单测", status: "pending" },
        ],
      }),
    );
    expect(container.textContent).toContain("1/2");
    expect(container.textContent).not.toContain("✓");
    expect(container.textContent).toContain("补 registry 单测");
  });

  it("finishing: 不把上一份清单的进行中项当成「正在进行」", () => {
    // 真实复现（会话 081101f2）：模型跑完 3 项测试后直接清空清单，
    // 第 3 项当时仍是 in_progress → 收尾态若沿用实时态的画法，
    // 会显示「2/3 · 正在验证清空列表」+ 转圈，看起来像"状态没更新"。
    render(
      strip({
        currentTodos: [],
        lastNonEmptyTodos: [
          { content: "验证 todo_write 能创建列表", status: "completed" },
          {
            content: "验证状态可从 in_progress 切到 completed",
            status: "completed",
          },
          {
            content: "验证任务完成后清空列表",
            status: "in_progress",
            activeForm: "正在验证清空列表",
          },
        ],
      }),
    );

    // 进行时的措辞不能出现在收尾态（那是"此刻在做"的说法）
    expect(container.textContent).not.toContain("正在验证清空列表");
    // 收尾态展示最后一项的 content
    expect(container.textContent).toContain("验证任务完成后清空列表");
    expect(container.textContent).toContain("2/3");

    // 展开面板：收尾态没有任何"正在跑"的指示器
    act(() => {
      container.querySelector<HTMLButtonElement>("button")?.click();
    });
    const body = container.querySelector("[role='dialog']")?.textContent ?? "";
    expect(body).toContain("验证任务完成后清空列表");
    expect(body).not.toContain("正在验证清空列表");
    expect(container.querySelector(".animate-spin")).toBeNull();
  });

  it("finishing: currentTodos 为 null 时不显示收尾态（无依据）", () => {
    render(
      strip({
        currentTodos: null,
        lastNonEmptyTodos: [{ content: "建表", status: "completed" }],
      }),
    );
    expect(container.querySelector("button")).toBeNull();
  });

  it("finishing: 真实清单到来时收尾态被取代", () => {
    render(
      strip({
        currentTodos: [{ content: "新的一步", status: "pending" }],
        lastNonEmptyTodos: [{ content: "建表", status: "completed" }],
      }),
    );
    expect(container.textContent).toContain("0/1");
    expect(container.textContent).not.toContain("✓");
    expect(container.textContent).not.toContain("建表");
  });

  it("step text: 没有进行中项时不留空槽", () => {
    render(
      strip({
        currentTodos: [
          { content: "建表", status: "pending" },
          { content: "补测试", status: "pending" },
        ],
      }),
    );
    expect(container.textContent).toContain("0/2");
    expect(container.textContent).not.toContain("建表");
    expect(container.textContent).not.toContain("补测试");
  });
});
