// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePaneSessionId } from "../../renderer/components/split/pane-context";
import { SplitLayout } from "../../renderer/components/split/SplitLayout";
import { useAppStore } from "../../renderer/store";
import { useSplitLayoutStore } from "../../renderer/store/split-layout";
import type { SplitNode } from "../../renderer/store/split-tree";
import type { PermissionRequest, Session } from "../../renderer/types";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const renderCounts: Record<string, number> = {};
const mountCounts: Record<string, number> = {};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

vi.mock("../../renderer/hooks/useIPC", () => ({
  useIPC: () => ({
    respondToPermission: vi.fn(),
    respondToSudoPassword: vi.fn(),
  }),
}));

vi.mock("../../renderer/components/ChatView", () => ({
  ChatView: () => {
    const id = usePaneSessionId();
    renderCounts[id ?? "none"] = (renderCounts[id ?? "none"] ?? 0) + 1;
    useEffect(() => {
      mountCounts[id ?? "none"] = (mountCounts[id ?? "none"] ?? 0) + 1;
    }, [id]);
    return <div data-testid="chat">{id}</div>;
  },
}));

vi.mock("../../renderer/components/WelcomeView", () => ({
  WelcomeView: () => <div data-testid="welcome" />,
}));

function session(id: string): Session {
  return {
    id,
    kind: "ordinary",
    title: `title-${id}`,
    status: "idle",
    mountedPaths: [],
    allowedTools: [],
    memoryEnabled: false,
    isProjectMode: false,
    createdAt: 1,
    updatedAt: 1,
  };
}

function permission(toolUseId: string, sessionId: string): PermissionRequest {
  return { toolUseId, toolName: "bash", input: {}, sessionId };
}

const leaf = (paneId: string, sessionId: string | null): SplitNode => ({
  kind: "leaf",
  paneId,
  sessionId,
});
const twoPanes = (a: string | null, b: string | null): SplitNode => ({
  kind: "split",
  dir: "row",
  ratio: 0.5,
  a: leaf("P1", a),
  b: leaf("P2", b),
});

let container: HTMLDivElement;
let root: Root;

async function mount(): Promise<void> {
  await act(async () => {
    root.render(<SplitLayout />);
  });
  // 等 lazy ChatView 解析
  await act(async () => {
    await Promise.resolve();
  });
}

function setLayout(tree: SplitNode, focused: string): void {
  useSplitLayoutStore.setState({ root: tree, focusedPaneId: focused });
}

