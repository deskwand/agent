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
