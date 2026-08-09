// @vitest-environment jsdom
// Component-level integration tests for the paged older-history flow with
// the fixed-size message render window:
//  - stage 1 slides the render window within the in-memory window (no IPC)
//    and must NOT change the nav-rail dock tick count
//  - stage 2 fetches a page from the main process when the render window
//    is exhausted, prepends it and keeps old content visible
//  - degenerate sparse pages still clear the spinner
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

const getSessionMessagesPageMock = vi.fn();

vi.mock("../../renderer/hooks/useIPC", () => ({
  useIPC: () => ({
    continueSession: vi.fn(),
    stopSession: vi.fn(),
    setSessionThinkingLevel: vi.fn(),
    setSessionProviderModel: vi.fn(),
    getSessionMessagesPage: getSessionMessagesPageMock,
    isElectron: true,
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
    title: "Paged history test",
    status: "running",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    cwd: "/tmp",
    mountedPaths: [] as MountedPath[],
    allowedTools: [] as string[],
    memoryEnabled: false,
    isProjectMode: false,
  };
}

/** One user/assistant turn pair. */
function turn(prefix: string, n: number): Message[] {
  return [
    {
      id: `${prefix}-u${n}`,
      sessionId: "s1",
      role: "user",
      content: [{ type: "text", text: `${prefix}-user-${n} |` }],
      timestamp: n * 1000,
    },
    {
      id: `${prefix}-a${n}`,
      sessionId: "s1",
      role: "assistant",
      content: [{ type: "text", text: `${prefix}-asst-${n} |` }],
      timestamp: n * 1000 + 1,
      turnId: `${prefix}-t${n}`,
    },
  ];
}

describe("ChatView paged older-history loading", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    useAppStore.setState(useAppStore.getInitialState());
    useAppStore.getState().addSession(makeSession());
    useAppStore.getState().setActiveSession("s1");
    getSessionMessagesPageMock.mockReset();

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
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      writable: true,
      value: function scrollTo(
        this: HTMLElement,
        optionsOrX?: unknown,
        y?: number,
      ) {
        const requestedTop =
          typeof optionsOrX === "number"
            ? (y ?? 0)
            : ((optionsOrX as { top?: number })?.top ?? 0);
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
  });

  function getScrollContainer(): HTMLDivElement {
    const el = container.querySelector<HTMLDivElement>(".overflow-y-auto");
    expect(el).not.toBeNull();
    return el!;
  }

  function dockTickCount(): number {
    const rail = container.querySelector(".absolute.top-0.bottom-0.z-10");
    return rail?.querySelectorAll('[role="button"]').length ?? -1;
  }

  it("slides the render window within the memory window without IPC, keeping the dock stable", async () => {
    // 300 turns = 600 messages; dock caps at MAX_DOCK_TICKS=50.
    const all = Array.from({ length: 300 }, (_, i) => turn("m", i + 1)).flat();
    useAppStore.getState().setMessagesTail("s1", all, false);
    getSessionMessagesPageMock.mockResolvedValue({
      messages: [],
      hasMore: false,
    });

    await act(async () => {
      root.render(React.createElement(ChatView));
    });
    const scrollContainer = getScrollContainer();
    // 视口高度给足，避免 auto-fill 级联；初始窗口 = 尾部 400 条
    Object.defineProperties(scrollContainer, {
      scrollHeight: { configurable: true, value: 2000 },
      clientHeight: { configurable: true, value: 500 },
    });
    await act(async () => {
      await Promise.resolve();
    });

    const dockBefore = dockTickCount();
    // dock = 内存窗口 user（300 个）采样上限 50
    expect(dockBefore).toBe(50);
    const hasUser = (n: number, text: string) =>
      new RegExp(`m-user-${n} \\|`).test(text);
    const textBefore = scrollContainer.textContent ?? "";
    // jsdom 视口高度为 0 → auto-fill 级联把窗口从尾部滑到头部 [0,400)
    expect(hasUser(1, textBefore)).toBe(true);
    expect(hasUser(300, textBefore)).toBe(false);

    // 滚动到顶 → stage-1（渲染窗口内扩展，无 IPC）
    await act(async () => {
      scrollContainer.scrollTop = 0;
      scrollContainer.dispatchEvent(new Event("scroll"));
      await Promise.resolve();
      await Promise.resolve();
    });

    // stage-1 不触发 IPC；窗口滑向更早历史
    expect(getSessionMessagesPageMock).not.toHaveBeenCalled();
    const textAfter = scrollContainer.textContent ?? "";
    // 窗口滑向更早历史：最早消息现在可见
    expect(hasUser(1, textAfter)).toBe(true);
    expect(hasUser(300, textAfter)).toBe(false);
    // dock 数量零跳变
    expect(dockTickCount()).toBe(dockBefore);
  });

  it("fetches a page via IPC when the render window is exhausted, keeping old content visible", async () => {
    const tail = Array.from({ length: 7 }, (_, i) =>
      turn("tail", i + 6),
    ).flat();
    useAppStore.getState().setMessagesTail("s1", tail, true);
    const older = Array.from({ length: 5 }, (_, i) =>
      turn("older", i + 1),
    ).flat();
    getSessionMessagesPageMock.mockResolvedValue({
      messages: older,
      hasMore: false,
    });

    await act(async () => {
      root.render(React.createElement(ChatView));
    });
    const scrollContainer = getScrollContainer();
    Object.defineProperties(scrollContainer, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 500 },
    });
    // 全部消息在窗口内（14 条 < 400）→ 初始即全渲染
    expect(scrollContainer.textContent ?? "").toContain("tail-user-6");
    expect(getSessionMessagesPageMock).not.toHaveBeenCalled();

    await act(async () => {
      scrollContainer.scrollTop = 0;
      scrollContainer.dispatchEvent(new Event("scroll"));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getSessionMessagesPageMock).toHaveBeenCalledWith(
      "s1",
      "tail-u6",
      1000,
    );
    const ss = useAppStore.getState().sessionStates["s1"];
    expect(ss.messages).toHaveLength(24);
    expect(ss.hasMoreOlder).toBe(false);

    // 内容顺序正确：older 在 tail 之前，旧内容完整可见
    const text = scrollContainer.textContent ?? "";
    expect(text.indexOf("older-user-1")).toBeGreaterThan(-1);
    expect(text.indexOf("older-user-1")).toBeLessThan(
      text.indexOf("tail-user-6"),
    );
  });

  it("clears the spinner even when the fetched page contains no user message (alignment cap exceeded)", async () => {
    const tail = Array.from({ length: 7 }, (_, i) =>
      turn("tail", i + 6),
    ).flat();
    useAppStore.getState().setMessagesTail("s1", tail, true);
    // 退化页：900 条纯 assistant（无 user）
    const sparse = Array.from({ length: 900 }, (_, i) => ({
      id: `sparse-a${i}`,
      sessionId: "s1",
      role: "assistant" as const,
      content: [{ type: "text" as const, text: `sparse-msg-${i} |` }],
      timestamp: i,
      turnId: "sparse-turn",
    }));
    getSessionMessagesPageMock.mockResolvedValue({
      messages: sparse,
      hasMore: false,
    });

    await act(async () => {
      root.render(React.createElement(ChatView));
    });
    const scrollContainer = getScrollContainer();
    Object.defineProperties(scrollContainer, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 500 },
    });

    await act(async () => {
      scrollContainer.scrollTop = 0;
      scrollContainer.dispatchEvent(new Event("scroll"));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // 转圈 spinner 必须消失（防御兜底），窗口已 prepend
    const text = scrollContainer.textContent ?? "";
    expect(text).not.toContain("spinner");
    const ss = useAppStore.getState().sessionStates["s1"];
    expect(ss.messages).toHaveLength(914);
    expect(ss.hasMoreOlder).toBe(false);
    // 渲染窗口 = [boundary-200, boundary+400) = 窗口中部，旧内容可见
    expect(text).toContain("tail-user-6");
    expect(text).toContain("sparse-msg-700");
  });

  it("anchors dock ticks to the in-memory window (user count after prepend)", async () => {
    const tail = Array.from({ length: 7 }, (_, i) =>
      turn("tail", i + 6),
    ).flat();
    useAppStore.getState().setMessagesTail("s1", tail, true);
    const older = Array.from({ length: 5 }, (_, i) =>
      turn("older", i + 1),
    ).flat();
    getSessionMessagesPageMock.mockResolvedValue({
      messages: older,
      hasMore: false,
    });

    await act(async () => {
      root.render(React.createElement(ChatView));
    });
    const scrollContainer = getScrollContainer();
    Object.defineProperties(scrollContainer, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 500 },
    });
    // prepend 前：内存窗口 7 user → 7 tick
    expect(dockTickCount()).toBe(7);

    await act(async () => {
      scrollContainer.scrollTop = 0;
      scrollContainer.dispatchEvent(new Event("scroll"));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    // prepend 后：内存窗口 12 user → 12 tick（与渲染窗口无关）
    expect(dockTickCount()).toBe(12);
  });
});

