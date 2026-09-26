// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ToolUseBlock } from "../../renderer/components/message/ToolUseBlock";
import i18n from "../../renderer/i18n/config";
import { useAppStore, type SessionState } from "../../renderer/store";
import type {
  ContentBlock,
  Message,
  ToolResultContent,
  ToolUseContent,
} from "../../renderer/types";

const AGENT_ID = "9c5ae021-6450-400";

function sessionState(extra: Partial<SessionState> = {}): SessionState {
  return {
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
    subagentActivities: {
      "call-1": {
        sessionId: "s1",
        agentId: AGENT_ID,
        parentToolCallId: "call-1",
        name: "hopper",
        status: "completed",
        steps: [],
        stats: { toolUses: 0, durationMs: 0 },
      },
    },
    currentTodos: null,
    lastNonEmptyTodos: null,
    ...extra,
  };
}

function renderCard(block: ToolUseContent, result: string) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const message: Message = {
    id: "m1",
    sessionId: "s1",
    role: "assistant",
    timestamp: 1,
    content: [block],
  };
  const resultBlock: ToolResultContent = {
    type: "tool_result",
    toolUseId: block.id,
    content: result,
    isError: false,
  };
  const allBlocks: ContentBlock[] = [block, resultBlock];
  act(() => {
    root.render(createElement(ToolUseBlock, { block, allBlocks, message }));
  });
  act(() => {
    container.querySelector("button")?.click();
  });
  return { container, root };
}

describe("subagent tool cards", () => {
  let roots: Root[] = [];

  beforeEach(async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    await i18n.changeLanguage("zh");
    useAppStore.setState(useAppStore.getInitialState(), true);
    useAppStore.setState({ sessionStates: { s1: sessionState() } });
  });

  afterEach(() => {
    roots.forEach((root) => act(() => root.unmount()));
    roots = [];
    document.body.innerHTML = "";
  });

  it("get_subagent_result 输入区不显示 JSON，且把 id 换成名字", () => {
    const block: ToolUseContent = {
      type: "tool_use",
      id: "call-1",
      name: "get_subagent_result",
      input: { agent_id: AGENT_ID },
    };
    const { container, root } = renderCard(block, "Agent: x\n\n报告");
    roots.push(root);
    const text = container.textContent ?? "";
    expect(text).toContain("查询 霍珀 的结果");
    expect(text).not.toContain("{");
  });

  it("steer_subagent 输入区显示名字与消息正文", () => {
    const block: ToolUseContent = {
      type: "tool_use",
      id: "call-2",
      name: "steer_subagent",
      input: { agent_id: AGENT_ID, message: "只统计前 12 个扩展\n然后给表格" },
    };
    const { container, root } = renderCard(block, "Sent to @hopper");
    roots.push(root);
    const text = container.textContent ?? "";
    expect(text).toContain("给 霍珀 发消息");
    expect(text).toContain("只统计前 12 个扩展");
    // 第二行也要在：正文块用的是 whitespace-pre-wrap，换行不能丢
    expect(text).toContain("然后给表格");
    expect(text).not.toContain("{");
  });

  it("输出拆出元信息头，正文按 Markdown 渲染", () => {
    const block: ToolUseContent = {
      type: "tool_use",
      id: "call-1",
      name: "get_subagent_result",
      input: { agent_id: AGENT_ID },
    };
    const { container, root } = renderCard(
      block,
      "Agent: " +
        AGENT_ID +
        "\nType: general-purpose | Status: completed\n\n**报告标题**\n- 一条",
    );
    roots.push(root);
    // `**粗体**` 能推出 <strong>：足以证明正文走了 Markdown 而不是 <pre>
    expect(container.querySelector("strong")?.textContent).toBe("报告标题");
    expect(container.textContent).toContain("Type: general-purpose");
    expect(container.querySelector("pre")).toBeNull();
    // 关键：头部必须**在 Markdown 容器之外**，否则这条用例在“忘了拆分”时也会绿
    // （MessageMarkdown 的根节点带 .prose-chat）
    expect(container.querySelector(".prose-chat")?.textContent).not.toContain(
      "Type:",
    );
  });

  it("非元信息输出（steer 回执）整块走 Markdown，不生成头部块", () => {
    const block: ToolUseContent = {
      type: "tool_use",
      id: "call-2",
      name: "steer_subagent",
      input: { agent_id: "hopper", message: "继续" },
    };
    const { container, root } = renderCard(block, "Sent to @hopper");
    roots.push(root);
    const text = container.textContent ?? "";
    expect(text).toContain("Sent to @hopper");
    // 这两条才是真正区分改前/改后的：改前输出落在 <pre> 里，也没有 handle 解析
    expect(container.querySelector("pre")).toBeNull();
    expect(text).toContain("给 霍珀 发消息");
  });
});
