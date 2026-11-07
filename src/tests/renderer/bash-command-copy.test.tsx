// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
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

describe("bash 命令复制按钮", () => {
  it("详情里有复制按钮，点了把命令写进剪贴板", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

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

    const button = container.querySelector<HTMLButtonElement>(
      "[data-copy-command]",
    );
    expect(button).not.toBeNull();
    expect(button?.getAttribute("aria-label")).toBe(i18n.t("common.copy"));

    await act(async () => button?.click());
    expect(writeText).toHaveBeenCalledWith("npm test");
  });
});
