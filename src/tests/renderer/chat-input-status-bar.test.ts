// @vitest-environment jsdom
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ChatInputStatusBar,
  type ChatInputStatus,
} from "../../renderer/components/ChatInputStatusBar";
import type { BackgroundAgentRow } from "../../renderer/utils/subagent-card";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { time?: string; n?: number }): string => {
      switch (key) {
        case "goal.elapsed":
          return `elapsed:${opts?.time ?? ""}`;
        case "goal.elapsedDone":
          return `done:${opts?.time ?? ""}`;
        case "goal.timeLessThanMinute":
          return "<1m";
        case "goal.timeMinutes":
          return `${opts?.n ?? 0}m`;
        case "goal.turn":
          return `turn:${opts?.n ?? 0}`;
        case "goal.turnsDone":
          return `turns:${opts?.n ?? 0}`;
        case "chat.elapsedRunning":
          return `running:${opts?.time ?? ""}`;
        case "chat.elapsedDone":
          return `done:${opts?.time ?? ""}`;
        default:
          return key;
      }
    },
  }),
}));

/**
 * 点开状态面板。
 * ⚠️ Radix 的 `PopoverTrigger` **只挂 `pointerdown`** ✗（不是 click ✓）——
 * 只 `.click()` 面板永远不开，失败信息是「找不到面板」，极易误判成渲染错了 ✗✗
 *（计划 9 漏了这个，7 条红 ✓）。
 * ⚠️ **条件式**补 `click` ✓（规则 9 ✗）：无条件补的话，Radix 打开后那发 click
 * 落在**内容之外** ✗ → 被它自己的 DismissableLayer 当成外部点击 → 立刻关闭 ✓✓。
 * ⇒ 这样写**对迁移前后都成立** ✓。
 */
async function openPanel(scope: HTMLElement): Promise<void> {
  // ⚠️ **必须传 container，不能在 document.body 里找第一颗按钮** ✗✗ ——
  // 实测：body 里会有**别的测试残留**的按钮 ✓（当时症状是断言里冒出主题的
  // `@keyframes gradient-flow` 与桌宠的「霍珀」✗，看起来完全无关 ✓）。
  const target = scope.querySelector("button") as HTMLButtonElement | null;
  if (!target) return;
  await act(async () => {
    target.dispatchEvent(
      new MouseEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        button: 0,
      }),
    );
  });
  if (!findPanel()) {
    await act(async () => target.click());
  }
}

/** 面板迁移后经 portal 挂在 body 下 ✗ → 查 body ✓。 */
function findPanel(): HTMLElement | null {
  return document.body.querySelector('[role="dialog"]');
}

