// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../renderer/i18n/config";
import { Sidebar } from "../../renderer/components/Sidebar";
import { SplitLayout } from "../../renderer/components/split/SplitLayout";
import {
  resolveDropTarget,
  SESSION_DRAG_MIME,
} from "../../renderer/components/split/PaneDropZones";
import { useSplitRectsStore } from "../../renderer/components/split/split-rects-context";
import { useSplitShortcuts } from "../../renderer/components/split/use-split-shortcuts";
import { useAppStore } from "../../renderer/store";
import { useSplitLayoutStore } from "../../renderer/store/split-layout";
import {
  layoutRects,
  listLeaves,
  type SplitNode,
} from "../../renderer/store/split-tree";
import type { PermissionRequest, Session } from "../../renderer/types";

const ipc = vi.hoisted(() => ({
  invoke: vi.fn(),
  deleteSession: vi.fn(),
  deleteProject: vi.fn(),
  renameSession: vi.fn(),
  archiveSession: vi.fn(),
  unarchiveSession: vi.fn(),
  batchArchiveSessions: vi.fn(),
  batchUnarchiveSessions: vi.fn(),
  setSessionCompleted: vi.fn(),
  getSessionMessagesPage: vi.fn(),
  getSessionTraceSteps: vi.fn(),
  changeWorkingDir: vi.fn(),
  createProject: vi.fn(),
  respondToPermission: vi.fn(),
  respondToSudoPassword: vi.fn(),
}));

