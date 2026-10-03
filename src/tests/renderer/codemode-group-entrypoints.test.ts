// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MessageCard } from "../../renderer/components/MessageCard";
import { ChatView } from "../../renderer/components/ChatView";
import { useAppStore } from "../../renderer/store";
import type {
  Message,
  MountedPath,
  QueuedInput,
  Session,
} from "../../renderer/types";

const { continueSessionMock } = vi.hoisted(() => ({
  // 默认返回已 resolve 的 Promise（真实 continueSession 是 async）
  continueSessionMock: vi.fn(
    (_sessionId: string, _content: unknown[], ..._rest: unknown[]) =>
      Promise.resolve(),
  ),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

vi.mock("../../renderer/hooks/useIPC", () => ({
  useIPC: () => ({
    continueSession: continueSessionMock,
    stopSession: vi.fn(),
    setSessionThinkingLevel: vi.fn(),
    setSessionProviderModel: vi.fn(),
    isElectron: false,
  }),
}));

vi.mock("../../renderer/components/ChatInput", async () => {
  const ReactModule = await import("react");
  return {
    ChatInput: ReactModule.forwardRef(function MockChatInput(
      props: { onSubmit: (d: unknown) => void; bottomSlot?: React.ReactNode },
      ref,
    ) {
      ReactModule.useImperativeHandle(ref, () => ({
        clear: () => {},
        focus: () => {},
        setPrompt: () => {},
        submit: () => {},
        isEmpty: () => true,
        selectFiles: () => {},
      }));
      // 渲染 bottomSlot 以便 ChatInputBottomBar（含 onStop）真正挂载
      return ReactModule.createElement("div", null, props.bottomSlot);
    }),
  };
});

vi.mock("../../renderer/components/ChatInputBottomBar", async () => {
  const ReactModule = await import("react");
  return {
    ChatInputBottomBar: function MockBottomBar(_props: {
      onStop?: () => void;
    }) {
      return ReactModule.createElement("div");
    },
  };
});

vi.mock("../../renderer/components/ChatInputStatusBar", () => ({
  ChatInputStatusBar: () => React.createElement("div"),
  resolveInputStatus: () => null,
}));

function makeSession(status: Session["status"]): Session {
  return {
    id: "s1",
    title: "t",
    status,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    cwd: "/tmp",
    mountedPaths: [] as MountedPath[],
    allowedTools: [],
    memoryEnabled: false,
    isProjectMode: false,
  };
}

function makeMessage(id: string): Message {
  return {
    id,
    sessionId: "s1",
    role: "user",
    timestamp: Date.now(),
    content: [{ type: "text", text: id }],
  };
}

function setInitialState(
  status: Session["status"],
  inputQueue: QueuedInput[] = [],
): void {
  useAppStore.setState({
    sessions: [makeSession(status)],
    activeSessionId: "s1",
    sessionStates: {
      s1: {
        historyHydrated: true,
        hasMoreOlder: false,
        oldestMessageId: null,
        messages: [makeMessage("u1")],
        partialByTurn: {},
        partialMessage: "",
        partialThinking: "",
        pendingTurns: [],
        activeTurn: null,
        executionClock: { startAt: null, endAt: null },
        traceSteps: [],
        contextWindow: 0,
        compaction: { status: "idle" },
        inputQueue,
        steerRecords: [],
        partialToolResults: {},
        backgroundAgents: [],
      } as never,
    },
  });
}

describe("codemode group entrypoints", () => {
  let container: HTMLDivElement;
  let root: Root;
  let scrollToDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    useAppStore.setState(useAppStore.getInitialState());
    continueSessionMock.mockReset();
    class ResizeObserverMock {
      observe() {}
      disconnect() {}
      unobserve() {}
    }
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    scrollToDescriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollTo",
    );
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      writable: true,
      value: function scrollTo(
        this: HTMLElement,
        optionsOrX?: ScrollToOptions | number,
        y?: number,
      ) {
        const requestedTop =
          typeof optionsOrX === "number" ? (y ?? 0) : (optionsOrX?.top ?? 0);
        const maxScrollTop = Math.max(0, this.scrollHeight - this.clientHeight);
        this.scrollTop = Math.min(Math.max(0, requestedTop), maxScrollTop);
      },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();

    vi.clearAllMocks();
    vi.unstubAllGlobals();
    if (scrollToDescriptor) {
      Object.defineProperty(
        HTMLElement.prototype,
        "scrollTo",
        scrollToDescriptor,
      );
    } else {
      delete (
        HTMLElement.prototype as unknown as {
          scrollTo?: HTMLElement["scrollTo"];
        }
      ).scrollTo;
    }
  });

  it.each(["message", "chat"])(
    "projects mixed operations once through %s",
    async (entry) => {
      setInitialState("idle");
      const parent: Message = {
        id: "a",
        sessionId: "s1",
        role: "assistant",
        turnId: "t",
        timestamp: 2,
        content: [
          {
            type: "tool_use",
            id: "p",
            name: "codemode",
            input: { code: "source" },
          },
        ],
      };
      const result: Message = {
        id: "r",
        sessionId: "s1",
        role: "assistant",
        turnId: "t",
        timestamp: 3,
        content: [
          {
            type: "tool_result",
            toolUseId: "p",
            content: "done",
            nestedCalls: {
              parentToolCallId: "p",
              parentStatus: "ok",
              source: "final",
              complete: true,
              calls: [
                {
                  id: "read",
                  name: "read",
                  status: "ok",
                  input: { path: "a" },
                },
                {
                  id: "edit",
                  name: "edit",
                  status: "ok",
                  input: { path: "b" },
                },
                { id: "unknown", name: "custom", status: "ok" },
              ],
            },
          },
        ],
      };
      useAppStore
        .getState()
        .setMessages("s1", [makeMessage("u1"), parent, result]);
      await act(async () =>
        root.render(
          entry === "chat"
            ? React.createElement(ChatView)
            : React.createElement(MessageCard, { message: parent }),
        ),
      );
      const groups = Array.from(
        container.querySelectorAll("[data-summary]"),
      ).map((node) => JSON.parse(node.textContent ?? "{}"));
      const process = groups.filter(
        (group) => group.type === "process-summary",
      );
      expect(process).toHaveLength(2); // Preserve process/result boundaries.
      expect(
        process.reduce((sum, group) => sum + group.summary.readCount, 0),
      ).toBe(1);
      expect(
        process.reduce((sum, group) => sum + group.summary.usedToolCount, 0),
      ).toBe(1);
      expect(
        process
          .flatMap((group) => group.items)
          .map((item: { id: string }) => item.id),
      ).toEqual(["read", "unknown"]);
      expect(
        groups
          .find((group) => group.type === "result-summary")
          .items.map((item: { id: string }) => item.id),
      ).toEqual(["edit"]);
      expect(
        groups
          .flatMap((group) => group.items)
          .some((item: { id: string }) => item.id === "p"),
      ).toBe(false);
    },
  );
  it("keeps full-turn counts for operations outside the render window", async () => {
    setInitialState("idle");
    const messages: Message[] = Array.from({ length: 410 }, (_, index) => ({
      id: `a${index}`,
      sessionId: "s1",
      role: "assistant",
      turnId: "long",
      timestamp: index + 2,
      content: [{ type: "text", text: `text ${index}` }],
    }));
    messages[0].content.push(
      {
        type: "tool_use",
        id: "early-read",
        name: "read",
        input: { path: "early" },
      },
      {
        type: "tool_result",
        toolUseId: "early-read",
        content: "ok",
        isError: false,
      },
    );
    messages[1].content = [
      {
        type: "tool_use",
        id: "middle",
        name: "bash",
        input: { command: "true" },
      },
      { type: "tool_result", toolUseId: "middle", content: "", isError: false },
    ];
    messages.push({
      id: "last",
      sessionId: "s1",
      role: "assistant",
      turnId: "long",
      timestamp: 500,
      content: [
        {
          type: "tool_use",
          id: "last-command",
          name: "bash",
          input: { command: "true" },
        },
        {
          type: "tool_result",
          toolUseId: "last-command",
          content: "",
          isError: false,
        },
      ],
    });
    await act(async () => root.render(React.createElement(ChatView)));
    await act(async () => {
      useAppStore
        .getState()
        .setMessages("s1", [makeMessage("u1"), ...messages]);
    });
    const groups = Array.from(container.querySelectorAll("[data-summary]")).map(
      (node) => JSON.parse(node.textContent ?? "{}"),
    );
    expect(
      groups.filter((group) => group.type === "process-summary"),
    ).toHaveLength(1);
    expect(
      groups.find((group) => group.type === "process-summary").summary,
    ).toMatchObject({ readCount: 1, commandCount: 2 });
  });
});

vi.mock("../../renderer/components/message/ProcessSummaryBlock", () => ({
  ProcessSummaryBlock: ({ block }: { block: unknown }) =>
    React.createElement("pre", { "data-summary": true }, JSON.stringify(block)),
}));
vi.mock("../../renderer/components/message/ResultSummaryBlock", () => ({
  ResultSummaryBlock: ({ block }: { block: unknown }) =>
    React.createElement("pre", { "data-summary": true }, JSON.stringify(block)),
}));
