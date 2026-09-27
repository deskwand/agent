// @vitest-environment jsdom
//
// 用真实 store 挂载真实 Titlebar：左簇（开合 + 折叠态 ✎）与标题都是渲染级行为，
// 源码字符串断言抓不住"按了没反应"。

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { Titlebar } from "../../renderer/components/Titlebar";
import { useAppStore } from "../../renderer/store";

let container: HTMLDivElement;
let root: Root;

function buttonFor(labelKey: string): HTMLButtonElement | null {
  return container.querySelector(`button[aria-label="${labelKey}"]`);
}

async function mount(): Promise<void> {
  await act(async () => {
    root.render(React.createElement(Titlebar));
  });
}

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true);
  // 不 stub onFullScreenChanged：Titlebar 不再订阅全屏状态（决策 6），
  // 留一个没人用的 stub 会暗示存在一个并不存在的依赖
  window.electronAPI = {} as unknown as typeof window.electronAPI;
  container = document.createElement("div");
  document.body.innerHTML = "";
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("顶栏左簇", () => {
  it("聊天视图 + 侧栏展开：有开合按钮（文案=折叠面板），没有新建按钮", async () => {
    useAppStore.setState({ activeView: "chat", sidebarCollapsed: false });
    await mount();

    expect(buttonFor("context.collapsePanel")).not.toBeNull();
    expect(buttonFor("context.expandPanel")).toBeNull();
    expect(buttonFor("sidebar.newChat")).toBeNull();
  });

  it("聊天视图 + 侧栏折叠：两个按钮都在（展开面板 + 新建）", async () => {
    useAppStore.setState({ activeView: "chat", sidebarCollapsed: true });
    await mount();

    expect(buttonFor("context.expandPanel")).not.toBeNull();
    expect(buttonFor("sidebar.newChat")).not.toBeNull();
    expect(buttonFor("context.collapsePanel")).toBeNull();
  });

  it("点开合按钮：sidebarCollapsed 翻转，再点翻回来", async () => {
    useAppStore.setState({ activeView: "chat", sidebarCollapsed: false });
    await mount();

    await act(async () => buttonFor("context.collapsePanel")?.click());
    expect(useAppStore.getState().sidebarCollapsed).toBe(true);

    await act(async () => buttonFor("context.expandPanel")?.click());
    expect(useAppStore.getState().sidebarCollapsed).toBe(false);
  });

  it("点新建：清会话、清工作目录、回聊天视图", async () => {
    useAppStore.setState({
      activeView: "chat",
      sidebarCollapsed: true,
      activeSessionId: "s1",
      workingDir: "/tmp/project",
    });
    await mount();

    await act(async () => buttonFor("sidebar.newChat")?.click());

    const state = useAppStore.getState();
    expect(state.activeSessionId).toBeNull();
    expect(state.workingDir).toBeNull();
    expect(state.activeView).toBe("chat");
  });

  it("非聊天视图：左簇整段不渲染", async () => {
    useAppStore.setState({ activeView: "settings", sidebarCollapsed: false });
    await mount();

    expect(buttonFor("context.collapsePanel")).toBeNull();
    expect(buttonFor("context.expandPanel")).toBeNull();
    expect(buttonFor("sidebar.newChat")).toBeNull();
  });

  it("标题：有会话时显示会话标题，无会话时不渲染文本", async () => {
    useAppStore.setState({
      activeView: "chat",
      sessions: [
        {
          id: "s1",
          title: "示例标题",
          status: "idle",
          mountedPaths: [],
          allowedTools: [],
          memoryEnabled: false,
          isProjectMode: false,
          createdAt: 0,
          updatedAt: 0,
        },
      ],
      activeSessionId: "s1",
    });
    await mount();
    expect(container.textContent).toContain("示例标题");

    useAppStore.setState({ activeSessionId: null });
    await mount();
    expect(container.textContent).not.toContain("示例标题");
  });
});
