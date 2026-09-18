// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FilePreviewPanel } from "../../renderer/components/FilePreviewPanel";
import { useAppStore } from "../../renderer/store";

const { translate } = vi.hoisted(() => ({
  translate: (key: string) => key,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: translate }),
}));

vi.mock("react-window", () => ({
  List: () => null,
}));

vi.mock("../../renderer/components/VideoPlayer", () => ({
  VideoPlayer: ({ fileName }: { fileName: string }) =>
    React.createElement("div", { "data-testid": "video-player" }, fileName),
}));

const TABS = [
  { path: "/repo/a.ts", name: "a.ts" },
  { path: "/repo/b.ts", name: "b.ts" },
  { path: "/repo/c.ts", name: "c.ts" },
];

describe("FilePreviewPanel tabs", () => {
  let container: HTMLDivElement;
  let root: Root;
  const readFile = vi.fn(async () => ({
    type: "text" as const,
    content: "line",
    ext: ".ts",
  }));

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    window.electronAPI = {
      readFile,
      openPath: vi.fn(async () => ({ error: null })),
    } as unknown as typeof window.electronAPI;

    useAppStore.setState(useAppStore.getInitialState());
    useAppStore.setState({
      previewTabs: TABS,
      activePreviewTab: "/repo/b.ts",
      rightPanelMode: "preview",
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  async function renderPanel(): Promise<void> {
    await act(async () => {
      root.render(React.createElement(FilePreviewPanel));
      await Promise.resolve();
    });
  }

  it("renders one tab per open file and marks the active one", async () => {
    await renderPanel();

    const tabs = container.querySelectorAll('[data-testid="preview-tab"]');
    expect(tabs).toHaveLength(3);
    const active = container.querySelector(
      '[data-testid="preview-tab"][data-active="true"]',
    );
    expect(active?.textContent).toContain("b.ts");
  });

  it("reads the file of the active tab", async () => {
    await renderPanel();
    expect(readFile).toHaveBeenCalledWith("/repo/b.ts");
  });

  it("focuses another tab on click and reads that file", async () => {
    await renderPanel();

    const first = container.querySelector<HTMLElement>(
      '[data-testid="preview-tab"]',
    );
    await act(async () => {
      first?.querySelector("button")?.click();
      await Promise.resolve();
    });

    expect(useAppStore.getState().activePreviewTab).toBe("/repo/a.ts");
    expect(readFile).toHaveBeenLastCalledWith("/repo/a.ts");
  });

  it("closes a single tab without leaving preview mode", async () => {
    await renderPanel();

    const first = container.querySelector<HTMLElement>(
      '[data-testid="preview-tab"]',
    );
    const closeButton = first?.querySelector<HTMLElement>(
      '[data-testid="preview-tab-close"]',
    );
    await act(async () => {
      closeButton?.click();
      await Promise.resolve();
    });

    const state = useAppStore.getState();
    expect(state.previewTabs.map((tab) => tab.path)).toEqual([
      "/repo/b.ts",
      "/repo/c.ts",
    ]);
    expect(state.rightPanelMode).toBe("preview");
  });
});

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
