// @vitest-environment jsdom
//
// 后台型子代理在消息区只剩一行回执：不展开、不渲染步骤、不显示「已在后台启动」那句
// 回执（它不是结果），点一下把右侧会话概览打开并选中这条。
// 前台阻塞型（background 未声明）不受影响 —— 那部分行为由 tool-use-block-agent.test.ts 守着。

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ToolUseBlock } from "../../renderer/components/message/ToolUseBlock";
import i18n from "../../renderer/i18n/config";
import { useAppStore, type SessionState } from "../../renderer/store";
import type {
  Message,
  ToolResultContent,
  ToolUseContent,
} from "../../renderer/types";
import type { SubagentActivity } from "../../shared/subagent-activity";

const block: ToolUseContent = {
  type: "tool_use",
  id: "agent-bg",
  name: "Agent",
  input: {
    subagent_type: "Explore",
    description: "Inspect message rendering",
  },
};

const message: Message = {
  id: "assistant-1",
  sessionId: "session-1",
  role: "assistant",
  timestamp: 1,
  content: [block],
};

/** 后台型的工具结果永远只是启动回执。 */
const startedResult: ToolResultContent = {
  type: "tool_result",
  toolUseId: "agent-bg",
  content: "Agent started in background. Agent ID: agent-bg",
  isError: false,
};

function sessionState(
  activity: SubagentActivity | undefined,
  traceDuration = 3,
): SessionState {
  return {
    historyHydrated: true,
    hasMoreOlder: false,
    oldestMessageId: null,
    messages: [message],
    partialByTurn: {},
    partialMessage: "",
    partialThinking: "",
    pendingTurns: [],
    activeTurn: null,
    executionClock: { startAt: 1, endAt: 2 },
    traceSteps: [
      {
        id: "agent-bg",
        type: "tool_result",
        title: "Agent",
        status: "completed",
        timestamp: 2,
        duration: traceDuration,
      },
    ],
    contextWindow: 0,
    compaction: { status: "idle" },
    retry: { active: false, attempt: 0 },
    inputQueue: [],
    steerRecords: [],
    partialToolResults: {},
    backgroundAgents: [],
    subagentActivities: activity ? { "agent-bg": activity } : {},
    currentTodos: null,
    lastNonEmptyTodos: null,
    currentPlanDone: false,
    lastPlanDone: false,
  };
}

function backgroundActivity(
  status: SubagentActivity["status"] = "running",
): SubagentActivity {
  return {
    sessionId: "session-1",
    agentId: "agent-bg",
    parentToolCallId: "agent-bg",
    name: "curie",
    type: "Explore",
    description: "Inspect message rendering",
    background: true,
    status,
    steps: [
      {
        id: "t1",
        toolName: "read",
        args: { path: "src/a.ts" },
        done: true,
        durationMs: 300,
      },
    ],
    stats: { toolUses: 1, durationMs: 12300 },
  };
}

describe("后台型子代理在消息区的回执行", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    await i18n.changeLanguage("en");
    useAppStore.setState(useAppStore.getInitialState(), true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function renderCard(activity: SubagentActivity | undefined) {
    useAppStore.setState({
      sessionStates: { "session-1": sessionState(activity) },
    });
    await act(async () => {
      root.render(
        createElement(ToolUseBlock, {
          block,
          allBlocks: [block, startedResult],
          message,
        }),
      );
    });
  }

  it("不展开、不渲染步骤，也不显示启动回执", async () => {
    await renderCard(backgroundActivity());

    const buttons = container.querySelectorAll("button");
    // 只有一行（可点的那行），没有折叠头
    expect(buttons).toHaveLength(1);
    expect(container.textContent).not.toContain("subagent.stepsTitle");
    expect(container.textContent).not.toContain("src/a.ts");
    // 「Agent started in background…」只是启动回执，不是结果
    expect(container.textContent).not.toContain("Agent started in background");
    // 名字与描述还在：这一行是唯一的说明
    expect(container.textContent).toContain("curie");
    expect(container.textContent).toContain("Inspect message rendering");
  });

  it("耗时取活动快照，不取 trace step（后台调用的 trace 只有几毫秒）", async () => {
    await renderCard(backgroundActivity("completed"));
    expect(container.textContent).toContain("12.3s");
    expect(container.textContent).not.toContain("3ms");
  });

  it("点击整行打开会话概览并选中这一条", async () => {
    await renderCard(backgroundActivity());

    await act(async () => {
      container
        .querySelector("button")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const state = useAppStore.getState();
    expect(state.rightPanelMode).toBe("overview");
    expect(state.overviewTaskFocusId).toBe("agent-bg");
  });

  it("失败的代理带失败底色", async () => {
    await renderCard(backgroundActivity("error"));
    expect(
      container.firstElementChild?.classList.contains("bg-destructive/5"),
    ).toBe(true);
  });
});
