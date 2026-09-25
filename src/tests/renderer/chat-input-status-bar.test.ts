// @vitest-environment jsdom
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ChatInputStatusBar,
  type ChatInputStatus,
} from "../../renderer/components/ChatInputStatusBar";

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
    backgroundAgentRows: typeof rows,
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
    expect(row?.textContent).toContain("Explore · read src/a.ts");
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

describe("background subagent entry row fallback", () => {
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

  it("还没有任何步骤时，第二行回落显示任务描述", () => {
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
    expect(container.textContent).toContain("Explore · find bug");
  });
});
