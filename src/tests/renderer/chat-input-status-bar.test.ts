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
import { useAppStore } from "../../renderer/store";

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

// 输入框上方只留一枚计数 chip：列表与细节都在右侧会话概览里（原来那份 popover
// 与概览面板内容完全重复，点行也只是跳回消息区）。这里守住三条不变量：
// 计数可见 / 失败上色 / 点击把面板打开并选中在跑的那条。
describe("background subagent entry", () => {
  let container: HTMLDivElement;
  let root: Root;

  const rows: BackgroundAgentRow[] = [
    {
      toolCallId: "call-1",
      name: "霍珀",
      type: "Explore",
      description: "find bug",
      status: "running",
      currentLabel: "read src/a.ts",
      stepCount: 3,
      durationMs: 4200,
    },
    {
      toolCallId: "call-2",
      name: "居里",
      type: "Plan",
      description: "draft plan",
      status: "completed",
      currentLabel: "bash npm test",
      stepCount: 9,
      durationMs: 6800,
    },
  ];

  beforeEach(() => {
    useAppStore.setState(useAppStore.getInitialState(), true);
    container = document.createElement("div");
    document.body.innerHTML = "";
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
  });

  function renderEntry(backgroundAgentRows: BackgroundAgentRow[]): void {
    act(() => {
      root.render(
        React.createElement(ChatInputStatusBar, {
          status: { type: "background-agent", count: 1, done: false },
          backgroundAgentRows,
        }),
      );
    });
  }

  it("只渲染计数 chip，不再就地弹列表", () => {
    renderEntry(rows);

    const chip = container.querySelector("button");
    expect(chip).not.toBeNull();
    expect(chip?.textContent).toContain("activity.subagents");
    // 名字、描述、动作都不在这枚 chip 里
    expect(container.textContent).not.toContain("霍珀");
    expect(container.textContent).not.toContain("read src/a.ts");
  });

  it("点击打开会话概览，并选中在跑的那条", async () => {
    renderEntry(rows);

    await act(async () => {
      container
        .querySelector("button")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const state = useAppStore.getState();
    expect(state.rightPanelMode).toBe("overview");
    // 优先落点在跑的，不是列表第一条
    expect(state.overviewTaskFocusId).toBe("call-1");
  });

  it("全部结束且有失败时 chip 换成失败色", () => {
    renderEntry([{ ...rows[1], status: "error" }]);

    const count = container.querySelector("span.text-destructive");
    expect(count, "计数应带失败色").toBeTruthy();
    expect(count?.textContent).toContain("activity.subagents");
  });

  it("没有后台行时整行不渲染", () => {
    renderEntry([]);
    expect(container.querySelector("button")).toBeNull();
  });
});
