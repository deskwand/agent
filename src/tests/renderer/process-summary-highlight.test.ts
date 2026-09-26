// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProcessSummaryBlock } from "../../renderer/components/message/ProcessSummaryBlock";
import i18n from "../../renderer/i18n/config";
import { useAppStore } from "../../renderer/store";
import type { ProcessSummaryDisplayBlock } from "../../renderer/utils/tool-display-blocks";
import type { Message } from "../../renderer/types";

const block = {
  type: "process-summary",
  items: [
    {
      id: "call-1",
      type: "tool_use",
      name: "Agent",
      input: { subagent_type: "Explore", description: "find bug" },
    },
  ],
  summary: {
    readCount: 0,
    hasSearch: false,
    hasWebSearch: false,
    hasBrowse: false,
    hasMemory: false,
    commandCount: 0,
    subagentCount: 1,
    subagents: [{ name: "Explore", description: "find bug" }],
    hasGoal: false,
    usedToolCount: 0,
  },
} as unknown as ProcessSummaryDisplayBlock;

// 展开后 PSB 会渲染 ToolUseBlock，而它要读会话状态（既有实现用 `?? []` 兜底，
// 未提供 message/会话时会每帧产生新数组 → 无限重渲染）。所以这里按既有测试的
// 方式把 message 与最小会话状态备好，而不是去动那段既有代码。
const message: Message = {
  id: "m1",
  sessionId: "s1",
  role: "assistant",
  timestamp: 1,
  content: block.items,
};

describe("ProcessSummaryBlock highlight and expand", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    await i18n.changeLanguage("zh");
    useAppStore.setState(useAppStore.getInitialState(), true);
    useAppStore.setState({
      sessionStates: {
        s1: {
          historyHydrated: true,
          hasMoreOlder: false,
          oldestMessageId: null,
          messages: [message],
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
          subagentActivities: {},
          currentTodos: null,
          lastNonEmptyTodos: null,
          currentPlanDone: false,
          lastPlanDone: false,
        },
      },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(): void {
    act(() =>
      root.render(
        createElement(ProcessSummaryBlock, {
          block,
          allBlocks: block.items,
          message,
        }),
      ),
    );
  }

  it("命中待展开时自动展开并消费掉，高亮时摘要行带 ring", () => {
    useAppStore.setState({ pendingExpandToolCallId: "call-1" });
    render();

    // 摘要行自己的 aria-expanded 就是展开态。不要数 button：卡片里以后可能多出按钮。
    const summaryButton = container.querySelector("button[aria-expanded]");
    expect(summaryButton?.getAttribute("aria-expanded")).toBe("true");
    // 一次性消费：字段被清空
    expect(useAppStore.getState().pendingExpandToolCallId).toBeNull();

    act(() => {
      useAppStore.setState({ highlightedToolCallId: "call-1" });
    });
    expect(container.querySelector(".ring-2")).not.toBeNull();
  });

  it("不命中时不展开、也不带 ring", () => {
    useAppStore.setState({ pendingExpandToolCallId: "other" });
    render();

    const summaryButton = container.querySelector("button[aria-expanded]");
    expect(summaryButton?.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector(".ring-2")).toBeNull();
    // 没被消费：留着给真正命中的那条
    expect(useAppStore.getState().pendingExpandToolCallId).toBe("other");
  });

  it("展开后仍渲染该次调用的清单卡", () => {
    const items = [
      {
        id: "call-todo",
        type: "tool_use" as const,
        name: "todo_write",
        input: { todos: [{ content: "建表", status: "in_progress" }] },
      },
    ];
    const todoBlock = {
      type: "process-summary",
      items,
      summary: {
        ...block.summary,
        subagentCount: 0,
        subagents: [],
        todoUpdateCount: 1,
      },
    } as unknown as ProcessSummaryDisplayBlock;

    act(() =>
      root.render(
        createElement(ProcessSummaryBlock, {
          block: todoBlock,
          allBlocks: items,
          message: { ...message, content: items },
        }),
      ),
    );

    // 折叠态：片段里只有“已更新 1 次任务清单”，看不到清单项内容
    expect(container.textContent).not.toContain("建表");

    act(() => {
      container
        .querySelector<HTMLButtonElement>("button[aria-expanded]")
        ?.click();
    });
    expect(container.textContent).toContain("建表");
  });
});
