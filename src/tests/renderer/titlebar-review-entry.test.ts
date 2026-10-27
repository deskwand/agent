// @vitest-environment jsdom
//
// 代码审查入口按 git 仓库判定：非仓库 / 没有工作目录时那颗按钮不该在，首次探测中
// 要占位但不可见（右簇四颗图标不许左右跳），切会话要立刻换成新目录的结论。
// 都是渲染级行为，源码字符串断言抓不住。

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { Titlebar } from "../../renderer/components/Titlebar";
import { useAppStore } from "../../renderer/store";
import { resetIsGitRepoCacheForTests } from "../../renderer/hooks/use-is-git-repo";
import type { Session } from "../../renderer/types";

const REVIEW_LABEL = "reviewPanel.title";

let container: HTMLDivElement;
let root: Root;

function makeSession(id: string, cwd?: string): Session {
  return {
    id,
    title: id,
    status: "idle",
    cwd,
    mountedPaths: [],
    allowedTools: [],
    memoryEnabled: false,
    isProjectMode: true,
    createdAt: 1,
    updatedAt: 1,
  };
}

function reviewButton(): HTMLButtonElement | null {
  return container.querySelector(`button[aria-label="${REVIEW_LABEL}"]`);
}

/** 右簇（含那颗按钮）的直接子元素数量 —— 占位与不占位靠它区分。 */
function rightClusterChildren(): number {
  const anchor = container.querySelector(
    'button[aria-label="titlebar.fileBrowser"]',
  );
  return anchor?.parentElement?.children.length ?? -1;
}

async function mount(): Promise<void> {
  await act(async () => {
    root.render(React.createElement(Titlebar));
    await Promise.resolve();
  });
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function mockGit(
  impl: (cwd?: string) => Promise<{ isRepo: boolean; changeCount: number }>,
) {
  const hasChanges = vi.fn(impl);
  window.electronAPI = {
    git: { hasChanges },
  } as unknown as typeof window.electronAPI;
  return hasChanges;
}

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true);
  resetIsGitRepoCacheForTests();
  window.electronAPI = {} as unknown as typeof window.electronAPI;
  container = document.createElement("div");
  document.body.innerHTML = "";
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  resetIsGitRepoCacheForTests();
});

describe("顶栏代码审查入口", () => {
  it("仓库会话：按钮在，点了把右面板切到 review", async () => {
    mockGit(async () => ({ isRepo: true, changeCount: 2 }));
    useAppStore.setState({
      activeSessionId: "s-repo",
      sessions: [makeSession("s-repo", "/repo-ready")],
    });

    await mount();
    await flush();

    const button = reviewButton();
    expect(button).not.toBeNull();

    await act(async () => button?.click());
    expect(useAppStore.getState().rightPanelMode).toBe("review");
  });

  it("非仓库会话：按钮不在，同簇其余三颗仍在", async () => {
    mockGit(async () => ({ isRepo: false, changeCount: 3 }));
    useAppStore.setState({
      activeSessionId: "s-plain",
      sessions: [makeSession("s-plain", "/plain-dir")],
    });

    await mount();
    await flush();

    expect(reviewButton()).toBeNull();
    expect(
      container.querySelector('button[aria-label="titlebar.fileBrowser"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('button[aria-label="titlebar.fileBrowser"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('button[aria-label="titlebar.builtInBrowser"]'),
    ).not.toBeNull();
  });

  it("首次探测中：先不渲染，结论回来后出现", async () => {
    const gate = deferred<{ isRepo: boolean; changeCount: number }>();
    mockGit(() => gate.promise);
    useAppStore.setState({
      activeSessionId: "s-probing",
      sessions: [makeSession("s-probing", "/repo-probing")],
    });

    await mount();

    // 结论没回来之前不占位：先占一格再抹掉并不比直接不渲染更安静
    //（丢这一格的 30px 会把前三颗整体推右，占位只是把那次跳动挪到非仓库那一边）
    expect(reviewButton()).toBeNull();
    expect(rightClusterChildren()).toBe(3);

    gate.resolve({ isRepo: true, changeCount: 1 });
    await flush();

    expect(reviewButton()).not.toBeNull();
    expect(rightClusterChildren()).toBe(4);
  });

  it("没有活动会话：既不渲染按钮，也不占位", async () => {
    mockGit(async () => ({ isRepo: true, changeCount: 1 }));
    useAppStore.setState({ activeSessionId: null, sessions: [] });

    await mount();
    await flush();

    expect(reviewButton()).toBeNull();
    expect(rightClusterChildren()).toBe(3);
  });

  it("切会话：从仓库切到非仓库，按钮消失", async () => {
    mockGit(async (cwd) => ({
      isRepo: cwd === "/repo-first",
      changeCount: 1,
    }));
    useAppStore.setState({
      activeSessionId: "s-repo",
      sessions: [
        makeSession("s-repo", "/repo-first"),
        makeSession("s-plain", "/plain-second"),
      ],
    });

    await mount();
    await flush();
    expect(reviewButton()).not.toBeNull();

    await act(async () => useAppStore.getState().setActiveSession("s-plain"));
    await flush();

    expect(reviewButton()).toBeNull();
    expect(rightClusterChildren()).toBe(3);
  });

  it("切会话：从非仓库切到仓库，按钮出现", async () => {
    mockGit(async (cwd) => ({
      isRepo: cwd === "/repo-target",
      changeCount: 1,
    }));
    useAppStore.setState({
      activeSessionId: "s-plain",
      sessions: [
        makeSession("s-plain", "/plain-here"),
        makeSession("s-repo", "/repo-target"),
      ],
    });

    await mount();
    await flush();
    expect(reviewButton()).toBeNull();

    await act(async () => useAppStore.getState().setActiveSession("s-repo"));
    await flush();

    expect(reviewButton()).not.toBeNull();
  });

  it("两个会话共用同一个 cwd：只探一次", async () => {
    const hasChanges = mockGit(async () => ({
      isRepo: true,
      changeCount: 1,
    }));
    useAppStore.setState({
      activeSessionId: "s-a",
      sessions: [
        makeSession("s-a", "/repo-shared"),
        makeSession("s-b", "/repo-shared"),
      ],
    });

    await mount();
    await flush();
    await act(async () => useAppStore.getState().setActiveSession("s-b"));
    await flush();

    expect(reviewButton()).not.toBeNull();
    expect(hasChanges).toHaveBeenCalledTimes(1);
  });
});