describe("ChatView dock tick navigation", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    useAppStore.setState(useAppStore.getInitialState());
    useAppStore.getState().addSession(makeSession());
    useAppStore.getState().setActiveSession("s1");
    getSessionMessagesPageMock.mockReset();

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
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      writable: true,
      value: function scrollTo(
        this: HTMLElement,
        optionsOrX?: unknown,
        y?: number,
      ) {
        const requestedTop =
          typeof optionsOrX === "number"
            ? (y ?? 0)
            : ((optionsOrX as { top?: number })?.top ?? 0);
        const maxScrollTop = Math.max(0, this.scrollHeight - this.clientHeight);
        this.scrollTop = Math.min(Math.max(0, requestedTop), maxScrollTop);
      },
    });
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("jumps to a rendered tick directly and expands the window for an unrendered one", async () => {
    // 600 条消息（300 user）→ dock 采样 50；jsdom 0 视口 → 窗口滑到 [0,400)
    const all = Array.from({ length: 300 }, (_, i) => turn("m", i + 1)).flat();
    useAppStore.getState().setMessagesTail("s1", all, false);

    await act(async () => {
      root.render(React.createElement(ChatView));
    });
    const scrollContainer =
      container.querySelector<HTMLDivElement>(".overflow-y-auto")!;
    const hasUser = (n: number, text: string) =>
      new RegExp(`m-user-${n} \\|`).test(text);

    // tick[0] = m-user-1（已渲染，index 0）；tick[49] = m-user-300（未渲染，index 598）
    const rail = container.querySelector(".absolute.top-0.bottom-0.z-10")!;
    const ticks = rail.querySelectorAll('[role="button"]');
    expect(ticks.length).toBe(50);
    expect(hasUser(1, scrollContainer.textContent ?? "")).toBe(true);
    expect(hasUser(300, scrollContainer.textContent ?? "")).toBe(false);

    // 给视口高度，避免 auto-fill 级联把窗口拉回顶部（jsdom 0 高度特例）
    Object.defineProperties(scrollContainer, {
      scrollHeight: { configurable: true, value: 2000 },
      clientHeight: { configurable: true, value: 500 },
    });

    // 点击 tick[0]：目标已渲染 → 直接 scrollIntoView，窗口不动
    const scrollIntoView = Element.prototype.scrollIntoView as ReturnType<
      typeof vi.fn
    >;
    await act(async () => {
      (ticks[0] as HTMLElement).click();
      await Promise.resolve();
    });
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    // 点击 tick[49]：目标未渲染 → 扩窗（start=398）→ 渲染后跳转
    await act(async () => {
      (ticks[49] as HTMLElement).click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(hasUser(300, scrollContainer.textContent ?? "")).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });
});

