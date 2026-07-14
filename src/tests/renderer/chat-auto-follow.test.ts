// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatView } from "../../renderer/components/ChatView";
import { useAppStore } from "../../renderer/store";
import type { Message, MountedPath, Session } from "../../renderer/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));

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
        compaction: { status: "idle" },
        partialToolResults: {},
      },
    },
  });
}

describe("ChatView auto-follow", () => {
  let container: HTMLDivElement;
  let root: Root;
  let resizeCallbacks: Map<Element, ResizeObserverCallback>;
  let scrollToDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    useAppStore.setState(useAppStore.getInitialState());
    setInitialState();

    resizeCallbacks = new Map();
    class ResizeObserverMock {
      private readonly targets = new Set<Element>();

      constructor(private readonly callback: ResizeObserverCallback) {}

      observe(target: Element) {
        this.targets.add(target);
        resizeCallbacks.set(target, this.callback);
      }

      disconnect() {
        for (const target of this.targets) {
          if (resizeCallbacks.get(target) === this.callback) {
            resizeCallbacks.delete(target);
          }
        }
        this.targets.clear();
      }

      unobserve(target: Element) {
        this.targets.delete(target);
        if (resizeCallbacks.get(target) === this.callback) {
          resizeCallbacks.delete(target);
        }
      }
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
    vi.unstubAllGlobals();
    vi.useRealTimers();
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

  it("keeps an idle conversation pinned after content grows during programmatic scrolling", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
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

    const messagesContainer = scrollContainer!.firstElementChild;
    expect(messagesContainer).not.toBeNull();
    expect(resizeCallbacks.has(messagesContainer!)).toBe(true);

    scrollHeight = 1120;
    await act(async () => {
      resizeCallbacks.get(messagesContainer!)?.([], {} as ResizeObserver);
      await vi.advanceTimersByTimeAsync(16);
    });

    const distanceToBottom =
      scrollHeight - scrollContainer!.scrollTop - scrollContainer!.clientHeight;
    expect(distanceToBottom).toBeLessThanOrEqual(1);
  });

  it("does not pull an idle conversation back down after the user scrolls upward", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
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

    await act(async () => {
      scrollContainer!.dispatchEvent(
        new WheelEvent("wheel", { bubbles: true, deltaY: -20 }),
      );
    });

    const messagesContainer = scrollContainer!.firstElementChild;
    expect(messagesContainer).not.toBeNull();
    scrollHeight = 1120;
    await act(async () => {
      resizeCallbacks.get(messagesContainer!)?.([], {} as ResizeObserver);
      await vi.advanceTimersByTimeAsync(16);
    });

    expect(scrollContainer!.scrollTop).toBe(500);
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
