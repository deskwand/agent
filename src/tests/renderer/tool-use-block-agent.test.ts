// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ToolUseBlock } from "../../renderer/components/message/ToolUseBlock";
import i18n from "../../renderer/i18n/config";
import { useAppStore, type SessionState } from "../../renderer/store";
import type { Message, ToolUseContent } from "../../renderer/types";

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
