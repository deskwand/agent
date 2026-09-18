// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileBrowser } from "../../renderer/components/FileBrowser";
import { useAppStore } from "../../renderer/store";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const ENTRIES = [
  { name: "index.html", isDir: false, size: 120, ext: "html" },
  { name: "notes.md", isDir: false, size: 30, ext: "md" },
  { name: "bundle.zip", isDir: false, size: 4000, ext: "zip" },
];

describe("FileBrowser open routing", () => {
  let container: HTMLDivElement;
  let root: Root;
  let navigate: ReturnType<typeof vi.fn>;
  let openPath: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    useAppStore.setState(useAppStore.getInitialState());
    useAppStore.setState({ workingDir: "/repo" });

    navigate = vi.fn();
    openPath = vi.fn(async () => ({ error: null }));
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: {
        listDirectory: vi.fn(async () => ENTRIES),
        browser: { navigate },
        openPath,
      },
    });

    container = document.createElement("div");
    document.body.innerHTML = "";
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    vi.restoreAllMocks();
  });

  async function doubleClickRow(name: string): Promise<void> {
    await act(async () => {
      root.render(React.createElement(FileBrowser, { width: 320 }));
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // 双击名称 span（事件冒泡到行的 onDoubleClick）；行内还有 size 文本，
    // 所以不能用「行 textContent 完全相等」来定位行。
    const label = Array.from(
      container.querySelectorAll<HTMLElement>("span"),
    ).find((element) => element.textContent === name);
    if (!label) {
      throw new Error(`File row label not found: ${name}`);
    }

    await act(async () => {
      label.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      await Promise.resolve();
    });
  }

  it("opens an html row in the built-in browser", async () => {
    await doubleClickRow("index.html");

    expect(navigate).toHaveBeenCalledWith("file:///repo/index.html");
    expect(useAppStore.getState().rightPanelMode).toBe("browser");
    expect(useAppStore.getState().previewTabs).toEqual([]);
    expect(openPath).not.toHaveBeenCalled();
  });

  it("keeps non-browser types on the system opener", async () => {
    await doubleClickRow("bundle.zip");

    expect(openPath).toHaveBeenCalledWith("/repo/bundle.zip");
    expect(navigate).not.toHaveBeenCalled();
    expect(useAppStore.getState().previewTabs).toEqual([]);
  });

  it("routes previewable rows into the preview panel", async () => {
    await doubleClickRow("notes.md");

    expect(useAppStore.getState().rightPanelMode).toBe("preview");
    expect(useAppStore.getState().previewTabs).toEqual([
      { path: "/repo/notes.md", name: "notes.md" },
    ]);
    expect(navigate).not.toHaveBeenCalled();
    expect(openPath).not.toHaveBeenCalled();
  });
});
