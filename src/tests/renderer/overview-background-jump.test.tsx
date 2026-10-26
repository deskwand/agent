// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
    i18n: { language: "en" },
  }),
}));

import { BackgroundTasksSection } from "../../renderer/components/overview/BackgroundTasksSection";
import { useAppStore } from "../../renderer/store";
import type { SubagentActivity } from "../../shared/subagent-activity";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function activity(
  parentToolCallId: string,
  status: SubagentActivity["status"],
): SubagentActivity {
  return {
    sessionId: "s1",
    agentId: `agent-${parentToolCallId}`,
    parentToolCallId,
    name: parentToolCallId,
    type: "general-purpose",
    description: `task ${parentToolCallId}`,
    background: true,
    status,
    steps: [],
    stats: { toolUses: 1, durationMs: 2000 },
  };
}

function seed(activities: Record<string, SubagentActivity>): void {
  useAppStore.setState({
    activeSessionId: "s1",
    sessionStates: {
      s1: {
        historyHydrated: true,
        hasMoreOlder: false,
        oldestMessageId: null,
        messages: [],
        partialByTurn: {},
        partialMessage: "",
        partialThinking: "",
        pendingTurns: [],
        activeTurn: null,
        executionClock: { startAt: null, endAt: null },
        traceSteps: [],
        contextWindow: 0,
        compaction: { status: "idle" },
        retry: { active: false, attempt: 0 },
        inputQueue: [],
        steerRecords: [],
        partialToolResults: {},
        backgroundAgents: [],
        subagentActivities: activities,
      },
    },
  } as never);
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true);
  container = document.createElement("div");
  document.body.innerHTML = "";
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("BackgroundTasksSection", () => {
  it("lists running tasks and requests a jump on click", async () => {
    seed({ "call-live": activity("call-live", "running") });

    await act(async () => {
      root.render(<BackgroundTasksSection />);
    });

    const row = container.querySelector<HTMLButtonElement>(
      'button[title="task call-live"]',
    );
    expect(row).not.toBeNull();
    await act(async () => row?.click());

    expect(useAppStore.getState().pendingFocusToolCallId).toBe("call-live");
  });

  it("collapses finished tasks behind a count row", async () => {
    seed({
      "call-done-1": activity("call-done-1", "completed"),
      "call-done-2": activity("call-done-2", "completed"),
    });

    await act(async () => {
      root.render(<BackgroundTasksSection />);
    });

    expect(container.textContent).toContain("overview.tasks.finishedCount");
    expect(container.textContent).not.toContain("task call-done-1");

    const toggle = container.querySelector<HTMLButtonElement>(
      'button[aria-label="overview.tasks.finishedCount"]',
    );
    expect(toggle).not.toBeNull();
    await act(async () => toggle?.click());

    expect(container.textContent).toContain("task call-done-1");
  });

  it("shows the empty state when nothing is running", async () => {
    seed({});

    await act(async () => {
      root.render(<BackgroundTasksSection />);
    });

    expect(container.textContent).toContain("overview.tasks.empty");
  });
});
