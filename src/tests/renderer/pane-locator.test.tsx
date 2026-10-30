// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaneLocator } from "../../renderer/components/split/PaneLocator";
import { useSplitLayoutStore } from "../../renderer/store/split-layout";
import type { SplitNode } from "../../renderer/store/split-tree";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${JSON.stringify(opts)}` : key,
  }),
}));

const leaf = (paneId: string, sessionId: string | null): SplitNode => ({
  kind: "leaf",
  paneId,
  sessionId,
});

describe("PaneLocator", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    useSplitLayoutStore.setState(useSplitLayoutStore.getInitialState(), true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function render(sessionId: string) {
    await act(async () => root.render(<PaneLocator sessionId={sessionId} />));
  }

  it("单栏时不渲染", async () => {
    useSplitLayoutStore.setState({
      root: leaf("P1", "S1"),
      focusedPaneId: "P1",
    });
    await render("S1");
    expect(container.querySelector("svg")).toBeNull();
  });

  it("会话不在任何区域时不渲染", async () => {
    useSplitLayoutStore.setState({
      root: {
        kind: "split",
        dir: "row",
        ratio: 0.5,
        a: leaf("P1", "S1"),
        b: leaf("P2", "S2"),
      },
      focusedPaneId: "P1",
    });
    await render("S9");
    expect(container.querySelector("svg")).toBeNull();
  });

  it("每个区域一格，本会话那格实心；聚焦与否用不同的 data-state", async () => {
    useSplitLayoutStore.setState({
      root: {
        kind: "split",
        dir: "row",
        ratio: 0.5,
        a: leaf("P1", "S1"),
        b: leaf("P2", "S2"),
      },
      focusedPaneId: "P1",
    });
    await render("S2");
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("data-state")).toBe("open");
    expect(svg?.querySelectorAll("rect")).toHaveLength(2);
    expect(svg?.querySelectorAll("rect[data-current]")).toHaveLength(1);
    expect(svg?.getAttribute("aria-label")).toBe(
      'split.openInPane:{"index":2,"count":2}',
    );

    await act(async () => useSplitLayoutStore.getState().focusPane("P2"));
    expect(container.querySelector("svg")?.getAttribute("data-state")).toBe(
      "focused",
    );
  });
});