describe("ChatView dock navigation with realistic data", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    useAppStore.setState(useAppStore.getInitialState());
    useAppStore.getState().addSession(makeSession());
    useAppStore.getState().setActiveSession("s1");
    getSessionMessagesPageMock.mockReset();

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
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      writable: true,
      value: function scrollTo(
        this: HTMLElement,
        optionsOrX?: unknown,
        y?: number,
      ) {
        const requestedTop =
          typeof optionsOrX === "number"
            ? (y ?? 0)
            : ((optionsOrX as { top?: number })?.top ?? 0);
        const maxScrollTop = Math.max(0, this.scrollHeight - this.clientHeight);
        this.scrollTop = Math.min(Math.max(0, requestedTop), maxScrollTop);
      },
    });
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("jumps to a tick whose target is inside the rendered window", async () => {
    // 稀疏会话：1500 条消息，user 消息穿插（id 用 UUID 格式）
    const all: Message[] = [];
    let ts = 1000;
    for (let i = 0; i < 1500; i++) {
      const isUser = i % 500 === 0; // 每 500 条一个 user（稀疏）
      all.push({
        id: `aaaaaaaa-bbbb-4ccc-8ddd-${String(i).padStart(12, "0")}`,
        sessionId: "s1",
        role: isUser ? "user" : "assistant",
        content: [
          { type: "text", text: `msg-${i} ${isUser ? "USER" : "asst"} |` },
        ],
        timestamp: ts++,
        turnId: isUser ? `turn-${i}` : undefined,
      });
    }
    useAppStore.getState().setMessagesTail("s1", all, false);

    await act(async () => {
      root.render(React.createElement(ChatView));
    });
    const scrollContainer =
      container.querySelector<HTMLDivElement>(".overflow-y-auto")!;
    Object.defineProperties(scrollContainer, {
      scrollHeight: { configurable: true, value: 3000 },
      clientHeight: { configurable: true, value: 500 },
    });

    const rail = container.querySelector(".absolute.top-0.bottom-0.z-10")!;
    const ticks = rail.querySelectorAll('[role="button"]');
    // 3 个 user → 3 个 tick
    expect(ticks.length).toBe(3);

    const scrollIntoView = Element.prototype.scrollIntoView as ReturnType<
      typeof vi.fn
    >;
    const text = scrollContainer.textContent ?? "";
    // jsdom 0 高度视口 → auto-fill 把窗口滑到 [0,400)：msg-0 的 user 在窗口内，
    // msg-500 / msg-1000 的 user 在窗口外（真实 App 视口有高度，窗口 = 尾部 400 条，
    // 同样只有最新 user 在窗口内——两分支路径一致）
    expect(text).toContain("msg-0 USER |");
    expect(text).not.toContain("msg-500 USER |");

    // 点击 tick[0]（msg-0 user，已渲染）→ 直接跳转
    await act(async () => {
      (ticks[0] as HTMLElement).click();
      await Promise.resolve();
    });
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    // 点击 tick[1]（msg-500 user，未渲染）→ 扩窗 + 跳转
    await act(async () => {
      (ticks[1] as HTMLElement).click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(scrollContainer.textContent ?? "").toContain("msg-500 USER |");
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });
});