describe("ChatInputStatusBar goal elapsed ticking", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.innerHTML = "";
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    vi.useRealTimers();
  });

  async function render(
    status: ChatInputStatus,
    executionClock?: { startAt: number | null; endAt: number | null },
  ): Promise<void> {
    await act(async () =>
      root.render(
        React.createElement(ChatInputStatusBar, { status, executionClock }),
      ),
    );
  }

  it("shows no elapsed time at goal start, then ticks within a second", async () => {
    await render({
      type: "goal-active",
      objective: "fix login",
      iteration: 1,
      timeUsedSeconds: 0,
      activePeriodStartedAt: Date.now(),
    });
    expect(container.textContent).toContain("turn:1");
    expect(container.textContent).not.toContain("elapsed:");

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(container.textContent).toContain("elapsed:<1m");

    await act(async () => {
      vi.advanceTimersByTime(70_000);
    });
    expect(container.textContent).toContain("elapsed:1m");
  });

  it("keeps ticking during a long turn without waiting for a snapshot", async () => {
    await render({
      type: "goal-active",
      objective: "fix login",
      iteration: 2,
      timeUsedSeconds: 120,
      activePeriodStartedAt: Date.now(),
    });
    expect(container.textContent).toContain("elapsed:2m");

    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(container.textContent).toContain("elapsed:3m");

    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(container.textContent).toContain("elapsed:4m");
  });

  it("uses the new anchor when switching live goals with the same snapshot", async () => {
    await render({
      type: "goal-active",
      objective: "first goal",
      iteration: 1,
      timeUsedSeconds: 0,
      activePeriodStartedAt: Date.now() - 60_000,
    });
    expect(container.textContent).toContain("elapsed:1m");

    await act(async () =>
      root.render(
        React.createElement(ChatInputStatusBar, {
          status: {
            type: "goal-active",
            objective: "second goal",
            iteration: 1,
            timeUsedSeconds: 0,
            activePeriodStartedAt: Date.now(),
          },
        }),
      ),
    );
    expect(container.textContent).not.toContain("elapsed:1m");

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(container.textContent).toContain("elapsed:<1m");
  });

  it("freezes the clock while paused", async () => {
    await render({
      type: "goal-paused",
      objective: "fix login",
      iteration: 3,
      timeUsedSeconds: 120,
    });
    expect(container.textContent).toContain("elapsed:2m");

    await act(async () => {
      vi.advanceTimersByTime(300_000);
    });
    expect(container.textContent).toContain("elapsed:2m");
  });

  it("keeps the final time frozen when complete", async () => {
    await render({
      type: "goal-complete",
      objective: "fix login",
      iteration: 5,
      timeUsedSeconds: 300,
    });
    expect(container.textContent).toContain("done:5m");

    await act(async () => {
      vi.advanceTimersByTime(120_000);
    });
    expect(container.textContent).toContain("done:5m");
  });

  it("does not jump when pausing then resuming with the same snapshot value", async () => {
    await render({
      type: "goal-active",
      objective: "fix login",
      iteration: 2,
      timeUsedSeconds: 120,
      activePeriodStartedAt: Date.now(),
    });
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(container.textContent).toContain("elapsed:3m");

    // Pause arrives: clock freezes at the snapshot
    await act(async () =>
      root.render(
        React.createElement(ChatInputStatusBar, {
          status: {
            type: "goal-paused",
            objective: "fix login",
            iteration: 2,
            timeUsedSeconds: 120,
          },
        }),
      ),
    );
    await act(async () => {
      vi.advanceTimersByTime(300_000);
    });
    expect(container.textContent).toContain("elapsed:2m");

    // Resume arrives with the same snapshot value: must NOT jump to 120+300s
    await act(async () =>
      root.render(
        React.createElement(ChatInputStatusBar, {
          status: {
            type: "goal-active",
            objective: "fix login",
            iteration: 2,
            timeUsedSeconds: 120,
            activePeriodStartedAt: Date.now(),
          },
        }),
      ),
    );
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(container.textContent).toContain("elapsed:2m"); // ~130s, not ~490s
  });

  describe("turn elapsed timer", () => {
    /** 只读可见的那一格：隐形哨兵也在 textContent 里，直接读 container 会把它们算进来。
     *  返回 null 表示这一格整个不存在（秒表没渲染）—— 与「存在但文本为空」区分开，
     *  否则 toBe("") 在元素缺失时会空过。 */
    function visibleElapsed(): string | null {
      return (
        container.querySelector('[data-testid="turn-elapsed-visible"]')
          ?.textContent ?? null
      );
    }

    it("ticks the running time once per second", async () => {
      const t0 = Date.now();
      await render({ type: "thinking" }, { startAt: t0, endAt: null });
      expect(visibleElapsed()).toBe("running:0s");
      await act(async () => {
        vi.advanceTimersByTime(12_000);
      });
      expect(visibleElapsed()).toBe("running:12s");
    });

    it("shows the frozen time for 5s after the run ends, then hides it", async () => {
      const t0 = Date.now();
      await render({ type: "thinking" }, { startAt: t0, endAt: null });
      await act(async () => {
        vi.advanceTimersByTime(12_000);
      });
      // 这一轮在第 12s 结束
      await render({ type: "thinking" }, { startAt: t0, endAt: t0 + 12_000 });
      expect(visibleElapsed()).toBe("done:12s");

      await act(async () => {
        vi.advanceTimersByTime(4_000);
      });
      expect(visibleElapsed()).toBe("done:12s");

      // 第 5 秒起不再显示
      await act(async () => {
        vi.advanceTimersByTime(1_000);
      });
      expect(visibleElapsed()).toBeNull();
    });

    it("shows nothing without a clock or without an origin", async () => {
      await render({ type: "thinking" });
      expect(visibleElapsed()).toBeNull();

      await render({ type: "thinking" }, { startAt: null, endAt: null });
      expect(visibleElapsed()).toBeNull();

      await render({ type: "thinking" }, { startAt: Date.now(), endAt: null });
      expect(visibleElapsed()).toBe("running:0s");
    });

    it("shows the frozen time once the status has resolved to null", async () => {
      const t0 = Date.now();
      await render({ type: "thinking" }, { startAt: t0, endAt: null });
      await act(async () => {
        vi.advanceTimersByTime(8_000);
      });
      // 真实路径：回合结束后 canStop 转假 → resolveInputStatus 返回 null，
      // 左区没有文案，只剩冻结的「本轮耗时」（不带 "· " 分隔符）。
      await render(null, { startAt: t0, endAt: t0 + 8_000 });
      expect(visibleElapsed()).toBe("done:8s");
      expect(container.textContent).not.toContain("· done:");
    });

    it("does not add a second timer next to the goal clock", async () => {
      await render(
        {
          type: "goal-active",
          objective: "fix login",
          iteration: 1,
          timeUsedSeconds: 0,
          activePeriodStartedAt: Date.now(),
        },
        { startAt: Date.now(), endAt: null },
      );
      expect(visibleElapsed()).toBeNull();
      // goal 分支是提前 return 的，槽位也不应存在
      expect(
        container.querySelectorAll('[data-testid="turn-elapsed-slot"]'),
      ).toHaveLength(0);
    });

    it("keeps the slot in the DOM so the chip never moves", async () => {
      await render({ type: "thinking" }, { startAt: Date.now(), endAt: null });
      const slots = container.querySelectorAll(
        '[data-testid="turn-elapsed-slot"]',
      );
      // 只一个哨兵。第二个（用「本轮耗时」文案的）实测会让槽位从 85.297px
      // 涨到 97.30px（叠格子格被 stretch 到列宽 = 最宽子格），留白永远贴不到 0；
      // 而它买不到任何东西：运行期与收尾期的盒宽本来都是常量。详见设计文档。
      expect(slots).toHaveLength(1);
      expect(slots[0].getAttribute("aria-hidden")).toBe("true");
      expect(slots[0].textContent).toBe("running:10h00m");
      // 可见格只有一格，且不参与哨兵
      expect(
        container.querySelectorAll('[data-testid="turn-elapsed-visible"]'),
      ).toHaveLength(1);
    });

    it("keeps the slot content constant across a band boundary", async () => {
      const t0 = Date.now();
      await render({ type: "thinking" }, { startAt: t0, endAt: null });

      const slotText = () =>
        container.querySelector('[data-testid="turn-elapsed-slot"]')
          ?.textContent ?? null;

      // 关键：断言槽位的「具体内容」，不是「前后相等」。
      // 槽位内容与 elapsed 无关，写成 after === before 是套路的 ——
      // 把整个槽位机制删掉后两边都是空串，照样通过。
      expect(visibleElapsed()).toBe("running:0s");
      expect(slotText()).toBe("running:10h00m");

      await act(async () => {
        vi.advanceTimersByTime(10_000);
      });
      // 9s → 10s 是 +7.20px 的跨档（比例宽度时代最疼的一次之一）
      expect(visibleElapsed()).toBe("running:10s");
      expect(slotText()).toBe("running:10h00m");
    });

    it("does not render the slot without a clock", async () => {
      await render({ type: "thinking" });
      expect(
        container.querySelectorAll('[data-testid="turn-elapsed-slot"]'),
      ).toHaveLength(0);
    });
  });

  // 迁移回归守卫：三个 goal 小按钮是 `<Button variant="ghost">`，base 的 `font-medium`（500）
  // 无条件盖掉了它们从 `body`（400，globals.css:746）继承来的字重 —— 迁移前它们是原生
  // `<button>`、className 里没有任何字重类。11px 的胶囊用 500、夹在 12px/400 的状态文字里
  // 会显粗（2026-10-10 与面板行 / chip 同一批报障）。
  // ⚠️ jsdom 没有布局 ⇒ 这里钉的是「`font-medium` 不在」（真机制：`cn` 把它整条删掉），
  // **不是**「量出来是 400」—— 两条字重类同时在场时按样式表顺序也能量出 400（假绿）。
  it("goal 小按钮不继承 Button 的 500 字重", async () => {
    // 两种状态合起来覆盖三个按钮：active 有「暂停」；paused 有「继续」+「清除」。
    const cases: { status: ChatInputStatus; labels: string[] }[] = [
      {
        status: { type: "goal-active", objective: "fix login", iteration: 2 },
        labels: ["goal.pause"],
      },
      {
        status: { type: "goal-paused", objective: "fix login", iteration: 2 },
        labels: ["goal.resume", "goal.clear"],
      },
    ];
    for (const { status, labels } of cases) {
      await act(async () => {
        root.render(
          React.createElement(ChatInputStatusBar, {
            status,
            currentTodos: null,
            currentPlanDone: false,
            lastNonEmptyTodos: null,
            lastPlanDone: false,
            backgroundAgentRows: [],
            onGoalCommand: vi.fn(),
          }),
        );
      });
      // 按文案定位（本文件的 `t` mock 对未知 key 返回 key ⇒ 文案就是 “goal.pause” 那几个）：
      // 按索引取会把「将来多一个按钮」误判成回归。
      const buttons = Array.from(container.querySelectorAll("button")).filter(
        (b) => labels.includes(b.textContent ?? ""),
      );
      // 「一个都没漏」比「至少有一个」重要：三处 className 是复制粘贴出来的，漏改一处就会静默变粗
      expect(
        buttons.map((b) => b.textContent),
        "按文案定位到的按钮",
      ).toEqual(labels);
      for (const button of buttons) {
        expect(
          button.classList.contains("font-normal"),
          String(button.textContent),
        ).toBe(true);
        expect(
          button.classList.contains("font-medium"),
          String(button.textContent),
        ).toBe(false);
      }
    }
  });
});

