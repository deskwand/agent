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
  { name: "report.docx", isDir: false, size: 900, ext: "docx" },
  { name: "legacy.doc", isDir: false, size: 700, ext: "doc" },
];

describe("FileBrowser open routing", () => {
  let container: HTMLDivElement;
  let root: Root;
  let navigate: ReturnType<typeof vi.fn>;
  let openPath: ReturnType<typeof vi.fn>;
  let renderOfficePreview: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    useAppStore.setState(useAppStore.getInitialState());
    useAppStore.setState({ workingDir: "/repo" });

    navigate = vi.fn();
    openPath = vi.fn(async () => ({ error: null }));
    renderOfficePreview = vi.fn(async () => ({
      ok: true,
      outPath: "/tmp/deskwand-office-preview/deadbeef.html",
    }));
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: {
        listDirectory: vi.fn(async () => ENTRIES),
        browser: { navigate },
        openPath,
        file: { renderOfficePreview },
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

  it("renders an office row and opens the generated html in the built-in browser", async () => {
    await doubleClickRow("report.docx");

    expect(renderOfficePreview).toHaveBeenCalledWith("/repo/report.docx");
    expect(navigate).toHaveBeenCalledWith(
      "file:///tmp/deskwand-office-preview/deadbeef.html",
    );
    expect(openPath).not.toHaveBeenCalled();
  });

  it("falls back to the system opener when office rendering fails", async () => {
    renderOfficePreview.mockResolvedValueOnce({
      ok: false,
      reason: "binary-missing",
    });

    await doubleClickRow("report.docx");

    expect(openPath).toHaveBeenCalledWith("/repo/report.docx");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("keeps legacy office formats on the system opener", async () => {
    // .doc 不是 OOXML，officecli 渲染不了 → 必须留在系统程序那条路。
    // （拿 .zip 测是测不到这件事的。）
    await doubleClickRow("legacy.doc");

    expect(renderOfficePreview).not.toHaveBeenCalled();
    expect(openPath).toHaveBeenCalledWith("/repo/legacy.doc");
    expect(navigate).not.toHaveBeenCalled();
  });
});
