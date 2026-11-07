// @vitest-environment jsdom
//
// 活动区右区（chip）的组件级测试：任务清单已搬到消息区底部的任务坞（2026-11-06），
// 这里只剩子代理入口。注意：vitest 的 include 只收 `{js,ts}` —— 所以一律用
// React.createElement，不要写 JSX（本仓库既有渲染测试同样如此）。
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatInputStatusBar } from "../../renderer/components/ChatInputStatusBar";
import type { ChatInputStatus } from "../../renderer/components/ChatInputStatusBar";
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

  // 面板经 portal 挂到 document.body（触发器仍在 container 里）—— 面板与触发器
  // 分开查。Radix 在 setTimeout(0) 里挂 document 级监听、Presence 也延后一帧，
  // 所以打开面板后先推一个宏任务再断言（做法同 merged-input-chip.test.ts）。
  async function flushMacrotask() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it("没有子代理时整行不渲染（也不留固定高度占位）", () => {
    render(strip());
    expect(container.querySelector("button")).toBeNull();
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
    expect(
      container.querySelector("button[aria-haspopup='dialog']"),
    ).not.toBeNull();
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
    expect(
      container.querySelector("button[aria-haspopup='dialog']"),
    ).not.toBeNull();
  });

  // 面板入口的退路：无论会话处在哪个状态，chip 都必须可达（面板里能看到明细）。
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
    expect(container.textContent).toContain("activity.subagents:1");
    expect(
      container.querySelector("button[aria-haspopup='dialog']"),
    ).not.toBeNull();
  });

  it("活动归零后重开，面板不会自己弹开", async () => {
    const withActivity = strip({ backgroundAgentRows: [row("running")] });
    render(withActivity);
    await act(async () => {
      container.querySelector("button")?.click();
    });
    await flushMacrotask();
    expect(document.body.querySelector("[role='dialog']")).toBeTruthy();

    render(strip());
    expect(document.body.querySelector("[role='dialog']")).toBeNull();

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

  // 迁移回归守卫：子代理行是 `<Button variant="ghost">`，base 的 `text-sm`（14px）/ `font-medium`
  // 与 `[&_svg]:size-4`（把 `h-3 w-3` 的状态图标顶回 16px）、缺省档的 `h-9`（36px 定高）
  // 会盖掉面板容器的 `text-xs`（元素上的类胜过继承值）—— 面板出生时这里是原生 `<button>`，
  // 四者都是继承来的。真机（Chromium + 构建 CSS）实测：行内 14px/500、图标 16px；
  // 且 `h-9` 把三行内容（64px）压进 36px 的盒子 ⇒ 第三行溢出、被面板底边裁掉 9px
  // （2026-10-10 用户截图报障「子代理面板字体大小不对」）。
  // ⚠️ jsdom 没有布局引擎 ⇒ 这一条钉的是「泄漏的类不在 + 写回的类都在」，几何归真机目视。
  it("子代理行不继承 Button 的高度 / 字号 / 字重 / 图标尺寸", async () => {
    render(strip({ backgroundAgentRows: [row("running")] }));
    await act(async () => {
      container.querySelector<HTMLButtonElement>("button")?.click();
    });
    await flushMacrotask();
    const panel = document.body.querySelector("[role='dialog']");
    // ⚠️ 按内容定位，不用 `panel.querySelector("button")` —— 那是 popover 里的**第一个** button，
    // 面板将来随便加个控件（可折叠区块头 / 行内跳转箭头）都会让断言打到别的元素上。
    const rowButton = Array.from(panel?.querySelectorAll("button") ?? []).find(
      (button) => button.textContent?.includes("curie"),
    );
    expect(rowButton, "面板里应有子代理行").toBeTruthy();
    // 写回的：`cn` 会把四条冲突类整条删掉（同族后来者胜），所以这里只断言「在场」
    for (const cls of ["h-auto", "text-xs", "font-normal", "[&_svg]:size-3"]) {
      expect(rowButton?.classList.contains(cls), cls).toBe(true);
    }
    // 泄漏的：缺省档 / base 的四个，一条都不许留下
    for (const cls of ["h-9", "text-sm", "font-medium", "[&_svg]:size-4"]) {
      expect(rowButton?.classList.contains(cls), cls).toBe(false);
    }
  });

  // 迁移回归守卫，与上面那条面板行同族：chip 是 `PopoverTrigger asChild` 里的
  // `<Button variant="ghost">`，于是 base 的 `text-sm`(14px) / `font-medium` / `[&_svg]:size-4`
  // 和缺省档的 `h-9`(36px 定高) 一起泄漏进来 —— chip 自己写的 `min-h-5`(20px) 是 min-height，
  // 顶不掉定高；chevron 的 `h-3 w-3` 也顶不掉 `[&_svg]:size-4`（它的选择器是 `.cls svg`，
  // 比 `.h-3` 高一级 ⇒ 16px）。真机实测（Chromium + 构建 CSS，2026-10-10）：chip 盒 32×36px、
  // chevron 16px、字 14px/500（用户报障「子代理这个图标太高了」）；写回四条后实测 28×20px、
  // chevron 12px、字 12px/400 == `min-h-5`。
  // ⚠️ jsdom 没有布局引擎 ⇒ 这一条钉的是「泄漏的类不在 + 写回的类都在」，几何归真机目视。
  it("chip 不继承 Button 的高度 / 字号 / 字重 / 图标尺寸", () => {
    render(strip({ backgroundAgentRows: [row("completed")] }));
    const chip = container.querySelector("button[aria-haspopup='dialog']");
    expect(chip, "chip 应存在").toBeTruthy();
    for (const cls of ["h-auto", "text-xs", "font-normal", "[&_svg]:size-3"]) {
      expect(chip?.classList.contains(cls), cls).toBe(true);
    }
    for (const cls of ["h-9", "text-sm", "font-medium", "[&_svg]:size-4"]) {
      expect(chip?.classList.contains(cls), cls).toBe(false);
    }
    // ⚠️ 高度再按**族**兜一道：上面写死的是今天的缺省档 `h-9`，档位哪天从 `h-9` 调成
    // `h-8`，那条会静默转绿（`h-auto` 是 chip 自己写回的白名单，不属于任何数字档）。
    const tokens = (chip?.className ?? "").split(/\s+/);
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
