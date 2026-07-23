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
    steerResult: null,
    partialToolResults: {},
    backgroundAgents: [],
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
});
