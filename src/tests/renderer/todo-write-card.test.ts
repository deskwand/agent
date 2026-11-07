// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import i18n from "../../renderer/i18n/config";
import { ToolUseBlock } from "../../renderer/components/message/ToolUseBlock";
import { MessageCard } from "../../renderer/components/MessageCard";
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
    lastNonEmptyTodos: null,
    currentPlanDone: false,
    lastPlanDone: false,
  };
}

describe("todo_write 卡片（只负责未生效）", () => {
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

  async function renderTodo(input: Record<string, unknown>): Promise<void> {
    const current = { ...block, input } as ToolUseContent;
    await act(async () => {
      root.render(
        createElement(ToolUseBlock, {
          block: current,
          allBlocks: [current],
          message,
        }),
      );
    });
  }

  it("生效清单不再渲染任何卡片（清单只由消息区底部的任务坞承载）", async () => {
    await renderTodo({ todos: [{ content: "建表", status: "in_progress" }] });
    expect(container.textContent).toBe("");
  });

  it("多条进行中 → 如实显示「未生效」", async () => {
    await renderTodo({
      todos: [
        { content: "先做 A", status: "in_progress" },
        { content: "先做 B", status: "in_progress" },
      ],
    });
    expect(container.textContent).toContain("任务清单未生效");
    expect(container.textContent).not.toContain("先做 A");
  });

  it("声明结束却留着未结算项 → 报「未生效」（与工具同一份规则）", async () => {
    await renderTodo({
      todos: [{ content: "只做了一半", status: "pending" }],
      done: true,
    });
    expect(container.textContent).toContain("任务清单未生效");
    expect(container.textContent).not.toContain("只做了一半");
  });

  it("空内容 → 报出第几项为空", async () => {
    await renderTodo({
      todos: [
        { content: "A", status: "pending" },
        { content: "  ", status: "pending" },
      ],
    });
    expect(container.textContent).toContain("第 2 项内容为空");
  });

  it("端到端：被拒的清单对经过 MessageCard 仍渲染出警告", async () => {
    // 上半段在 tool-display-blocks（保留成 content 块）、下半段在 ToolUseBlock（渲染警告），
    // 各自绿着并不代表拼起来还有东西 —— 这条把两半接上：任何一层过滤掉 content 里的
    // tool_use，这里就会空。
    const rejected: ToolUseContent = {
      ...block,
      id: "todo-e2e",
      input: {
        todos: [
          { content: "先做 A", status: "in_progress" },
          { content: "先做 B", status: "in_progress" },
        ],
      },
    };
    const result = {
      type: "tool_result" as const,
      toolUseId: "todo-e2e",
      content: "rejected",
      isError: true,
    };
    const whole: Message = {
      ...message,
      content: [rejected, result],
    };
    await act(async () => {
      root.render(
        createElement(MessageCard, {
          message: whole,
          allBlocks: whole.content,
        } as never),
      );
    });
    expect(container.textContent).toContain("任务清单未生效");
  });

  it("schema 级拒绝（工具报错、软规则没意见）也给一句话", async () => {
    const oversized: ToolUseContent = {
      ...block,
      id: "todo-schema",
      input: {
        todos: Array.from({ length: 51 }, (_, i) => ({
          content: `第 ${i} 项`,
          status: "pending",
        })),
      },
    };
    await act(async () => {
      root.render(
        createElement(ToolUseBlock, {
          block: oversized,
          allBlocks: [
            oversized,
            {
              type: "tool_result",
              toolUseId: "todo-schema",
              content: "schema error",
              isError: true,
            },
          ],
          message,
        }),
      );
    });
    expect(container.textContent).toContain("任务清单未生效");
  });

  it("驼峰 TodoWrite 同样只报未生效", async () => {
    const legacy = {
      ...block,
      name: "TodoWrite",
      input: {
        todos: [
          { content: "先做 A", status: "in_progress" },
          { content: "先做 B", status: "in_progress" },
        ],
      },
    } as ToolUseContent;
    await act(async () => {
      root.render(
        createElement(ToolUseBlock, {
          block: legacy,
          allBlocks: [legacy],
          message,
        }),
      );
    });
    expect(container.textContent).toContain("任务清单未生效");
  });
});
