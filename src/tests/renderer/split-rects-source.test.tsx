// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PaneDropZones,
  SESSION_DRAG_MIME,
} from "../../renderer/components/split/PaneDropZones";
import { PaneHeader } from "../../renderer/components/split/PaneHeader";
import { useSplitRectsStore } from "../../renderer/components/split/split-rects-context";
import { useAppStore } from "../../renderer/store";
import { useSplitLayoutStore } from "../../renderer/store/split-layout";
import {
  layoutRects,
  listLeaves,
  type SplitNode,
} from "../../renderer/store/split-tree";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

const leaf = (paneId: string, sessionId: string | null): SplitNode => ({
  kind: "leaf",
  paneId,
  sessionId,
});
const twoPanes: SplitNode = {
  kind: "split",
  dir: "row",
  ratio: 0.5,
  a: leaf("P1", "S1"),
  b: leaf("P2", "S2"),
};

let container: HTMLDivElement;
let root: Root;

/** 只写 rects store（不挂 SplitLayout），区域内组件应当据此判断能否分割。 */
function publishRects(width: number): void {
  const bounds = { x: 0, y: 0, width, height: 1000 };
  useSplitRectsStore.getState().set(layoutRects(twoPanes, bounds), bounds);
}

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true);
  useSplitLayoutStore.setState({ root: twoPanes, focusedPaneId: "P1" });
  useSplitRectsStore.getState().clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("区域内组件读取 rects store", () => {
  it("PaneHeader 的分割按钮随 store 里的 rect 启用", async () => {
    publishRects(3200);
    await act(async () => {
      root.render(<PaneHeader paneId="P1" sessionId="S1" />);
    });
    const button = container.querySelector<HTMLButtonElement>(
      'button[aria-label="split.splitRight"]',
    );
    expect(button?.disabled).toBe(false);
  });

  it("PaneDropZones 边缘 drop 按 store 里的 rect 分割", async () => {
    publishRects(3200);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1600,
      bottom: 1000,
      width: 1600,
      height: 1000,
      toJSON: () => ({}),
    });
    await act(async () => {
      root.render(
        <PaneDropZones paneId="P2">
          <div />
        </PaneDropZones>,
      );
    });
    const target = container.firstElementChild;
    if (!target) throw new Error("drop zone not found");
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", {
      value: {
        types: [SESSION_DRAG_MIME],
        getData: (type: string) => (type === SESSION_DRAG_MIME ? "S3" : ""),
      },
    });
    Object.defineProperty(drop, "clientX", { value: 1590 });
    Object.defineProperty(drop, "clientY", { value: 500 });
    await act(async () => {
      target.dispatchEvent(drop);
    });
    expect(listLeaves(useSplitLayoutStore.getState().root)).toHaveLength(3);
  });
});
