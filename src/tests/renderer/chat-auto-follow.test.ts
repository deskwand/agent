// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
      return ReactModule.createElement("div");
    }),
  };
});

vi.mock("../../renderer/components/ChatInputBottomBar", () => ({
  ChatInputBottomBar: () => React.createElement("div"),
}));

vi.mock("../../renderer/components/ChatInputStatusBar", () => ({
  ChatInputStatusBar: () => React.createElement("div"),
  resolveInputStatus: () => null,
}));

function makeSession(): Session {
  return {
    id: "s1",
    title: "Auto-follow test",
    status: "running",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    cwd: "/tmp",
    mountedPaths: [] as MountedPath[],
    allowedTools: [],
    memoryEnabled: false,
    isProjectMode: false,
  };
}

function makeMessage(id: string, role: Message["role"]): Message {
  return {
    id,
    sessionId: "s1",
    role,
    timestamp: Date.now(),
    content: [{ type: "text", text: id }],
  };
}

function setInitialState(): void {
  useAppStore.setState({
    sessions: [makeSession()],
    activeSessionId: "s1",
    sessionStates: {
      s1: {
        historyHydrated: true,
        messages: [makeMessage("u1", "user"), makeMessage("a1", "assistant")],
        partialByTurn: {},
        partialMessage: "",
        partialThinking: "",
        pendingTurns: [],
        activeTurn: null,
        executionClock: { startAt: null, endAt: null },
        traceSteps: [],
        contextWindow: 0,
        partialToolResults: {},
      },
    },
  });
}

describe("ChatView streaming auto-follow", () => {
  let container: HTMLDivElement;
  let root: Root;
  let scrollIntoViewDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    useAppStore.setState(useAppStore.getInitialState());
    setInitialState();

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
    scrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollIntoView",
    );
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: () => {},
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    if (scrollIntoViewDescriptor) {
      Object.defineProperty(
        HTMLElement.prototype,
        "scrollIntoView",
        scrollIntoViewDescriptor,
      );
    } else {
      delete (
        HTMLElement.prototype as unknown as {
          scrollIntoView?: HTMLElement["scrollIntoView"];
        }
      ).scrollIntoView;
    }
  });

  it("stops following streaming output as soon as the user scrolls upward", async () => {
    await act(async () => root.render(React.createElement(ChatView)));

    const scrollContainer =
      container.querySelector<HTMLDivElement>(".overflow-y-auto");
    expect(scrollContainer).not.toBeNull();

    Object.defineProperties(scrollContainer!, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 500 },
    });
    scrollContainer!.scrollTop = 500;

    await act(async () => {
      scrollContainer!.dispatchEvent(
        new WheelEvent("wheel", { bubbles: true, deltaY: -20 }),
      );
      scrollContainer!.scrollTop = 490;
      scrollContainer!.dispatchEvent(new Event("scroll"));
    });

    await act(async () => {
      useAppStore.setState((state) => ({
        sessionStates: {
          ...state.sessionStates,
          s1: {
            ...state.sessionStates.s1!,
            partialMessage: "next token",
          },
        },
      }));
    });

    expect(scrollContainer!.scrollTop).toBe(490);
  });

  it("stops following when an upward scroll does not emit a wheel event", async () => {
    await act(async () => root.render(React.createElement(ChatView)));

    const scrollContainer =
      container.querySelector<HTMLDivElement>(".overflow-y-auto");
    expect(scrollContainer).not.toBeNull();

    Object.defineProperties(scrollContainer!, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 500 },
    });
    scrollContainer!.scrollTop = 500;
    scrollContainer!.dispatchEvent(new Event("scroll"));

    await act(async () => {
      scrollContainer!.scrollTop = 490;
      scrollContainer!.dispatchEvent(new Event("scroll"));
    });

    await act(async () => {
      useAppStore.setState((state) => ({
        sessionStates: {
          ...state.sessionStates,
          s1: {
            ...state.sessionStates.s1!,
            partialMessage: "next token",
          },
        },
      }));
    });

    expect(scrollContainer!.scrollTop).toBe(490);
  });

  it("keeps upward intent latched through an intervening bottom scroll event", async () => {
    await act(async () => root.render(React.createElement(ChatView)));

    const scrollContainer =
      container.querySelector<HTMLDivElement>(".overflow-y-auto");
    expect(scrollContainer).not.toBeNull();

    Object.defineProperties(scrollContainer!, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 500 },
    });
    scrollContainer!.scrollTop = 500;
    scrollContainer!.dispatchEvent(new Event("scroll"));

    await act(async () => {
      scrollContainer!.dispatchEvent(
        new WheelEvent("wheel", { bubbles: true, deltaY: -20 }),
      );
      scrollContainer!.dispatchEvent(new Event("scroll"));
    });

    await act(async () => {
      useAppStore.setState((state) => ({
        sessionStates: {
          ...state.sessionStates,
          s1: {
            ...state.sessionStates.s1!,
            partialMessage: "next token",
          },
        },
      }));
    });

    expect(scrollContainer!.scrollTop).toBe(500);
  });

  it("keeps following when content shrinkage clamps the viewport at the bottom", async () => {
    await act(async () => root.render(React.createElement(ChatView)));

    const scrollContainer =
      container.querySelector<HTMLDivElement>(".overflow-y-auto");
    expect(scrollContainer).not.toBeNull();

    let scrollHeight = 1000;
    Object.defineProperties(scrollContainer!, {
      scrollHeight: { configurable: true, get: () => scrollHeight },
      clientHeight: { configurable: true, value: 500 },
    });
    scrollContainer!.scrollTop = 500;
    scrollContainer!.dispatchEvent(new Event("scroll"));

    await act(async () => {
      scrollHeight = 900;
      scrollContainer!.scrollTop = 400;
      scrollContainer!.dispatchEvent(new Event("scroll"));
    });

    await act(async () => {
      scrollHeight = 910;
      useAppStore.setState((state) => ({
        sessionStates: {
          ...state.sessionStates,
          s1: {
            ...state.sessionStates.s1!,
            partialMessage: "next token",
          },
        },
      }));
    });

    expect(scrollContainer!.scrollTop).toBe(910);
  });
});