function pane(id: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-pane-id="${id}"]`);
  if (!el) throw new Error(`pane not found: ${id}`);
  return el;
}

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
  for (const k of Object.keys(renderCounts)) delete renderCounts[k];
  for (const k of Object.keys(mountCounts)) delete mountCounts[k];
  useAppStore.setState({
    sessions: [session("S1"), session("S2")],
    sessionStates: {},
    pendingPermissions: {},
    pendingSudoPasswords: {},
    activeSessionId: null,
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SplitLayout", () => {
  it("单叶子无会话渲染 WelcomeView", async () => {
    setLayout(leaf("P1", null), "P1");
    await mount();
    expect(container.querySelector('[data-testid="welcome"]')).not.toBeNull();
  });

  it("单叶子有会话不渲染 PaneHeader", async () => {
    setLayout(leaf("P1", "S1"), "P1");
    await mount();
    expect(container.querySelector('[role="toolbar"]')).toBeNull();
    expect(container.querySelector('[data-testid="chat"]')?.textContent).toBe(
      "S1",
    );
  });

  it("两个叶子各自渲染自己的会话", async () => {
    setLayout(twoPanes("S1", "S2"), "P1");
    await mount();
    const texts = Array.from(
      container.querySelectorAll('[data-testid="chat"]'),
    ).map((e) => e.textContent);
    expect(texts).toEqual(["S1", "S2"]);
    expect(container.querySelectorAll('[role="toolbar"]')).toHaveLength(2);
  });

  it("空区域渲染 WelcomeView", async () => {
    setLayout(twoPanes("S1", null), "P1");
    await mount();
    expect(pane("P2").querySelector('[data-testid="welcome"]')).not.toBeNull();
    expect(pane("P1").querySelector('[data-testid="welcome"]')).toBeNull();
  });

  it("pointerdown 聚焦区域", async () => {
    setLayout(twoPanes("S1", "S2"), "P1");
    await mount();
    await act(async () => {
      pane("P2").dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(useSplitLayoutStore.getState().focusedPaneId).toBe("P2");
  });

  it("授权卡片渲染在所属区域", async () => {
    setLayout(twoPanes("S1", "S2"), "P1");
    useAppStore.setState({
      pendingPermissions: { t1: permission("t1", "S2") },
    });
    await mount();
    expect(pane("P2").textContent).toContain("permission.permissionRequired");
    expect(pane("P1").textContent).not.toContain(
      "permission.permissionRequired",
    );
  });

  it("单区域下聚焦会话的授权卡片也可见", async () => {
    setLayout(leaf("P1", "S1"), "P1");
    useAppStore.setState({
      pendingPermissions: { t1: permission("t1", "S1") },
    });
    await mount();
    expect(pane("P1").textContent).toContain("permission.permissionRequired");
  });

  it("多条授权时显示额外数量", async () => {
    setLayout(leaf("P1", "S1"), "P1");
    useAppStore.setState({
      pendingPermissions: {
        t1: permission("t1", "S1"),
        t2: permission("t2", "S1"),
      },
    });
    await mount();
    expect(pane("P1").textContent).toContain("split.morePermissions");
  });

  it("其他区域流式时本区域不重渲染", async () => {
    setLayout(twoPanes("S1", "S2"), "P1");
    await mount();
    const before = renderCounts.S1;
    expect(before).toBeGreaterThan(0);
    await act(async () => {
      useAppStore.setState((s) => ({
        sessionStates: {
          ...s.sessionStates,
          S2: { ...(s.sessionStates.S2 ?? {}) } as never,
        },
      }));
    });
    await act(async () => {
      useAppStore.setState({
        pendingPermissions: { t1: permission("t1", "S2") },
      });
    });
    expect(renderCounts.S1).toBe(before);
  });

  it("分割 / 关闭其他区域不会重挂载存活区域", async () => {
    setLayout(twoPanes("S1", "S2"), "P1");
    await mount();
    expect(mountCounts.S1).toBe(1);
    await act(async () => {
      useSplitLayoutStore.getState().splitPane("P1", "column", "after");
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.querySelectorAll("[data-pane-id]")).toHaveLength(3);
    expect(mountCounts.S1).toBe(1);
    expect(mountCounts.S2).toBe(1);
    await act(async () => {
      useSplitLayoutStore.getState().closePane("P2");
    });
    expect(container.querySelectorAll("[data-pane-id]")).toHaveLength(2);
    expect(mountCounts.S1).toBe(1);
  });

  it("拖拽分隔线预览比例夹在 MAX_RATIO，松手后提交", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 500,
      width: 1000,
      height: 500,
      toJSON: () => ({}),
    });
    setLayout(twoPanes("S1", "S2"), "P1");
    await mount();
    const handle = container.querySelector<HTMLElement>(".cursor-col-resize");
    if (!handle) throw new Error("divider not found");
    await act(async () => {
      handle.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
          clientX: 500,
        }),
      );
    });
    await act(async () => {
      document.dispatchEvent(new MouseEvent("mousemove", { clientX: 5000 }));
    });
    expect(pane("P1").parentElement?.style.width).toBe("85%");
    expect(
      (useSplitLayoutStore.getState().root as { ratio: number }).ratio,
    ).toBe(0.5);
    await act(async () => {
      document.dispatchEvent(new MouseEvent("mouseup"));
    });
    expect(
      (useSplitLayoutStore.getState().root as { ratio: number }).ratio,
    ).toBe(0.85);
  });
});