vi.mock("../../renderer/hooks/useIPC", () => ({
  useIPC: () => ({ ...ipc, isElectron: true }),
}));
vi.mock("../../renderer/components/ChatView", () => ({
  ChatView: () => <div data-testid="chat" />,
}));
vi.mock("../../renderer/components/WelcomeView", () => ({
  WelcomeView: () => <div data-testid="welcome" />,
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function session(id: string): Session {
  return {
    id,
    kind: "ordinary",
    title: id,
    status: "idle",
    mountedPaths: [],
    allowedTools: [],
    memoryEnabled: false,
    isProjectMode: false,
    createdAt: 1,
    updatedAt: 1,
  };
}

const leaf = (paneId: string, sessionId: string | null): SplitNode => ({
  kind: "leaf",
  paneId,
  sessionId,
});
const row = (a: SplitNode, b: SplitNode): SplitNode => ({
  kind: "split",
  dir: "row",
  ratio: 0.5,
  a,
  b,
});

function setLayout(tree: SplitNode, focused: string): void {
  useSplitLayoutStore.setState({ root: tree, focusedPaneId: focused });
}
function leafCount(): number {
  return listLeaves(useSplitLayoutStore.getState().root).length;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.setState({
    sessions: [session("S1"), session("S2"), session("S3")],
  });
  useSplitRectsStore.getState().clear();
  setLayout(leaf("P1", "S1"), "P1");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("resolveDropTarget", () => {
  const rect = { x: 0, y: 0, width: 1000, height: 800 };
  it("按最近的边缘（25% 内）分割，否则替换", () => {
    expect(resolveDropTarget(rect, { x: 950, y: 400 })).toEqual({
      kind: "split",
      dir: "row",
      side: "after",
    });
    expect(resolveDropTarget(rect, { x: 50, y: 400 })).toEqual({
      kind: "split",
      dir: "row",
      side: "before",
    });
    expect(resolveDropTarget(rect, { x: 500, y: 780 })).toEqual({
      kind: "split",
      dir: "column",
      side: "after",
    });
    expect(resolveDropTarget(rect, { x: 500, y: 400 })).toEqual({
      kind: "replace",
    });
  });
});

describe("侧栏菜单", () => {
  async function renderSidebar(): Promise<void> {
    await act(async () => {
      root.render(<Sidebar />);
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  async function openMenu(sessionId: string): Promise<void> {
    const rowEl = container.querySelector(`[data-session-id="${sessionId}"]`);
    if (!rowEl) throw new Error("row not found");
    await act(async () => {
      rowEl.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    await act(async () => {
      rowEl
        .querySelector(`button[aria-label="${i18n.t("sidebar.moreActions")}"]`)
        ?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  function menuItem(label: string): HTMLElement {
    const item = Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((n) => n.textContent?.trim() === label);
    if (!item) throw new Error(`menu item not found: ${label}`);
    return item;
  }

  it("菜单项在右侧分屏打开", async () => {
    await renderSidebar();
    await openMenu("S2");
    await act(async () => {
      menuItem(i18n.t("split.openInSplitRight")).click();
    });
    const state = useSplitLayoutStore.getState();
    expect(leafCount()).toBe(2);
    const focused = listLeaves(state.root).find(
      (l) => l.paneId === state.focusedPaneId,
    );
    expect(focused?.sessionId).toBe("S2");
  });

  it("到上限时菜单项 aria-disabled", async () => {
    setLayout(
      row(
        row(leaf("P1", "S1"), leaf("P2", null)),
        row(leaf("P3", null), leaf("P4", null)),
      ),
      "P1",
    );
    await renderSidebar();
    await openMenu("S2");
    expect(
      menuItem(i18n.t("split.openInSplitRight")).getAttribute("aria-disabled"),
    ).toBe("true");
  });

  it("会话已在区域中：不新增叶子，聚焦该区域", async () => {
    setLayout(row(leaf("P1", "S1"), leaf("P2", "S2")), "P2");
    await renderSidebar();
    await openMenu("S1");
    await act(async () => {
      menuItem(i18n.t("split.openInSplitRight")).click();
    });
    expect(leafCount()).toBe(2);
    expect(useSplitLayoutStore.getState().focusedPaneId).toBe("P1");
  });

  it("侧栏等待状态包含授权", async () => {
    const request: PermissionRequest = {
      toolUseId: "t1",
      toolName: "bash",
      input: {},
      sessionId: "S2",
    };
    useAppStore.setState({ pendingPermissions: { t1: request } });
    await renderSidebar();
    const badge = container.querySelector(
      `[data-session-id="S2"] [role="status"]`,
    );
    expect(badge?.getAttribute("aria-label")).toBe(i18n.t("sidebar.asking"));
  });

  it("重命名输入中会话行不可拖拽", async () => {
    await renderSidebar();
    const row = () =>
      container.querySelector<HTMLElement>('[data-session-id="S2"]');
    expect(row()?.getAttribute("draggable")).toBe("true");
    await openMenu("S2");
    act(() => {
      menuItem(i18n.t("sidebar.rename")).click();
    });
    expect(row()?.querySelector("input")).not.toBeNull();
    expect(row()?.getAttribute("draggable")).toBe("false");
  });
});

describe("快捷键", () => {
  function Host({ enabled }: { enabled: boolean }): null {
    useSplitShortcuts(enabled);
    return null;
  }

  async function mountHost(enabled = true): Promise<void> {
    await act(async () => {
      root.render(<Host enabled={enabled} />);
    });
  }

  /** 把当前布局的区域 rect 灌进 rects store（模拟 SplitLayout 的测量结果）。 */
  function publishRects(): void {
    const bounds = { x: 0, y: 0, width: 1600, height: 1000 };
    useSplitRectsStore
      .getState()
      .set(layoutRects(useSplitLayoutStore.getState().root, bounds), bounds);
  }

  function press(init: KeyboardEventInit): void {
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          ...init,
        }),
      );
    });
  }

  afterEach(() => {
    delete (window as { electronAPI?: unknown }).electronAPI;
  });

  for (const platform of ["darwin", "win32"] as const) {
    const mod: KeyboardEventInit =
      platform === "darwin" ? { metaKey: true } : { ctrlKey: true };

    describe(platform, () => {
      beforeEach(() => {
        (window as { electronAPI?: unknown }).electronAPI = { platform };
        publishRects();
      });

      it("Mod+D 向右分割；加 Shift 向下分割", async () => {
        await mountHost();
        press({ key: "d", ...mod });
        expect(leafCount()).toBe(2);
        expect(useSplitLayoutStore.getState().root).toMatchObject({
          dir: "row",
        });
        useSplitLayoutStore.setState({
          root: leaf("P1", "S1"),
          focusedPaneId: "P1",
        });
        publishRects();
        press({ key: "D", shiftKey: true, ...mod });
        expect(useSplitLayoutStore.getState().root).toMatchObject({
          dir: "column",
        });
      });

      it("Mod+Shift+W 关闭聚焦区域", async () => {
        setLayout(row(leaf("P1", "S1"), leaf("P2", "S2")), "P2");
        publishRects();
        await mountHost();
        press({ key: "W", shiftKey: true, ...mod });
        expect(leafCount()).toBe(1);
      });

      it("Mod+Alt+方向键 聚焦相邻区域", async () => {
        setLayout(row(leaf("P1", "S1"), leaf("P2", "S2")), "P1");
        publishRects();
        await mountHost();
        press({ key: "ArrowRight", altKey: true, ...mod });
        expect(useSplitLayoutStore.getState().focusedPaneId).toBe("P2");
      });

      it("enabled=false 时不生效", async () => {
        await mountHost(false);
        press({ key: "d", ...mod });
        expect(leafCount()).toBe(1);
      });
    });
  }
});

describe("拖放", () => {
  it("drop 在区域中心替换会话", async () => {
    setLayout(row(leaf("P1", "S1"), leaf("P2", "S2")), "P1");
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 800,
      width: 1000,
      height: 800,
      toJSON: () => ({}),
    });
    await act(async () => {
      root.render(<SplitLayout />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    const target = container.querySelector(
      '[data-pane-id="P2"]',
    )?.firstElementChild;
    if (!target) throw new Error("drop zone not found");
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", {
      value: {
        types: [SESSION_DRAG_MIME],
        getData: (type: string) => (type === SESSION_DRAG_MIME ? "S3" : ""),
      },
    });
    Object.defineProperty(drop, "clientX", { value: 500 });
    Object.defineProperty(drop, "clientY", { value: 400 });
    await act(async () => {
      target.dispatchEvent(drop);
    });
    const leaves = listLeaves(useSplitLayoutStore.getState().root);
    expect(leaves.find((l) => l.paneId === "P2")?.sessionId).toBe("S3");
    vi.restoreAllMocks();
  });
});
