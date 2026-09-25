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
        default:
          return key;
      }
    },
  }),
}));

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

  async function render(status: ChatInputStatus): Promise<void> {
    await act(async () =>
      root.render(React.createElement(ChatInputStatusBar, { status })),
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

  it("rows 非空时 chip 是可点的按钮，点开渲染行，点行回调带 toolCallId", () => {
    const onSelect = vi.fn();
    renderEntry(rows, onSelect);

    const chip = container.querySelector("button");
    expect(chip).not.toBeNull();
    expect(container.textContent).not.toContain("霍珀"); // 面板未开
    act(() => chip?.click());

    expect(container.textContent).toContain("霍珀");
    expect(container.textContent).toContain("居里");
    // 断言限定在该行自己的文本里，避免"页面上随便有个 3"就通过
    const row = Array.from(
      container.querySelectorAll("[role='dialog'] button"),
    ).find((el) => el.textContent?.includes("霍珀"));
    // 三行结构：名字行（带条件性类型后缀，该夹具两行类型不同）
    expect(row?.textContent).toContain("霍珀 · Explore");
    expect(row?.textContent).toContain("3");
    expect(row?.textContent).toContain("4.2s");

    act(() => {
      Array.from(container.querySelectorAll("[role='dialog'] button"))
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

  it("描述与当前动作同时可见（描述不再被动作顶掉）", () => {
    renderEntry(rows);
    act(() => container.querySelector("button")?.click());
    const row = Array.from(
      container.querySelectorAll("[role='dialog'] button"),
    ).find((el) => el.textContent?.includes("霍珀"));
    expect(row?.textContent).toContain("find bug"); // 描述
    expect(row?.textContent).toContain("read src/a.ts"); // 动作
  });

  // 守卫而非本次的判别用例：base 实现（`type · (currentLabel ?? description)`）下这条也会绿，
  // 它能挡住的是"把动作行写成 currentLabel ?? description"这类回退。
  it("没有当前动作时不渲染动作行（不与描述重复）", () => {
    renderEntry([{ ...rows[0], currentLabel: undefined }]);
    act(() => container.querySelector("button")?.click());
    const row = Array.from(
      container.querySelectorAll("[role='dialog'] button"),
    ).find((el) => el.textContent?.includes("霍珀"));
    // 描述只出现一次：动作行缺席，所以不会再出现第二遍
    expect(row?.textContent?.split("find bug")).toHaveLength(2);
  });

  // jsdom 没有布局，这里只能断言 class 与 inline 上限；"锚点上移 + max-w-full = 聊天列宽"
  // 这条架构主张靠父链保证（ChatView.tsx:1911 的 max-w-[920px] ... px-5），不在测试里验证。
  it("面板宽度按可用宽度限幅、并带滚动上限", () => {
    renderEntry(rows);
    act(() => container.querySelector("button")?.click());
    const panel = container.querySelector("[role='dialog']");
    expect(panel?.className).toContain("w-[32rem]");
    expect(panel?.className).toContain("max-w-full");
    expect(panel?.className).toContain("max-h-[min(70vh,32rem)]");
    expect(panel?.className).toContain("overflow-y-auto");
  });

  // 不变量守卫：mousedown 是外部点击关闭的判据，行内按下不能关面板。
  // 注意它**不**区分 panelRef 挂在哪——面板在 DOM 上既是外层容器也是 chip span 的后代，
  // 两种挂法 contains() 都成立（实测：把 ref 挪回 span，本用例仍绿）。
  // 它能挡的是更粗的回退：把面板移出锚点子树（例如改成 portal）却忘了同步 contains 检查。
  it("在面板内按下鼠标不会把面板当成外部点击关掉", () => {
    const onSelect = vi.fn();
    renderEntry(rows, onSelect);
    act(() => container.querySelector("button")?.click());
    const rowButton = Array.from(
      container.querySelectorAll("[role='dialog'] button"),
    ).find((el) => el.textContent?.includes("霍珀"));

    // mousedown 才是外部点击关闭的判据；它在行按钮上按下时不能关面板，
    // 否则随后的 click 落不到已卸载的节点上 → 点行变成"只关面板、不跳转"。
    act(() => {
      rowButton?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(container.querySelector("[role='dialog']")).not.toBeNull();

    act(() => {
      rowButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onSelect).toHaveBeenCalledWith("call-1");
  });

  it("按锚点上方实测可用高度给面板封顶（矮窗口不裁顶）", () => {
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
      act(() => container.querySelector("button")?.click());
      const panel = container.querySelector<HTMLElement>("[role='dialog']");
      expect(panel?.style.maxHeight).toBe("252px");
    } finally {
      HTMLElement.prototype.getBoundingClientRect = realRect;
    }
  });

  it("已完成的整行降透明度，运行中与失败的保持不变", () => {
    renderEntry([
      rows[0], // 本来就是 running
      rows[1], // 本来就是 completed
      { ...rows[1], toolCallId: "call-3", name: "欧拉", status: "error" },
    ]);
    act(() => container.querySelector("button")?.click());

    const rowFor = (name: string) =>
      Array.from(container.querySelectorAll("[role='dialog'] button")).find(
        (el) => el.textContent?.includes(name),
      );
    // 用 classList 而不是 className 子串：仓库已吃过"子串断言易恒真"的亏
    // （见 src/tests/renderer/status-popover.test.ts 的同类修订）
    expect(rowFor("霍珀")?.classList.contains("opacity-60")).toBe(false);
    expect(rowFor("居里")?.classList.contains("opacity-60")).toBe(true);
    expect(rowFor("欧拉")?.classList.contains("opacity-60")).toBe(false);
  });

  it("Escape 关面板；rows 为空时不渲染按钮", () => {
    renderEntry(rows);
    act(() => container.querySelector("button")?.click());
    expect(container.textContent).toContain("霍珀");
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

  it("只有一行时类型不显示后缀，描述仍单独成行", () => {
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
    act(() => container.querySelector("button")?.click());
    // 该夹具只有一行、类型全为 Explore → showType 为 false，行内不该出现类型
    expect(container.textContent).toContain("图灵");
    expect(container.textContent).toContain("find bug");
    expect(container.textContent).not.toContain("Explore");
  });
});
