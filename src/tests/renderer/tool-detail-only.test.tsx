// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BashToolBlock } from "../../renderer/components/message/BashToolBlock";
import i18n from "../../renderer/i18n/config";
import { useAppStore } from "../../renderer/store";
import type { ContentBlock, Message } from "../../renderer/types";

const bashUse = {
  id: "call-1",
  type: "tool_use" as const,
  name: "bash",
  input: { command: "npm test" },
};

const bashResult: ContentBlock = {
  type: "tool_result",
  toolUseId: "call-1",
  content: "PASS 3 tests",
};

const message: Message = {
  id: "m1",
  sessionId: "s1",
  role: "assistant",
  timestamp: 1,
  content: [bashUse, bashResult],
};

let container: HTMLDivElement;
let root: Root;

beforeAll(async () => {
  await i18n.changeLanguage("zh");
});

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  useAppStore.setState(useAppStore.getInitialState(), true);
  // BashToolBlock 的选择器在没有会话状态时会返回新数组字面量（见
  // bash-tool-block.test.ts 顶部注释），所以这里必须把会话状态备好。
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
  } as never);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("BashToolBlock detailOnly", () => {
  it("默认（不传）要有自己的折叠头，内容默认不渲染", () => {
    act(() =>
      root.render(
        createElement(BashToolBlock, {
          block: bashUse,
          allBlocks: [bashUse, bashResult],
          message,
        }),
      ),
    );
    expect(container.querySelector("button[aria-expanded]")).not.toBeNull();
    expect(container.textContent).not.toContain("PASS 3 tests");
  });

  it("detailOnly 时不渲染折叠头，详情直接可见", () => {
    act(() =>
      root.render(
        createElement(BashToolBlock, {
          block: bashUse,
          allBlocks: [bashUse, bashResult],
          message,
          detailOnly: true,
        }),
      ),
    );
    expect(container.querySelector("button[aria-expanded]")).toBeNull();
    expect(container.textContent).toContain("PASS 3 tests");
  });
});
