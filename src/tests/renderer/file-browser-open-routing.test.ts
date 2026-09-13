// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileBrowser } from "../../renderer/components/FileBrowser";
import { useAppStore } from "../../renderer/store";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// 把预览弹窗换成轻量 stub：既能直接断言「有没有进预览」，
// 也避免在 jsdom 里挂载真实的 FilePreviewModal（它会拖住 act 不收敛）。
vi.mock("../../renderer/components/FilePreviewModal", () => ({
  FilePreviewModal: ({ fileName }: { fileName: string }) =>
    React.createElement("div", { "data-testid": "preview-modal" }, fileName),
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
    // 弹窗走 createPortal 挂到 document.body，因此断言时要查 body。
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
    expect(
      document.body.querySelector('[data-testid="preview-modal"]'),
    ).toBeNull();
    expect(openPath).not.toHaveBeenCalled();
  });

  it("keeps non-browser types on the system opener", async () => {
    await doubleClickRow("bundle.zip");

    expect(openPath).toHaveBeenCalledWith("/repo/bundle.zip");
    expect(navigate).not.toHaveBeenCalled();
    expect(
      document.body.querySelector('[data-testid="preview-modal"]'),
    ).toBeNull();
  });

  it("keeps previewable rows on the in-app preview", async () => {
    await doubleClickRow("notes.md");

    expect(
      document.body.querySelector('[data-testid="preview-modal"]'),
    ).not.toBeNull();
    expect(navigate).not.toHaveBeenCalled();
    expect(openPath).not.toHaveBeenCalled();
  });
});
