// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ResizeHandle } from "../src/renderer/components/ResizeHandle";
import { Sidebar } from "../src/renderer/components/Sidebar";
import { useAppStore } from "../src/renderer/store";
import { panelWidthTransitionClass } from "../src/renderer/utils/panel-width";

const WIDTH_TRANSITION = "transition-[width] duration-300 ease-in-out";

const ipc = vi.hoisted(() => ({
  invoke: vi.fn(),
  deleteSession: vi.fn(),
  renameSession: vi.fn(),
  archiveSession: vi.fn(),
  getSessionMessagesPage: vi.fn(),
  getSessionTraceSteps: vi.fn(),
  changeWorkingDir: vi.fn(),
  createProject: vi.fn(),
}));

vi.mock("../src/renderer/hooks/useIPC", () => ({
  useIPC: () => ({ ...ipc, isElectron: true }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const rendererSource = (relativePath: string): string =>
  readFileSync(
    path.resolve(process.cwd(), "src/renderer", relativePath),
    "utf8",
  );

describe("panel resize drag tracking", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    localStorage.clear();
    useAppStore.setState(useAppStore.getInitialState(), true);
    document.body.innerHTML = "";
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("reports drag start and end so the width transition can be suspended", () => {
    const onDraggingChange = vi.fn();
    act(() => {
      root.render(
        createElement(ResizeHandle, {
          onResize: () => undefined,
          onDraggingChange,
        }),
      );
    });

    const handle = container.firstElementChild;
    expect(handle).not.toBeNull();

    act(() => {
      handle?.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, clientX: 120 }),
      );
    });
    expect(onDraggingChange).toHaveBeenLastCalledWith(true);

    act(() => {
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    expect(onDraggingChange).toHaveBeenLastCalledWith(false);
  });

  it("keeps reporting dragging while the parent re-renders mid-drag", () => {
    // App 把 onResize / onDraggingChange 写成内联箭头，而拖动中
    // setSidebarWidth 每帧改值 → App 每帧重渲染 → 这两个 prop 每帧换身份。
    // 若「拖完了」挂在 effect cleanup 上，第一次 mousemove 就会把标志位清掉。
    const calls: boolean[] = [];
    const element = () =>
      createElement(ResizeHandle, {
        onResize: () => undefined,
        onDraggingChange: (dragging: boolean) => calls.push(dragging),
      });

    act(() => {
      root.render(element());
    });
    const handle = container.firstElementChild;
    expect(handle).not.toBeNull();

    act(() => {
      handle?.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, clientX: 120 }),
      );
    });
    expect(calls).toEqual([true]);

    act(() => {
      root.render(element());
    });
    act(() => {
      root.render(element());
    });
    expect(calls).toEqual([true]);

    act(() => {
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    expect(calls).toEqual([true, false]);
  });

  it("clears the dragging flag when the handle unmounts mid-drag", () => {
    // 拖动中 handle 被卸载是可达的：Titlebar 的折叠按钮（store toggleSidebar）
    // 与右侧面板的 Esc 关闭都会让它卸载。不补发 false 就会把标志位卡住，
    // 反而弄丢折叠/展开的动画 —— 正是这个改动要保住的东西。
    const calls: boolean[] = [];
    act(() => {
      root.render(
        createElement(ResizeHandle, {
          onResize: () => undefined,
          onDraggingChange: (dragging: boolean) => calls.push(dragging),
        }),
      );
    });
    const handle = container.firstElementChild;
    expect(handle).not.toBeNull();

    act(() => {
      handle?.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, clientX: 120 }),
      );
    });
    expect(calls).toEqual([true]);

    act(() => {
      root.render(null);
    });
    expect(calls).toEqual([true, false]);
  });

  it("returns the width transition only when not dragging", () => {
    expect(panelWidthTransitionClass(false)).toBe(
      "transition-[width] duration-300 ease-in-out",
    );
    expect(panelWidthTransitionClass(true)).toBe("");
  });

  it("drops the sidebar width transition only while dragging", async () => {
    await act(async () => {
      root.render(createElement(Sidebar, { width: 300, dragging: false }));
    });
    const steady = container.querySelector("aside")?.className ?? "";
    expect(steady).toContain(WIDTH_TRANSITION);

    await act(async () => {
      root.render(createElement(Sidebar, { width: 300, dragging: true }));
    });
    const dragging = container.querySelector("aside")?.className ?? "";
    expect(dragging).not.toContain(WIDTH_TRANSITION);
    // 折叠/展开仍然依赖这条过渡：只关掉过渡，不能顺手删掉别的类名
    expect(dragging).toContain("flex-shrink-0");
    expect(dragging).toContain("overflow-hidden");
  });

  it("suspends the panel width transition from App for both handles", () => {
    const app = rendererSource("App.tsx");
    const sidebar = rendererSource("components/Sidebar.tsx");

    // 两条分隔条都要把拖动状态接到同一个 state 上
    expect(
      app.match(/onDraggingChange=\{setIsPanelDragging\}/g) ?? [],
    ).toHaveLength(2);
    expect(app).toContain(
      "const [isPanelDragging, setIsPanelDragging] = useState(false);",
    );
    expect(app).toContain(
      "<Sidebar width={sidebarWidth} dragging={isPanelDragging} />",
    );
    // 两侧容器都走同一个过渡来源，不再各自持有字面量
    expect(app).toMatch(/panelWidthTransitionClass\(\s*isPanelDragging,?\s*\)/);
    expect(sidebar).toMatch(/panelWidthTransitionClass\(\s*dragging,?\s*\)/);
  });
});
