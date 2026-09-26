// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import i18n from "../../renderer/i18n/config";
import { ToolUseBlock } from "../../renderer/components/message/ToolUseBlock";
import { useAppStore, type SessionState } from "../../renderer/store";
import type { Message, ToolUseContent } from "../../renderer/types";

const block: ToolUseContent = {
  type: "tool_use",
  id: "todo-1",
  name: "todo_write",
  input: {
    todos: [
      { content: "写 spec", status: "completed" },
      { content: "写计划", status: "in_progress", activeForm: "正在写计划" },
      { content: "写代码", status: "pending" },
    ],
  },
};

const message: Message = {
  id: "assistant-1",
  sessionId: "session-1",
  role: "assistant",
  timestamp: 1,
  content: [block],
};

// 照抄 src/tests/renderer/tool-use-block-agent.test.ts:32-56 的 runningSessionState()。
// 关键是它把 [message] 放进了 messages：ToolUseBlock 的 store 选择器用 `?? []` 兜底，
// 缺会话状态会每帧产生新数组 → 无限重渲染（process-summary-highlight.test.ts:35-38 记着这个坑）。
function sessionState(): SessionState {
  return {
    historyHydrated: true,
    hasMoreOlder: false,
    oldestMessageId: null,
    messages: [message],
    partialByTurn: {},
    partialMessage: "",
    partialThinking: "",
    pendingTurns: [],
    activeTurn: { turnId: "turn-1", userMessageId: "user-1" },
    executionClock: { startAt: 1, endAt: null },
    traceSteps: [],
    contextWindow: 0,
    compaction: { status: "idle" },
    retry: { active: false, attempt: 0 },
    inputQueue: [],
    steerRecords: [],
    partialToolResults: {},
    backgroundAgents: [],
    subagentActivities: {},
    currentTodos: null,
  };
}

describe("todo_write 卡片", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    await i18n.changeLanguage("zh");
    useAppStore.setState(useAppStore.getInitialState(), true);
    useAppStore.setState({ sessionStates: { "session-1": sessionState() } });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("走专用清单卡片，而不是通用工具卡", async () => {
    await act(async () => {
      root.render(
        createElement(ToolUseBlock, { block, allBlocks: [block], message }),
      );
    });
    expect(container.textContent).toContain("正在写计划"); // activeForm
    expect(container.textContent).toContain("写代码");
    // 进度计数只在专用卡片里有：通用工具卡只会把 input 原样 dump 成 JSON
    expect(container.textContent).toContain("1/3");
  });

  it("清单不合法时如实显示「未生效」，而不是冒充成已生效的清单", async () => {
    const invalid: ToolUseContent = {
      ...block,
      id: "todo-2",
      input: {
        todos: [
          { content: "先做 A", status: "in_progress" },
          { content: "先做 B", status: "in_progress" },
        ],
      },
    };
    await act(async () => {
      root.render(
        createElement(ToolUseBlock, {
          block: invalid,
          allBlocks: [invalid],
          message,
        }),
      );
    });
    expect(container.textContent).toContain("任务清单未生效");
    // 工具侧拒绝了这份清单，状态没有生效 —— 清单本体不得显示
    expect(container.textContent).not.toContain("先做 A");
    expect(container.textContent).not.toContain("0/2");
  });
});
