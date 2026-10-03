// @vitest-environment jsdom
//
// 回归：未登记的工具名（模型幻觉出的名字、漏归类的新工具）必须被过程摘要包住，
// 不能渲染成摘要之外的裸行。真实会话：DeskWand 2026-10-03 的一次
// `codemodedeclaration_placeholder` 调用 —— 该名字来自模型，工具的归类清单里没有它。
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MessageCard } from "../../renderer/components/MessageCard";
import i18n from "../../renderer/i18n/config";
import { useAppStore } from "../../renderer/store";
import type { ContentBlock, Message } from "../../renderer/types";

const UNKNOWN_TOOL = "codemodedeclaration_placeholder";
const UNKNOWN_ERROR = `Tool ${UNKNOWN_TOOL} not found`;

const content: ContentBlock[] = [
  { type: "tool_use", id: "bash-1", name: "bash", input: { command: "ls" } },
  { type: "tool_result", toolUseId: "bash-1", content: "ok" },
  { type: "tool_use", id: "bad-1", name: UNKNOWN_TOOL, input: {} },
  {
    type: "tool_result",
    toolUseId: "bad-1",
    content: UNKNOWN_ERROR,
    isError: true,
  },
];

const message: Message = {
  id: "m1",
  sessionId: "s1",
  role: "assistant",
  timestamp: 1,
  turnId: "t1",
  content,
};

describe("unknown tool name stays inside the tool group", () => {
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
    act(() => root.render(createElement(MessageCard, { message })));
  }

  it("折叠时只显示摘要行与失败标记，展开后才是工具行", () => {
    render();

    // 折叠态：失败行不占正文位置，名字与错误文本都不该出现。
    expect(container.textContent).not.toContain(UNKNOWN_TOOL);
    const failure = container.querySelector<HTMLButtonElement>(
      "[data-tool-group-failure]",
    );
    expect(failure).not.toBeNull();

    // 相邻的 bash 调用与这次未登记调用合成**同一行**摘要（这是"把摘要切成两段"
    // 的服务端症状在 UI 层的勒线）。
    expect(container.textContent).toContain(
      "已执行了 1 条命令 并 已使用 1 个工具",
    );

    act(() => failure?.click());

    // 展开后工具行出现在摘要组内部（同一个节点树里），错误文本可见。
    expect(container.textContent).toContain(UNKNOWN_TOOL);
    expect(container.textContent).toContain(UNKNOWN_ERROR);
  });
});