describe("ChatView dock jump vs bottom reclamation", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    useAppStore.setState(useAppStore.getInitialState());
    useAppStore.getState().addSession(makeSession());
    useAppStore.getState().setActiveSession("s1");
    getSessionMessagesPageMock.mockReset();

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
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      writable: true,
      value: function scrollTo(
        this: HTMLElement,
        optionsOrX?: unknown,
        y?: number,
      ) {
        const requestedTop =
          typeof optionsOrX === "number"
            ? (y ?? 0)
            : ((optionsOrX as { top?: number })?.top ?? 0);
        const maxScrollTop = Math.max(0, this.scrollHeight - this.clientHeight);
        this.scrollTop = Math.min(Math.max(0, requestedTop), maxScrollTop);
      },
    });
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("does not snap the window back to the tail when a dock jump starts from the bottom", async () => {
    // 600 条（300 user）→ dock 50 tick；jsdom 窗口被 auto-fill 滑到 [0,400)
    const all = Array.from({ length: 300 }, (_, i) => turn("m", i + 1)).flat();
    useAppStore.getState().setMessagesTail("s1", all, false);

    await act(async () => {
      root.render(React.createElement(ChatView));
    });
    const scrollContainer =
      container.querySelector<HTMLDivElement>(".overflow-y-auto")!;
    Object.defineProperties(scrollContainer, {
      scrollHeight: { configurable: true, value: 2000 },
      clientHeight: { configurable: true, value: 500 },
    });

    const hasUser = (n: number, text: string) =>
      new RegExp(`m-user-${n} \\|`).test(text);

    // 模拟用户在底部：滚动到物理底部 → isAtBottomRef = true
    await act(async () => {
      scrollContainer.scrollTop = 1500; // = maxScrollTop
      scrollContainer.dispatchEvent(new Event("scroll"));
      await Promise.resolve();
    });

    // 点击 tick[49]（m-user-300，窗口外 index 598）→ 扩窗
    const rail = container.querySelector(".absolute.top-0.bottom-0.z-10")!;
    const ticks = rail.querySelectorAll('[role="button"]');
    await act(async () => {
      (ticks[49] as HTMLElement).click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(hasUser(300, scrollContainer.textContent ?? "")).toBe(true);

    // 模拟 smooth scrollIntoView 的第一个 scroll 事件（scrollTop 尚未变化）
    await act(async () => {
      scrollContainer.dispatchEvent(new Event("scroll"));
      await Promise.resolve();
      await Promise.resolve();
    });

    // 窗口必须保持（不因 isAtBottomRef 残留被回收分支拉回尾部）：
    // 窗口起点 = m-user-200（index 398，扩窗位置）；若被拉回尾部则起点 = m-user-101
    const text = scrollContainer.textContent ?? "";
    expect(text.startsWith("m-user-200 |")).toBe(true);
    expect(hasUser(300, text)).toBe(true);
  });
});

