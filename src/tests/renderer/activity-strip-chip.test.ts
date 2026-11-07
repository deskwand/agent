// @vitest-environment jsdom
//
// 活动区右区（chip）的组件级测试：任务清单在消息区底部的任务坞，子代理**列表与明细**
// 在右侧会话概览（2026-11-07 把 popover 从输入框上方撤掉了 —— 那份列表与概览面板
// 内容完全重复，点行也只是跳回消息区）。所以这里只剩两件事：计数（+失败色）与
// 「点一下打开概览」。注意：vitest 的 include 只收 `{js,ts}` —— 一律用
// React.createElement，不要写 JSX（本仓库既有渲染测试同样如此）。
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatInputStatusBar } from "../../renderer/components/ChatInputStatusBar";
import type { ChatInputStatus } from "../../renderer/components/ChatInputStatusBar";
import { useAppStore } from "../../renderer/store";
import type { BackgroundAgentRow } from "../../renderer/utils/subagent-card";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    // 带上 count：像"N 个子代理"这种把数字插进文案的断言才有意义
    t: (key: string, opts?: { count?: number }) =>
      opts?.count === undefined ? key : `${key}:${opts.count}`,
    i18n: { language: "en" },
  }),
}));

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
    useAppStore.setState(useAppStore.getInitialState(), true);
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

  /** chip 是右区唯一的元素，不需要按 aria 属性挑（它已经不带弹层了）。 */
  const chip = () => container.querySelector("button");

  it("没有子代理时整行不渲染（也不留固定高度占位）", () => {
    render(strip());
    expect(chip()).toBeNull();
    expect((container.textContent ?? "").trim()).toBe("");
  });

  it("模型正在回答时，子代理计数仍然可见", () => {
    // 改动前这里什么都看不到：background-agent 在优先级链末位，被 responding 吃掉。
    render(
      strip({
        status: { type: "responding" },
        backgroundAgentRows: [row("running")],
      }),
    );
    expect(container.textContent).toContain("activity.subagents:1");
    expect(chip()).not.toBeNull();
  });

  it("目标长跑中右区仍然存在（本次要修的典型场景）", () => {
    // 目标态是独立的一条渲染分支、有自己的 early return：右区必须在那条分支里也在，
    // 否则「长跑时看不到后台计数」这个原 bug 在目标态下原样复现。
    render(
      strip({
        status: {
          type: "goal-active",
          objective: "跑一个长任务",
          iteration: 1,
        },
        backgroundAgentRows: [row("running")],
      }),
    );
    expect(container.textContent).toContain("activity.subagents:1");
    expect(chip()).not.toBeNull();
  });

  // 入口的退路：无论会话处在哪个状态，chip 都必须可达（点开就是明细）。
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

  it.each(STATUS_VARIANTS)("计数与入口在 $type 下始终可达", (status) => {
    render(strip({ status, backgroundAgentRows: [row("running")] }));
    expect(container.textContent).toContain("activity.subagents:1");
    expect(chip()).not.toBeNull();
  });

  it("点击打开会话概览并选中在跑的那条（不再就地弹列表）", async () => {
    render(
      strip({
        backgroundAgentRows: [
          row("completed"),
          { ...row("running"), toolCallId: "c2" },
        ],
      }),
    );

    await act(async () => {
      chip()?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const state = useAppStore.getState();
    expect(state.rightPanelMode).toBe("overview");
    // 落点优先给还在跑的那条，而不是列表第一条
    expect(state.overviewTaskFocusId).toBe("c2");
    // 旧的面板（portal + role=dialog）不该再出现
    expect(document.body.querySelector("[role='dialog']")).toBeNull();
  });

  it("活动归零后 chip 消失，再出现时不会自己弹出任何面板", async () => {
    const withActivity = strip({ backgroundAgentRows: [row("running")] });
    render(withActivity);
    await act(async () => {
      chip()?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    render(strip());
    expect(chip()).toBeNull();

    render(withActivity);
    expect(document.body.querySelector("[role='dialog']")).toBeNull();
  });

  it("chip 是子代理计数的唯一载体（同一句只说一遍）", () => {
    // 动作态文案整段搬到消息区底部的任务坞，chip 是这句话的唯一出口：
    // 计数只出现一次，不会在别的元素里再重复一遍。
    render(
      strip({
        status: { type: "background-agent", count: 1, done: false },
        backgroundAgentRows: [row("running")],
      }),
    );
    const occurrences =
      (container.textContent ?? "").split("activity.subagents:1").length - 1;
    expect(occurrences).toBe(1);
  });

  // 迁移回归守卫：chip 是 `<Button variant="ghost">`，base 的 `text-sm`(14px) /
  // `font-medium` / `[&_svg]:size-4` 和缺省档的 `h-9`(36px 定高) 会一起泄漏进来 ——
  // chip 自己写的 `min-h-5`(20px) 是 min-height，顶不掉定高；状态图标的 `h-3 w-3` 也顶不掉
  // `[&_svg]:size-4`（选择器是 `.cls svg`，比 `.h-3` 高一级 ⇒ 16px）。真机实测
  // （Chromium + 构建 CSS，2026-10-10）：chip 盒 32×36px、图标 16px、字 14px/500
  // （用户报障「子代理这个图标太高了」）；写回四条后 28×20px、图标 12px、字 12px/400。
  // ⚠️ jsdom 没有布局引擎 ⇒ 这一条钉的是「泄漏的类不在 + 写回的类都在」，几何归真机目视。
  it("chip 不继承 Button 的高度 / 字号 / 字重 / 图标尺寸", () => {
    render(strip({ backgroundAgentRows: [row("completed")] }));
    const button = chip();
    expect(button, "chip 应存在").toBeTruthy();
    for (const cls of ["h-auto", "text-xs", "font-normal", "[&_svg]:size-3"]) {
      expect(button?.classList.contains(cls), cls).toBe(true);
    }
    for (const cls of ["h-9", "text-sm", "font-medium", "[&_svg]:size-4"]) {
      expect(button?.classList.contains(cls), cls).toBe(false);
    }
    // ⚠️ 高度再按**族**兜一道：上面写死的是今天的缺省档 `h-9`，档位哪天从 `h-9` 调成
    // `h-8`，那条会静默转绿（`h-auto` 是 chip 自己写回的白名单，不属于任何数字档）。
    const tokens = (button?.className ?? "").split(/\s+/);
    expect(
      tokens.filter((cls) => /^h-(?:\d|\[)/.test(cls)),
      "chip 不该带上任何数字高度档",
    ).toEqual([]);
    // ⚠️ 另三个轴同理：写死今天的 `text-sm` / `font-medium` / `[&_svg]:size-4`，哪一天 base
    // 把它们改成 `text-[13px]` / `font-semibold` / `[&_svg]:size-5`，上面那三条就会静默转绿
    // ⇒ 这三条按**族**钉「chip 上只允许出现它自己写回的那一个值」。
    // （白名单式而不是硬编码黑名单：`text-left` / `text-foreground` 这类同前缀的别的族不算。）
    expect(
      tokens.filter((cls) =>
        /^text-(?:\[|xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)$/.test(
          cls,
        ),
      ),
      "chip 只允许 text-xs 这一个字号档",
    ).toEqual(["text-xs"]);
    expect(
      tokens.filter((cls) =>
        /^font-(?:\[|thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/.test(
          cls,
        ),
      ),
      "chip 只允许 font-normal 这一个字重档",
    ).toEqual(["font-normal"]);
    expect(
      tokens.filter((cls) => /^\[&_svg\]:size-/.test(cls)),
      "chip 只允许 [&_svg]:size-3 这一个图标尺寸档",
    ).toEqual(["[&_svg]:size-3"]);
  });
});
