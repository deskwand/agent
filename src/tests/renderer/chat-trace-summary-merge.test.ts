// @vitest-environment jsdom
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../renderer/i18n/config";
import { ChatView } from "../../renderer/components/ChatView";
import { useAppStore } from "../../renderer/store";
import type { Message, MountedPath, Session } from "../../renderer/types";

vi.mock("../../renderer/hooks/useIPC", () => ({
  useIPC: () => ({
    continueSession: vi.fn(),
    stopSession: vi.fn(),
    setSessionThinkingLevel: vi.fn(),
    setSessionProviderModel: vi.fn(),
    isElectron: false,
  }),
}));

vi.mock("../../renderer/components/ChatInput", async () => {
  const ReactModule = await import("react");
  return {
    ChatInput: ReactModule.forwardRef(function MockChatInput(_props, ref) {
      ReactModule.useImperativeHandle(ref, () => ({
        clear: () => {},
        focus: () => {},
        setPrompt: () => {},
        submit: () => {},
        isEmpty: () => true,
        selectFiles: () => {},
      }));
      return ReactModule.createElement("div", { "data-testid": "chat-input" });
    }),
  };
});

vi.mock("../../renderer/components/ChatInputBottomBar", () => ({
  ChatInputBottomBar: () =>
    React.createElement("div", { "data-testid": "chat-input-bottom-bar" }),
}));

vi.mock("../../renderer/components/ChatInputStatusBar", () => ({
  ChatInputStatusBar: () =>
    React.createElement("div", { "data-testid": "chat-input-status-bar" }),
  resolveInputStatus: () => null,
}));

function makeSession(id: string): Session {
  return {
    id,
    title: "Trace summary test",
    status: "idle",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    cwd: "/tmp",
    mountedPaths: [] as MountedPath[],
    allowedTools: [],
    memoryEnabled: false,
    isProjectMode: false,
  };
}

function userMessage(turnId: string): Message {
  return {
    id: "u1",
    sessionId: "s1",
    role: "user",
    turnId,
    timestamp: 1,
    content: [{ type: "text", text: "Open something in the browser" }],
  };
}

function assistantMessage(
  id: string,
  turnId: string,
  blocks: Message["content"],
  timestamp: number,
): Message {
  return {
    id,
    sessionId: "s1",
    role: "assistant",
    turnId,
    timestamp,
    content: blocks,
  };
}

function toolUse(id: string, name: string, input: Record<string, unknown>) {
  return { type: "tool_use" as const, id, name, input };
}

function toolResult(toolUseId: string, content = "ok") {
  return { type: "tool_result" as const, toolUseId, content };
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

function getBrowseSummaryButtons(
  container: HTMLDivElement,
): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll("button")).filter((element) =>
    (element.textContent?.includes("Browsed the web") ?? false) ||
    (element.textContent?.includes("Searched the web") ?? false),
  ) as HTMLButtonElement[];
}

function setSessionMessages(
  messages: Message[],
): void {
  useAppStore.setState({
    sessions: [makeSession("s1")],
    activeSessionId: "s1",
    sessionStates: {
      s1: {
        historyHydrated: true,
        messages,
        partialByTurn: {},
        partialMessage: "",
        partialThinking: "",
        pendingTurns: [],
        activeTurn: null,
        executionClock: { startAt: null, endAt: null },
        traceSteps: [],
        contextWindow: 0,
        compaction: { status: "idle" },
        partialToolResults: {},
      },
    },
  });
}

describe("ChatView trace summary merging", () => {
  let container: HTMLDivElement;
  let root: Root | null;

  beforeEach(async () => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    useAppStore.setState(useAppStore.getInitialState());
    const storage = new Map<string, string>();
    const localStorageMock = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
      clear: () => {
        storage.clear();
      },
    };
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: localStorageMock,
    });
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: localStorageMock,
    });
    window.localStorage.setItem("i18nextLng", "en");
    await i18n.changeLanguage("en");

    if (!("ResizeObserver" in window)) {
      class ResizeObserverMock {
        observe() {}
        disconnect() {}
        unobserve() {}
      }
      Object.defineProperty(window, "ResizeObserver", {
        writable: true,
        value: ResizeObserverMock,
      });
    }

    if (!("requestAnimationFrame" in window)) {
      Object.defineProperty(window, "requestAnimationFrame", {
        writable: true,
        value: (callback: FrameRequestCallback) =>
          window.setTimeout(() => callback(0), 0),
      });
      Object.defineProperty(window, "cancelAnimationFrame", {
        writable: true,
        value: (id: number) => window.clearTimeout(id),
      });
    }

    if (!HTMLElement.prototype.scrollIntoView) {
      HTMLElement.prototype.scrollIntoView = () => {};
    }

    document.body.innerHTML = "";
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root?.unmount();
    });
    root = null;
    document.body.innerHTML = "";
  });

  it("merges a same-turn pure-tool follow-up into one browse summary", async () => {
    const turnId = "turn-1";
    setSessionMessages([
      userMessage(turnId),
      assistantMessage(
        "a1",
        turnId,
        [
          { type: "text", text: "First I fetched the page." },
          toolUse("wf1", "web_fetch", { url: "https://example.com" }),
          toolResult("wf1", "fetched"),
        ],
        2,
      ),
      assistantMessage(
        "a2",
        turnId,
        [
          toolUse("ib1", "internal_browser_screenshot", {}),
          toolResult("ib1", "saved"),
        ],
        3,
      ),
    ]);

    await act(async () => {
      root!.render(React.createElement(ChatView));
    });
    await flush();

    expect(getBrowseSummaryButtons(container)).toHaveLength(1);
  });

  it("keeps per-message browser summaries when the follow-up message also has text", async () => {
    const turnId = "turn-2";
    setSessionMessages([
      userMessage(turnId),
      assistantMessage(
        "a1",
        turnId,
        [
          { type: "text", text: "First I fetched the page." },
          toolUse("wf2", "web_fetch", { url: "https://example.com" }),
          toolResult("wf2", "fetched"),
        ],
        2,
      ),
      assistantMessage(
        "a2",
        turnId,
        [
          { type: "text", text: "Now I will take a screenshot." },
          toolUse("ib2", "internal_browser_screenshot", {}),
          toolResult("ib2", "saved"),
        ],
        3,
      ),
    ]);

    await act(async () => {
      root!.render(React.createElement(ChatView));
    });
    await flush();

    expect(getBrowseSummaryButtons(container)).toHaveLength(2);
  });

  it("does not merge browser summaries across turns", async () => {
    setSessionMessages([
      userMessage("turn-3"),
      assistantMessage(
        "a3",
        "turn-3",
        [
          { type: "text", text: "First turn." },
          toolUse("wf3", "web_fetch", { url: "https://example.com/1" }),
          toolResult("wf3", "fetched"),
        ],
        4,
      ),
      userMessage("turn-4"),
      assistantMessage(
        "a4",
        "turn-4",
        [
          { type: "text", text: "Second turn." },
          toolUse("ib4", "internal_browser_screenshot", {}),
          toolResult("ib4", "saved"),
        ],
        5,
      ),
    ]);

    await act(async () => {
      root!.render(React.createElement(ChatView));
    });
    await flush();

    expect(getBrowseSummaryButtons(container)).toHaveLength(2);
  });
});