describe("ChatView prepend trimming remaps the render window", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    useAppStore.setState(useAppStore.getInitialState());
    useAppStore.getState().addSession(makeSession());
    useAppStore.getState().setActiveSession("s1");
    getSessionMessagesPageMock.mockReset();

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
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      writable: true,
      value: function scrollTo(
        this: HTMLElement,
        optionsOrX?: unknown,
        y?: number,
      ) {
        const requestedTop =
          typeof optionsOrX === "number"
            ? (y ?? 0)
            : ((optionsOrX as { top?: number })?.top ?? 0);
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
  });

  it("remaps the render window when trim-on-prepend drops the loaded page", async () => {
    // 2500 turns = 5000 条；拉取 600 turns = 1200 条 → 6200 > 3000 → trim 到 2000
    const tail = Array.from({ length: 2500 }, (_, i) =>
      turn("m", i + 1),
    ).flat();
    useAppStore.getState().setMessagesTail("s1", tail, false);
    const older = Array.from({ length: 600 }, (_, i) =>
      turn("old", i + 1),
    ).flat();
    getSessionMessagesPageMock.mockResolvedValue({
      messages: older,
      hasMore: false,
    });

    await act(async () => {
      root.render(React.createElement(ChatView));
    });
    const scrollContainer =
      container.querySelector<HTMLDivElement>(".overflow-y-auto")!;
    Object.defineProperties(scrollContainer, {
      scrollHeight: { configurable: true, value: 2000 },
      clientHeight: { configurable: true, value: 500 },
    });
    const hasUser = (n: number, text: string) =>
      new RegExp(`m-user-${n} \\|`).test(text);

    // 模拟真实用户：先滚到底部再滚到顶（isAtBottomRef → false）
    await act(async () => {
      scrollContainer.scrollTop = 1500;
      scrollContainer.dispatchEvent(new Event("scroll"));
      await Promise.resolve();
    });
    await act(async () => {
      scrollContainer.scrollTop = 0;
      scrollContainer.dispatchEvent(new Event("scroll"));
      await Promise.resolve();
    });

    // 手动打开"还有更早历史"（初始 hasMore=false 避免 mount 时 auto-fill 拉页）
    await act(async () => {
      useAppStore.setState((s) => ({
        sessionStates: {
          ...s.sessionStates,
          s1: { ...s.sessionStates.s1, hasMoreOlder: true },
        },
      }));
      await Promise.resolve();
    });

    // 滚动到顶 → stage-2 拉页 → prepend + trim
    await act(async () => {
      scrollContainer.dispatchEvent(new Event("scroll"));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const ss = useAppStore.getState().sessionStates["s1"];
    // 5000 + 1200 = 6200 > 3000 → trim 4200 → 保留 2000（m-user-1501..2500）
    expect(ss.messages.length).toBe(2000);
    expect(ss.messages[0].id).toBe("m-u1501");
    expect(ss.hasMoreOlder).toBe(false);

    // 渲染窗口 remap：boundary=1200, trimmed=4200 → newStart=0 → [0,400)
    // = 内存窗口头部 = m-user-1501..1700（旧内容可见，不空白）
    const text = scrollContainer.textContent ?? "";
    expect(hasUser(1501, text)).toBe(true);
    expect(hasUser(2500, text)).toBe(false);
  });
});
