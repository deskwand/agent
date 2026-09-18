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
  VideoPlayer: ({
    fileName,
    autoPlay,
  }: {
    fileName: string;
    autoPlay?: boolean;
  }) =>
    React.createElement(
      "div",
      { "data-testid": "video-player", "data-autoplay": String(autoPlay) },
      fileName,
    ),
}));

describe("FilePreviewPanel video routing", () => {
  let container: HTMLDivElement;
  let root: Root;
  const readFile = vi.fn(async () => ({
    type: "text" as const,
    content: "# Notes",
    ext: ".md",
  }));

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    useAppStore.setState(useAppStore.getInitialState());
    window.electronAPI = {
      readFile,
      openPath: vi.fn(async () => ({ error: null })),
    } as unknown as typeof window.electronAPI;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  async function renderPanel(
    path: string,
    name: string,
    autoPlay?: boolean,
  ): Promise<void> {
    useAppStore.setState({
      previewTabs: [{ path, name, autoPlay }],
      activePreviewTab: path,
      rightPanelMode: "preview",
    });
    await act(async () => {
      root.render(React.createElement(FilePreviewPanel));
      await Promise.resolve();
    });
  }

  it("renders video without reading the complete file", async () => {
    await renderPanel("/tmp/clip.mp4", "clip.mp4");

    expect(
      container.querySelector('[data-testid="video-player"]'),
    ).not.toBeNull();
    expect(readFile).not.toHaveBeenCalled();
  });

  it("forwards explicit autoplay to the video player", async () => {
    await renderPanel("/tmp/clip.mp4", "clip.mp4", true);

    expect(
      container
        .querySelector('[data-testid="video-player"]')
        ?.getAttribute("data-autoplay"),
    ).toBe("true");
  });

  it("keeps existing text preview loading", async () => {
    await renderPanel("/tmp/notes.md", "notes.md");

    expect(readFile).toHaveBeenCalledWith("/tmp/notes.md");
  });
});

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
