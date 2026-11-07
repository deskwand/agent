// @vitest-environment jsdom
//
// 概览「后台任务」是这些代理唯一展开细节的地方：行点击就地展开 / 收起（不再跳回消息区），
// 消息区那行点过来时（overviewTaskFocusId）要自动展开它、必要时展开「已完成」组、
// 并把这枚一次性的请求消费掉。

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
import type {
  SubagentActivity,
  SubagentStep,
} from "../../shared/subagent-activity";

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

function rowFor(toolCallId: string): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>(
    `button[data-bg-task="${toolCallId}"]`,
  );
}

/** 一条有步骤的代理：展开后应该能看到步骤区（SubagentSteps 的标题键）。 */
function seededActivity(
  parentToolCallId: string,
  status: SubagentActivity["status"],
): SubagentActivity {
  const step: SubagentStep = {
    id: `${parentToolCallId}-step-1`,
    toolName: "bash",
    args: { command: "npm test" },
    done: true,
    durationMs: 1200,
  };
  return { ...activity(parentToolCallId, status), steps: [step] };
}

describe("BackgroundTasksSection", () => {
  it("点行就地展开步骤，再点收起（不离开面板、不跳消息区）", async () => {
    seed({ "call-live": seededActivity("call-live", "running") });

    await act(async () => {
      root.render(<BackgroundTasksSection />);
    });

    const row = rowFor("call-live");
    expect(row).not.toBeNull();
    expect(row?.getAttribute("aria-expanded")).toBe("false");
    expect(container.textContent).not.toContain("subagent.stepsTitle");

    await act(async () => row?.click());

    expect(rowFor("call-live")?.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("subagent.stepsTitle");
    // 旧路径的证据：没有任何「跳回消息区」的请求产生
    expect(useAppStore.getState().overviewTaskFocusId).toBeNull();

    await act(async () => rowFor("call-live")?.click());
    expect(container.textContent).not.toContain("subagent.stepsTitle");
  });

  it("同一时刻只展开一条", async () => {
    seed({
      "call-a": seededActivity("call-a", "running"),
      "call-b": seededActivity("call-b", "running"),
    });

    await act(async () => {
      root.render(<BackgroundTasksSection />);
    });

    await act(async () => rowFor("call-a")?.click());
    expect(rowFor("call-a")?.getAttribute("aria-expanded")).toBe("true");

    await act(async () => rowFor("call-b")?.click());
    expect(rowFor("call-a")?.getAttribute("aria-expanded")).toBe("false");
    expect(rowFor("call-b")?.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent?.split("subagent.stepsTitle")).toHaveLength(2);
  });

  it("已结束的任务折叠在计数行后面，展开后才出现", async () => {
    seed({
      "call-done-1": activity("call-done-1", "completed"),
      "call-done-2": activity("call-done-2", "completed"),
    });

    await act(async () => {
      root.render(<BackgroundTasksSection />);
    });

    expect(container.textContent).toContain("overview.tasks.finishedCount");
    expect(rowFor("call-done-1")).toBeNull();

    const toggle = container.querySelector<HTMLButtonElement>(
      'button[aria-label="overview.tasks.finishedCount"]',
    );
    expect(toggle).not.toBeNull();
    await act(async () => toggle?.click());

    expect(rowFor("call-done-1")).not.toBeNull();
  });

  it("外部点名一条折叠在「已完成」里的任务：自动展开并消费请求", async () => {
    seed({
      "call-running": activity("call-running", "running"),
      "call-done": seededActivity("call-done", "completed"),
    });

    await act(async () => {
      root.render(<BackgroundTasksSection />);
    });
    expect(rowFor("call-done")).toBeNull();

    await act(async () => {
      useAppStore.getState().focusOverviewTask("call-done");
    });

    // 组被展开、行出现、并且它自己是展开态
    expect(rowFor("call-done")).not.toBeNull();
    expect(rowFor("call-done")?.getAttribute("aria-expanded")).toBe("true");
    // 请求是一次性的：消费后清空，重挂载不会再次强行展开
    expect(useAppStore.getState().overviewTaskFocusId).toBeNull();
  });

  it("同一条被重复点名时，收起后还能再展开", async () => {
    seed({ "call-live": seededActivity("call-live", "running") });

    await act(async () => {
      root.render(<BackgroundTasksSection />);
    });

    await act(async () => {
      useAppStore.getState().focusOverviewTask("call-live");
    });
    expect(rowFor("call-live")?.getAttribute("aria-expanded")).toBe("true");

    // 面板里收起它
    await act(async () => rowFor("call-live")?.click());
    expect(container.textContent).not.toContain("subagent.stepsTitle");

    // 消息区又点了一次同一条：必须重新展开（id 相同，靠 nonce 触发）
    await act(async () => {
      useAppStore.getState().focusOverviewTask("call-live");
    });
    expect(rowFor("call-live")?.getAttribute("aria-expanded")).toBe("true");
  });

  it("没有任务时显示空状态", async () => {
    seed({});

    await act(async () => {
      root.render(<BackgroundTasksSection />);
    });

    expect(container.textContent).toContain("overview.tasks.empty");
  });
});