describe("background subagent entry", () => {
  let container: HTMLDivElement;
  let root: Root;

  const rows = [
    {
      toolCallId: "call-1",
      name: "霍珀",
      type: "Explore",
      description: "find bug",
      status: "running" as const,
      currentLabel: "read src/a.ts",
      stepCount: 3,
      durationMs: 4200,
    },
    {
      toolCallId: "call-2",
      name: "居里",
      type: "Plan",
      description: "draft plan",
      status: "completed" as const,
      currentLabel: "bash npm test",
      stepCount: 9,
      durationMs: 6800,
    },
  ];

  beforeEach(() => {
    container = document.createElement("div");
    document.body.innerHTML = "";
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
  });

  function renderEntry(
    backgroundAgentRows: BackgroundAgentRow[],
    onSelect = vi.fn(),
  ): void {
    act(() => {
      root.render(
        React.createElement(ChatInputStatusBar, {
          status: { type: "background-agent", count: 1, done: false },
          backgroundAgentRows,
          onSelectBackgroundAgent: onSelect,
        }),
      );
    });
  }

  it("rows 非空时 chip 是可点的按钮，点开渲染行，点行回调带 toolCallId", async () => {
    const onSelect = vi.fn();
    renderEntry(rows, onSelect);

    const chip = container.querySelector("button");
    expect(chip).not.toBeNull();
    expect(container.textContent).not.toContain("霍珀"); // 面板未开
    await openPanel(container);

    // 面板经 portal 挂在 body 下 → 面板文案只能从 body 读（与下面各行的口径一致）
    expect(document.body.textContent).toContain("霍珀");
    expect(document.body.textContent).toContain("居里");
    // 断言限定在该行自己的文本里，避免"页面上随便有个 3"就通过
    const row = Array.from(
      document.body.querySelectorAll("[role='dialog'] button"),
    ).find((el) => el.textContent?.includes("霍珀"));
    // 三行结构：名字行（带条件性类型后缀，该夹具两行类型不同）
    expect(row?.textContent).toContain("霍珀 · Explore");
    expect(row?.textContent).toContain("3");
    expect(row?.textContent).toContain("4.2s");

    act(() => {
      Array.from(document.body.querySelectorAll("[role='dialog'] button"))
        .find((el) => el.textContent?.includes("霍珀"))
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onSelect).toHaveBeenCalledWith("call-1");
  });

  it("全部结束但有失败时，chip 文案不说「已完成」", () => {
    act(() => {
      root.render(
        React.createElement(ChatInputStatusBar, {
          status: {
            type: "background-agent",
            count: 2,
            done: true,
            hasError: true,
          },
          backgroundAgentRows: [{ ...rows[1], status: "error" as const }],
          onSelectBackgroundAgent: vi.fn(),
        }),
      );
    });
    expect(container.textContent).toContain(
      "subagent.statusFinishedWithErrors",
    );
    expect(container.textContent).not.toContain("subagent.statusDone");
  });

  it("描述与当前动作同时可见（描述不再被动作顶掉）", async () => {
    renderEntry(rows);
    await openPanel(container);
    const row = Array.from(
      document.body.querySelectorAll("[role='dialog'] button"),
    ).find((el) => el.textContent?.includes("霍珀"));
    expect(row?.textContent).toContain("find bug"); // 描述
    expect(row?.textContent).toContain("read src/a.ts"); // 动作
  });

  // 守卫而非本次的判别用例：base 实现（`type · (currentLabel ?? description)`）下这条也会绿，
  // 它能挡住的是"把动作行写成 currentLabel ?? description"这类回退。
  it("没有当前动作时不渲染动作行（不与描述重复）", async () => {
    renderEntry([{ ...rows[0], currentLabel: undefined }]);
    await openPanel(container);
    const row = Array.from(
      document.body.querySelectorAll("[role='dialog'] button"),
    ).find((el) => el.textContent?.includes("霍珀"));
    // 描述只出现一次：动作行缺席，所以不会再出现第二遍
    expect(row?.textContent?.split("find bug")).toHaveLength(2);
  });

  // jsdom 没有布局，这里只能断言 class 与 inline 上限；"锚点上移 + max-w-full = 聊天列宽"
  // 这条架构主张靠父链保证（ChatView 尾部的 max-w-[57.5rem] 容器 … px-5），不在测试里验证。
  it("面板宽度按可用宽度限幅、并带滚动上限", async () => {
    renderEntry(rows);
    await openPanel(container);
    const panel = findPanel();
    expect(panel?.className).toContain("w-[32rem]");
    expect(panel?.className).toContain("max-w-full");
    expect(panel?.className).toContain("max-h-[min(70vh,32rem)]");
    expect(panel?.className).toContain("overflow-y-auto");
  });

  // 外壳契约：面板必须用 vendored `PopoverContent` 自己的契约（实色底 + 入场动画），
  // 而不是本仓内联外壳 —— 判据与 `status-popover.test.ts` 同源（那次迁移定下的口径），
  // 只是载体不同。逐 token 用 classList 断言，不用字符串 includes：
  // `hover:bg-accent` 那类子串会让 toContain 恒真。
  it("面板外壳走 vendored PopoverContent（bg-popover + 入场动画，无内联外壳）", async () => {
    renderEntry(rows);
    await openPanel(container);
    const panel = findPanel();

    expect(panel?.classList.contains("data-[state=open]:animate-in")).toBe(
      true,
    );
    expect(panel?.classList.contains("bg-popover")).toBe(true);
    expect(panel?.classList.contains("rounded-md")).toBe(true);

    // 旧内联外壳（MENU_PANEL_CLASS）的三个特征必须消失
    expect(panel?.classList.contains("rounded-xl")).toBe(false);
    expect(panel?.classList.contains("bg-background")).toBe(false);
    expect(panel?.classList.contains("shadow-elevated")).toBe(false);

    // 「丢能力」那一侧：vendored 自带 `p-4`，本面板靠 `p-1` 保住行几何
    //（分区标题自己还有 px-2）。若哪天忘了压住 p-4，上面几条会全绿而内边距无声变成 16px。
    expect(panel?.classList.contains("p-1")).toBe(true);
    expect(panel?.classList.contains("p-4")).toBe(false);
  });

  // 不变量守卫：mousedown 是外部点击关闭的判据，行内按下不能关面板。
  // 注意它**不**区分 panelRef 挂在哪——面板在 DOM 上既是外层容器也是 chip span 的后代，
  // 两种挂法 contains() 都成立（实测：把 ref 挪回 span，本用例仍绿）。
  // 它能挡的是更粗的回退：把面板移出锚点子树（例如改成 portal）却忘了同步 contains 检查。
  it("在面板内按下鼠标不会把面板当成外部点击关掉", async () => {
    const onSelect = vi.fn();
    renderEntry(rows, onSelect);
    await openPanel(container);
    const rowButton = Array.from(
      document.body.querySelectorAll("[role='dialog'] button"),
    ).find((el) => el.textContent?.includes("霍珀"));

    // mousedown 才是外部点击关闭的判据；它在行按钮上按下时不能关面板，
    // 否则随后的 click 落不到已卸载的节点上 → 点行变成"只关面板、不跳转"。
    act(() => {
      rowButton?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(findPanel()).not.toBeNull();

    act(() => {
      rowButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onSelect).toHaveBeenCalledWith("call-1");
  });

  it("按锚点上方实测可用高度给面板封顶（矮窗口不裁顶）", async () => {
    const realRect = HTMLElement.prototype.getBoundingClientRect;
    // 模拟锚点距窗口顶部仅 300px：可用高度应被算成 300 - 48 = 252
    HTMLElement.prototype.getBoundingClientRect = function () {
      return {
        top: 300,
        bottom: 320,
        left: 0,
        right: 0,
        width: 0,
        height: 20,
        x: 0,
        y: 300,
        toJSON: () => ({}),
      } as DOMRect;
    };
    try {
      renderEntry(rows);
    await openPanel(container);
      const panel = findPanel();
      expect(panel?.style.maxHeight).toBe("252px");
    } finally {
      HTMLElement.prototype.getBoundingClientRect = realRect;
    }
  });

  it("已完成的整行降透明度，运行中与失败的保持不变", async () => {
    renderEntry([
      rows[0], // 本来就是 running
      rows[1], // 本来就是 completed
      { ...rows[1], toolCallId: "call-3", name: "欧拉", status: "error" },
    ]);
    await openPanel(container);

    const rowFor = (name: string) =>
      Array.from(document.body.querySelectorAll("[role='dialog'] button")).find(
        (el) => el.textContent?.includes(name),
      );
    // 用 classList 而不是 className 子串：仓库已吃过"子串断言易恒真"的亏
    // （见 src/tests/renderer/status-popover.test.ts 的同类修订）
    expect(rowFor("霍珀")?.classList.contains("opacity-60")).toBe(false);
    expect(rowFor("居里")?.classList.contains("opacity-60")).toBe(true);
    expect(rowFor("欧拉")?.classList.contains("opacity-60")).toBe(false);
  });

  it("Escape 关面板；rows 为空时不渲染按钮", async () => {
    renderEntry(rows);
    await openPanel(container);
    expect(document.body.textContent).toContain("霍珀");
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(container.textContent).not.toContain("read src/a.ts");

    renderEntry([]);
    expect(container.querySelector("button")).toBeNull();
  });
});

describe("background subagent entry single row", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.innerHTML = "";
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
  });

  it("只有一行时类型不显示后缀，描述仍单独成行", async () => {
    act(() => {
      root.render(
        React.createElement(ChatInputStatusBar, {
          status: { type: "background-agent", count: 1, done: false },
          backgroundAgentRows: [
            {
              toolCallId: "call-9",
              name: "图灵",
              type: "Explore",
              description: "find bug",
              status: "running",
              stepCount: 0,
              durationMs: 0,
            },
          ],
          onSelectBackgroundAgent: vi.fn(),
        }),
      );
    });
    await openPanel(container);
    // 该夹具只有一行、类型全为 Explore → showType 为 false，行内不该出现类型
    expect(document.body.textContent).toContain("图灵");
    expect(document.body.textContent).toContain("find bug");
    expect(container.textContent).not.toContain("Explore");
  });
});
