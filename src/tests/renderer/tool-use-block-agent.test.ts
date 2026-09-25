// @vitest-environment jsdom
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
  id: "agent-1",
  name: "Agent",
  input: {
    subagent_type: "Explore",
    description: "Inspect message rendering",
    prompt: "A much longer task prompt that should not be displayed",
  },
};

const message: Message = {
  id: "assistant-1",
  sessionId: "session-1",
  role: "assistant",
  timestamp: 1,
  content: [block],
};

function runningSessionState(): SessionState {
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
  };
}

describe("ToolUseBlock Agent summary", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    await i18n.changeLanguage("en");
    useAppStore.setState(useAppStore.getInitialState(), true);
    useAppStore.setState({
      sessionStates: { "session-1": runningSessionState() },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  function activity(status: SubagentActivity["status"]): SubagentActivity {
    return {
      sessionId: "session-1",
      agentId: "agent-1",
      parentToolCallId: "agent-1",
      status,
      steps: [],
      stats: { toolUses: 1, durationMs: 10 },
    };
  }

  /** 已返回的 Agent 工具结果——后台型调用永远是这个结果。 */
  const startedResult: ToolResultContent = {
    type: "tool_result",
    toolUseId: "agent-1", // 必须是 toolUseId：findToolResult 比的就是它
    content: "Agent started in background. Agent ID: agent-1",
    isError: false,
  };

  async function renderCard(
    status: SubagentActivity["status"] | undefined,
    result: ToolResultContent = startedResult,
  ): Promise<void> {
    useAppStore.setState({
      sessionStates: {
        "session-1": {
          ...runningSessionState(),
          subagentActivities: status ? { "agent-1": activity(status) } : {},
        },
      },
    });
    await act(async () => {
      root.render(
        createElement(ToolUseBlock, {
          block,
          allBlocks: [block, result],
          message,
        }),
      );
    });
  }

  /** 头部那个 button（内部步骤区在它之后，作用域能干净地区分两者）。 */
  const header = () => container.querySelector("button");
  const cardRoot = () => container.firstElementChild;

  it("工具结果已返回但子代理仍在跑时，头部显示进行中而不是 ✓", async () => {
    await renderCard("running");
    expect(header()).not.toBeNull(); // 否则下面的 not.toBeNull() 在 header 缺失时也会通过
    expect(header()?.querySelector(".animate-spin")).not.toBeNull();
    expect(cardRoot()?.classList.contains("bg-accent/5")).toBe(true);
  });

  it("快照为 error 时头部显示失败", async () => {
    await renderCard("error");
    expect(header()).not.toBeNull();
    expect(header()?.querySelector(".animate-spin")).toBeNull();
    // 底色与图标出自同一个三元，这里留着是因为它让本条成为"修前也红"的判别用例
    expect(cardRoot()?.classList.contains("bg-error/5")).toBe(true);
  });

  it("工具调用自身失败时优先显示失败（不被快照的 running 掩盖）", async () => {
    await renderCard("running", { ...startedResult, isError: true });
    expect(header()?.querySelector(".animate-spin")).toBeNull();
  });

  it("没有快照时回落旧规则：结果已返回即视为完成", async () => {
    await renderCard(undefined);
    expect(header()).not.toBeNull();
    expect(header()?.querySelector(".animate-spin")).toBeNull();
  });

  it("没有快照且工具结果未返回时，回落规则仍显示进行中（回落-运行方向）", async () => {
    useAppStore.setState({
      sessionStates: {
        "session-1": {
          ...runningSessionState(),
          subagentActivities: {},
        },
      },
    });
    await act(async () => {
      // 注意：allBlocks 里**没有** tool_result
      root.render(
        createElement(ToolUseBlock, { block, allBlocks: [block], message }),
      );
    });
    expect(header()).not.toBeNull();
    expect(header()?.querySelector(".animate-spin")).not.toBeNull();
  });

  it("shows the subagent name and description while running without the prompt", async () => {
    await act(async () => {
      root.render(
        createElement(ToolUseBlock, {
          block,
          allBlocks: [block],
          message,
        }),
      );
    });

    expect(container.textContent).toContain("Subagent");
    expect(container.textContent).toContain(
      "Explore · Inspect message rendering",
    );
    expect(container.textContent).not.toContain("A much longer task prompt");
  });

  // 这两个用例同时就是「卡片 block.id === tap 填的 parentToolCallId」的断言：
  // 夹具里的 block id 是 agent-1，store 也用 agent-1 作 key，取不到就渲不出步骤。
  it("有活动快照时展开区渲染步骤列表，且不再显示 tool uses 文本", async () => {
    useAppStore.setState({
      sessionStates: {
        "session-1": {
          ...runningSessionState(),
          subagentActivities: {
            "agent-1": {
              sessionId: "session-1",
              agentId: "agent-1",
              parentToolCallId: "agent-1",
              status: "running",
              current: {
                id: "t2",
                toolName: "bash",
                args: { command: "npm test" },
                done: false,
              },
              steps: [
                {
                  id: "t1",
                  toolName: "read",
                  args: { path: "src/a.ts" },
                  done: true,
                  durationMs: 300,
                },
                {
                  id: "t2",
                  toolName: "bash",
                  args: { command: "npm test" },
                  done: false,
                },
              ],
              stats: {
                toolUses: 2,
                turnCount: 1,
                maxTurns: 20,
                tokens: 12400,
                durationMs: 8300,
              },
            },
          },
          partialToolResults: {
            "agent-1": { content: "3 tool uses...", isError: false },
          },
        },
      },
    });

    await act(async () => {
      root.render(
        createElement(ToolUseBlock, { block, allBlocks: [block], message }),
      );
    });
    await act(async () => {
      container.querySelector("button")?.click();
    });

    const text = container.textContent ?? "";
    expect(text).toContain("src/a.ts");
    expect(text).toContain("npm test");
    expect(text).not.toContain("tool uses...");
  });

  it("没有活动快照时维持现状（回落到 Streaming 文本）", async () => {
    useAppStore.setState({
      sessionStates: {
        "session-1": {
          ...runningSessionState(),
          partialToolResults: {
            "agent-1": { content: "3 tool uses...", isError: false },
          },
        },
      },
    });

    await act(async () => {
      root.render(
        createElement(ToolUseBlock, { block, allBlocks: [block], message }),
      );
    });
    await act(async () => {
      container.querySelector("button")?.click();
    });

    expect(container.textContent ?? "").toContain("3 tool uses...");
  });
});
