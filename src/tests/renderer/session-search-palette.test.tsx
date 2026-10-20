// @vitest-environment jsdom
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../renderer/i18n/config";
import i18n from "../../renderer/i18n/config";
import { SessionSearchPalette } from "../../renderer/components/SessionSearchPalette";
import { useAppStore } from "../../renderer/store";
import type { Session } from "../../renderer/types";
import { cleanupDialogs } from "../dialog-test-helpers";

const ipc = vi.hoisted(() => ({
  changeWorkingDir: vi.fn(),
  getSessionMessagesPage: vi.fn(),
  getSessionTraceSteps: vi.fn(),
}));

vi.mock("../../renderer/hooks/useIPC", () => ({
  useIPC: () => ({ ...ipc, isElectron: true }),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function session(id: string, overrides: Partial<Session> = {}): Session {
  return {
    id,
    title: id,
    status: "idle",
    mountedPaths: [],
    allowedTools: [],
    memoryEnabled: false,
    isProjectMode: false,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("SessionSearchPalette", () => {
  let container: HTMLDivElement;
  let root: Root;

  function dialog(): Element | null {
    return document.body.querySelector('[role="dialog"]');
  }
  function input(): HTMLInputElement | null {
    return document.body.querySelector('input[role="combobox"]');
  }
  function options(): HTMLElement[] {
    return Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="option"]'),
    );
  }
  function buttonByText(text: string): HTMLButtonElement {
    const found = Array.from(document.body.querySelectorAll("button")).find(
      (element) => element.textContent?.includes(text),
    );
    expect(found, `按钮「${text}」必须存在`).toBeTruthy();
    return found as HTMLButtonElement;
  }

  async function openPalette(): Promise<void> {
    await act(async () => {
      useAppStore.getState().openSessionSearch();
    });
    await flush();
  }

  async function typeQuery(value: string): Promise<void> {
    const element = input();
    expect(element).toBeTruthy();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(element, value);
      element?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await flush();
  }

  async function press(
    key: string,
    init: KeyboardEventInit = {},
  ): Promise<void> {
    await act(async () => {
      input()?.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, ...init }),
      );
    });
    await flush();
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    useAppStore.setState(useAppStore.getInitialState(), true);
    useAppStore.setState({
      sessions: [
        session("newer", { title: "添加帮助文档入口", updatedAt: 30 }),
        session("older", { title: "版本发布会话", updatedAt: 10 }),
        session("greeting", {
          title: "回应问候",
          updatedAt: 20,
          isProjectMode: true,
          cwd: "/work/eagent",
        }),
      ],
    });
    ipc.getSessionMessagesPage.mockResolvedValue({
      messages: [],
      hasMore: false,
    });
    ipc.getSessionTraceSteps.mockResolvedValue([]);
    ipc.changeWorkingDir.mockResolvedValue({ success: true, path: "/tmp/p" });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(React.createElement(SessionSearchPalette));
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    cleanupDialogs();
    document.body.innerHTML = "";
  });

  it("stays closed until the store opens it, then focuses a combobox with the i18n placeholder", async () => {
    expect(dialog()).toBeNull();

    await openPalette();

    expect(dialog()).toBeTruthy();
    expect(input()?.getAttribute("placeholder")).toBe(
      i18n.t("sidebar.searchChat"),
    );
    expect(input()?.getAttribute("aria-controls")).toBe(
      "session-search-results",
    );
    expect(document.getElementById("session-search-results")).toBeTruthy();
    expect(document.activeElement).toBe(input());
  });

  it("lists recent sessions newest first, labelling project rows only", async () => {
    await openPalette();

    const rows = options();
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain("添加帮助文档入口");
    expect(rows[0].textContent).not.toContain("eagent");
    expect(rows[1].textContent).toContain("回应问候");
    expect(rows[1].textContent).toContain("eagent");
    expect(rows[2].textContent).toContain("版本发布会话");
  });

  it("opts out of the global focus ring so no accent line is painted under the field", async () => {
    await openPalette();

    // globals.css 给所有 input 加了 `focus:ring-1 focus:ring-primary`（主题强调色）。
    // 弹窗输入框贴着内容区三边，环只剩下方 1px 露在弹窗里 —— 看上去就是搜索框下面
    // 一条橙线。这里显式退出，改用「弹窗本身已打开」传达焦点。
    expect(input()?.className).toContain("focus:ring-0");
    // 输入框下面不要分隔线：搜索框与结果属于同一块浮层，一条横线会把它们切成两个盒子。
    expect(input()?.className).not.toContain("border-b");
    expect(document.querySelector("svg.lucide-search")).toBeTruthy();

    await typeQuery("文档");
    expect(document.activeElement).toBe(input());
  });

  it("filters by keyword and shows the empty state when nothing matches", async () => {
    await openPalette();
    await typeQuery("文档");

    expect(options()).toHaveLength(1);
    expect(options()[0].textContent).toContain("添加帮助文档入口");

    await typeQuery("zzz");

    expect(options()).toHaveLength(0);
    expect(document.body.textContent).toContain(i18n.t("searchPalette.empty"));
  });

  it("opens the clicked session, closes itself and switches to the chat view", async () => {
    useAppStore.setState({ activeView: "settings" });
    await openPalette();

    await act(async () => {
      options()[0].click();
    });
    await flush();

    expect(useAppStore.getState().activeSessionId).toBe("newer");
    expect(useAppStore.getState().sessionSearchOpen).toBe(false);
    expect(useAppStore.getState().activeView).toBe("chat");
  });

  it("opens the nth result with ⌘1–⌘9 and ignores digits past the end", async () => {
    await openPalette();
    await press("2", { code: "Digit2", metaKey: true });

    expect(useAppStore.getState().activeSessionId).toBe("greeting");

    await openPalette();
    await press("9", { code: "Digit9", metaKey: true });

    expect(useAppStore.getState().sessionSearchOpen).toBe(true);
    expect(useAppStore.getState().activeSessionId).toBe("greeting");
  });

  it("moves the highlight with the arrow keys and opens it with Enter", async () => {
    await openPalette();

    expect(input()?.getAttribute("aria-activedescendant")).toBe(
      "session-search-option-0",
    );

    await press("ArrowDown");
    expect(input()?.getAttribute("aria-activedescendant")).toBe(
      "session-search-option-1",
    );
    expect(options()[1].getAttribute("aria-selected")).toBe("true");

    await press("Enter");
    expect(useAppStore.getState().activeSessionId).toBe("greeting");
  });

  it("closes on Escape without changing the active session", async () => {
    useAppStore.setState({ activeSessionId: "older" });
    await openPalette();

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    await flush();

    expect(useAppStore.getState().sessionSearchOpen).toBe(false);
    expect(useAppStore.getState().activeSessionId).toBe("older");
  });

  it("starts a blank chat from the quick action", async () => {
    useAppStore.setState({
      workingDir: "/work/eagent",
      activeSessionId: "newer",
    });
    await openPalette();

    await act(async () => {
      buttonByText(i18n.t("sidebar.newChat")).click();
    });
    await flush();

    expect(useAppStore.getState().activeSessionId).toBeNull();
    expect(useAppStore.getState().workingDir).toBeNull();
    expect(useAppStore.getState().sessionSearchOpen).toBe(false);
  });

  it("opens a folder as the new session's working directory, and keeps the current session when the picker is cancelled", async () => {
    useAppStore.setState({ activeSessionId: "newer" });
    await openPalette();

    await act(async () => {
      buttonByText(i18n.t("searchPalette.openFolder")).click();
    });
    await flush();

    expect(ipc.changeWorkingDir).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().workingDir).toBe("/tmp/p");
    expect(useAppStore.getState().activeSessionId).toBeNull();

    ipc.changeWorkingDir.mockResolvedValue({ success: false, path: "" });
    useAppStore.setState({
      activeSessionId: "newer",
      workingDir: "/work/keep",
    });
    await openPalette();

    await act(async () => {
      buttonByText(i18n.t("searchPalette.openFolder")).click();
    });
    await flush();

    expect(useAppStore.getState().workingDir).toBe("/work/keep");
    expect(useAppStore.getState().activeSessionId).toBe("newer");
  });

  it("lets the IME keep Enter while composing", async () => {
    await openPalette();

    await act(async () => {
      input()?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          code: "Enter",
          bubbles: true,
          isComposing: true,
        }),
      );
    });
    await flush();

    expect(useAppStore.getState().activeSessionId).toBeNull();
    expect(useAppStore.getState().sessionSearchOpen).toBe(true);
  });

  it("tells the user when the picked chat could not be opened", async () => {
    ipc.getSessionMessagesPage.mockRejectedValue(new Error("ipc down"));
    await openPalette();

    await act(async () => {
      options()[0].click();
    });
    await flush();

    expect(useAppStore.getState().activeSessionId).toBeNull();
    expect(useAppStore.getState().globalNotice?.message).toBe(
      i18n.t("sidebar.openSessionFailed"),
    );
  });

  it("offers exactly the two quick actions and no file search placeholder", async () => {
    await openPalette();

    expect(document.body.textContent).toContain(i18n.t("sidebar.newChat"));
    expect(document.body.textContent).toContain(
      i18n.t("searchPalette.openFolder"),
    );
    expect(document.body.textContent).not.toContain("搜索文件");
    expect(document.body.textContent).not.toContain("即将支持");
  });
});
