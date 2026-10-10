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
  useTranslation: () => ({
    // 带上 count：像"N 项取消"这种把数字插进文案的断言才有意义
    t: (key: string, opts?: { count?: number }) =>
      opts?.count === undefined ? key : `${key}:${opts.count}`,
    i18n: { language: "en" },
  }),
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
    currentPlanDone: false,
    lastNonEmptyTodos: null,
    lastPlanDone: false,
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

  it("renders progress as a fraction when a task list exists", () => {
    render(strip({ currentTodos: TODOS }));
    expect(container.textContent).toContain("1/2");
    expect(container.querySelector("[role='progressbar']")).toBeTruthy();
  });

  // 进度条迁到 vendored `Progress`（经 `app-progress.tsx` 包装）后，有两件事字符串层
  // 看不到、只能靠单测钉住：① 区间语义是包装层显式写回的（vendored 不把 value 转给
  // Root）；② 尺寸仍由调用点的 className 压住 vendored 的 `h-2 w-full`（cn 去重），
  // 否则这条 34px 的窄条会无声变成整行 8px 高的进度条。
  // 换算与 aria 本身在 `app-progress.test.ts` 里单独钉；这条钉的是 chip 里的接入。
  it("进度条是 vendored Progress：保留 2/9 的区间语义与 34×4px 的尺寸", () => {
    render(strip({ currentTodos: TODOS }));
    const bar = container.querySelector("[role='progressbar']");
    expect(bar).toBeTruthy();
    expect(bar?.getAttribute("aria-valuenow")).toBe("1");
    expect(bar?.getAttribute("aria-valuemax")).toBe("2");
    for (const cls of ["h-1", "w-[34px]", "flex-none"]) {
      expect(bar?.classList.contains(cls), cls).toBe(true);
    }
    for (const cls of ["h-2", "w-full"]) {
      expect(bar?.classList.contains(cls), cls).toBe(false);
    }
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

  it("活动归零后重开，面板不会自己弹开", async () => {
    const withActivity = strip({
      currentTodos: TODOS,
      backgroundAgentRows: [row("running")],
    });
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

  it("展开态按「计划 → 子代理」两区块渲染", async () => {
    render(
      strip({ currentTodos: TODOS, backgroundAgentRows: [row("running")] }),
    );
    await act(async () => {
      container.querySelector<HTMLButtonElement>("button")?.click();
    });
    await flushMacrotask();
    const panel = document.body.querySelector("[role='dialog']");
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

  it("展开态只有计划时不渲染子代理区块", async () => {
    render(strip({ currentTodos: TODOS }));
    await act(async () => {
      container.querySelector<HTMLButtonElement>("button")?.click();
    });
    await flushMacrotask();
    const body =
      document.body.querySelector("[role='dialog']")?.textContent ?? "";
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

  it("finishing: 清空后仍显示最后一份清单的计数（不是 0/0）", () => {
    render(
      strip({
        currentTodos: [],
        lastNonEmptyTodos: [
          { content: "建表", status: "completed" },
          { content: "补 registry 单测", status: "completed" },
        ],
      }),
    );
    // 没声明 done → 说"清单已清空"，且**不**加 ✓（✓ 只对声明负责）
    expect(container.textContent).toContain("2/2");
    expect(container.textContent).toContain("activity.statusCleared");
    expect(container.textContent).not.toContain("✓");
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
    expect(container.textContent).toContain("activity.statusCleared");
  });

  it("finishing: 不把上一份清单的进行中项当成「正在进行」", async () => {
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
    // 没声明 done → 明说"清单已清空"，而不是让 2/3 冒充"还在跑"
    expect(container.textContent).toContain("activity.statusCleared");
    expect(container.textContent).toContain("2/3");

    // 展开面板：收尾态没有任何"正在跑"的指示器
    await act(async () => {
      container.querySelector<HTMLButtonElement>("button")?.click();
    });
    await flushMacrotask();
    const panel = document.body.querySelector("[role='dialog']");
    const body = panel?.textContent ?? "";
    expect(body).toContain("验证任务完成后清空列表");
    expect(body).not.toContain("正在验证清空列表");
    expect(panel?.querySelector(".animate-spin")).toBeNull();
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
  it("done: 声明结束且全部完成 → ✓ 与「已完成」", () => {
    render(
      strip({
        currentTodos: [
          { content: "建表", status: "completed" },
          { content: "补测试", status: "completed" },
        ],
        currentPlanDone: true,
      }),
    );
    expect(container.textContent).toContain("✓");
    expect(container.textContent).toContain("activity.statusDone");
    expect(container.textContent).toContain("2/2");
  });

  it("done: 有 cancelled 时写明「N 项取消」，不说「已完成」", () => {
    render(
      strip({
        currentTodos: [
          { content: "建表", status: "completed" },
          { content: "补测试", status: "cancelled" },
        ],
        currentPlanDone: true,
      }),
    );
    // 比"已结束"更有用：直接说清有几项没完成
    expect(container.textContent).toContain("activity.statusCancelled:1");
    expect(container.textContent).not.toContain("activity.statusDone");
    expect(container.textContent).toContain("1/2");
  });

  it("done: 两项取消时报出 2 项", () => {
    render(
      strip({
        currentTodos: [
          { content: "建表", status: "cancelled" },
          { content: "补测试", status: "cancelled" },
          { content: "写文档", status: "completed" },
        ],
        currentPlanDone: true,
      }),
    );
    expect(container.textContent).toContain("activity.statusCancelled:2");
    expect(container.textContent).toContain("1/3");
  });

  it("清空但上一份没声明 done → 「清单已清空」且无 ✓", () => {
    render(
      strip({
        currentTodos: [],
        lastNonEmptyTodos: [{ content: "建表", status: "completed" }],
        lastPlanDone: false,
      }),
    );
    expect(container.textContent).toContain("activity.statusCleared");
    expect(container.textContent).not.toContain("✓");
  });

  it("清空且上一份声明过 done → 收尾态显示「已完成」", () => {
    render(
      strip({
        currentTodos: [],
        lastNonEmptyTodos: [{ content: "建表", status: "completed" }],
        lastPlanDone: true,
      }),
    );
    expect(container.textContent).toContain("✓");
    expect(container.textContent).toContain("activity.statusDone");
  });

  it("全完成但**未声明** done → 不显示 ✓、也不说「已完成」", () => {
    // ✓ 现在只对"模型声明结束"负责，不再等于"全部 completed"。
    // 这条挡住把它改回 `planDone = allDone` 的回归。
    render(
      strip({
        currentTodos: [
          { content: "建表", status: "completed" },
          { content: "补测试", status: "completed" },
        ],
      }),
    );
    expect(container.textContent).toContain("2/2");
    expect(container.textContent).not.toContain("✓");
    expect(container.textContent).not.toContain("activity.statusDone");
  });

  it("进行中（无 done）→ 不出现任何结束措辞", () => {
    render(
      strip({
        currentTodos: [{ content: "写迁移", status: "in_progress" }],
      }),
    );
    expect(container.textContent).toContain("写迁移");
    expect(container.textContent).not.toContain("activity.statusDone");
    expect(container.textContent).not.toContain("activity.statusCancelled");
    expect(container.textContent).not.toContain("activity.statusCleared");
  });

  // 迁移回归守卫：子代理行是 `<Button variant="ghost">`，base 的 `text-sm`（14px）/ `font-medium`
  // 与 `[&_svg]:size-4`（把 `h-3 w-3` 的状态图标顶回 16px）、缺省档的 `h-9`（36px 定高）
  // 会盖掉面板容器的 `text-xs`（元素上的类胜过继承值）—— 面板出生时这里是原生 `<button>`，
  // 四者都是继承来的。真机（Chromium + 构建 CSS）实测：行内 14px/500、图标 16px，比同一面板里
  // 的计划行（12px）还大；且 `h-9` 把三行内容（64px）压进 36px 的盒子 ⇒ 第三行溢出、被面板底边
  // 裁掉 9px（2026-10-10 用户截图报障「子代理面板字体大小不对」）。
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
  // 比 `.h-3` 高一级 ⇒ 16px）。chip 出生时这里是原生 `<button>`，四者都是继承来的。
  // 真机实测（Chromium + 构建 CSS，2026-10-10）：chip 盒 32×36px、chevron 16px、字 14px/500，
  // 而同一行左侧的状态文案是 12px/高 16px ⇒ 一枚 36px 圆钮杵在 12px 文案旁边（用户报障
  // 「子代理这个图标太高了」）；写回四条后实测 28×20px、chevron 12px、字 12px/400 == `min-h-5`。
  // ⚠️ jsdom 没有布局引擎 ⇒ 这一条钉的是「泄漏的类不在 + 写回的类都在」，几何归真机目视。
  it("chip 不继承 Button 的高度 / 字号 / 字重 / 图标尺寸", () => {
    render(
      strip({
        status: { type: "background-agent", count: 1, done: true },
        backgroundAgentRows: [row("completed")],
      }),
    );
    // 这条路径里计数由左区承载 ⇒ chip 里只剩 chevron，正是报障截图的那一帧
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
    expect(
      (chip?.className ?? "")
        .split(/\s+/)
        .filter((cls) => /^h-(?:\d|\[)/.test(cls)),
      "chip 不该带上任何数字高度档",
    ).toEqual([]);
  });
});
