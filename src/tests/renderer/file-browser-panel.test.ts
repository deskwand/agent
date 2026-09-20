// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileBrowser } from "../../renderer/components/FileBrowser";
import { useAppStore } from "../../renderer/store";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      options?.count === undefined ? key : `${key}:${options.count}`,
  }),
}));

type Entry = { name: string; isDir: boolean; size: number; ext: string };
type Scan = {
  files: Array<{ relPath: string; size: number }>;
  truncated: boolean;
};

const DISK: Record<string, Entry[]> = {
  "/repo": [
    { name: "src", isDir: true, size: 0, ext: "" },
    { name: "empty", isDir: true, size: 0, ext: "" },
    { name: "README.md", isDir: false, size: 30, ext: ".md" },
  ],
  "/repo/src": [{ name: "main.ts", isDir: false, size: 120, ext: ".ts" }],
  "/repo/empty": [],
};

const REPO_SCAN: Scan = {
  files: [
    { relPath: "src/main.ts", size: 120 },
    { relPath: "README.md", size: 30 },
  ],
  truncated: false,
};

const OTHER_SCAN: Scan = {
  files: [{ relPath: "README.md", size: 99 }],
  truncated: false,
};

describe("FileBrowser panel", () => {
  let container: HTMLDivElement;
  let root: Root;
  let listDirectory: ReturnType<typeof vi.fn>;
  let scanWorkspaceFiles: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    useAppStore.setState(useAppStore.getInitialState());
    useAppStore.setState({ workingDir: "/repo" });
    listDirectory = vi.fn(async (dirPath: string) => DISK[dirPath] ?? []);
    scanWorkspaceFiles = vi.fn(async (dirPath: string) =>
      dirPath === "/other" ? OTHER_SCAN : REPO_SCAN,
    );
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: {
        listDirectory,
        scanWorkspaceFiles,
        openPath: vi.fn(async () => ({ error: null })),
        browser: { navigate: vi.fn() },
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

  async function flush(times = 3) {
    await act(async () => {
      for (let i = 0; i < times; i += 1) await Promise.resolve();
    });
  }

  async function render() {
    await act(async () => {
      root.render(React.createElement(FileBrowser, { width: 320 }));
    });
    await flush();
  }

  /** 受控 input：必须走原生 setter + input 事件，React 才认这次变更。 */
  async function type(value: string) {
    const input = container.querySelector("input");
    if (!input) throw new Error("filter input not found");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await flush();
  }

  /** 筛选结果行是 <button>；树行是 <div>。清空筛选的 X 按钮不算结果行。 */
  function resultRows(): string[] {
    // 筛选结果行是 `<div role="button">` 而不是 `<button>`：行内要放
    // "用系统程序打开" 的按钮，而嵌套 <button> 是非法 HTML。
    // 图标按钮的 textContent 为空，会被下面的长度过滤掉，不会造成噪声。
    return Array.from(container.querySelectorAll('button, [role="button"]'))
      .map((row) => row.textContent ?? "")
      .filter((text) => text.length > 0 && text !== "fileBrowser.clearFilter");
  }

  function visibleText(): string {
    return container.textContent ?? "";
  }

  it("switches from the tree to flat matches once a query is typed", async () => {
    await render();
    expect(resultRows()).toEqual([]);

    await type("main");

    expect(scanWorkspaceFiles).toHaveBeenCalledWith("/repo");
    expect(resultRows()).toHaveLength(1);
    expect(resultRows()[0]).toContain("main.ts");
  });

  it("rescans the new workspace instead of reporting no matches", async () => {
    await render();
    await type("README");
    expect(resultRows()[0]).toContain("README.md");

    await act(async () => {
      useAppStore.setState({ workingDir: "/other" });
    });
    await flush();

    expect(scanWorkspaceFiles).toHaveBeenCalledWith("/other");
    expect(visibleText()).not.toContain("fileBrowser.filterNoMatch");
    expect(resultRows()[0]).toContain("99 B");
  });

  it("ignores a scan of the previous workspace that resolves late", async () => {
    let releaseFirst: (() => void) | undefined;
    scanWorkspaceFiles.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseFirst = () => resolve(REPO_SCAN);
        }),
    );

    await render();
    await type("main");
    expect(releaseFirst).toBeTypeOf("function");

    await act(async () => {
      useAppStore.setState({ workingDir: "/other" });
    });
    await flush();
    releaseFirst?.();
    await flush();

    // /repo 的迟到结果不得渲染成当前工作区（/other）的行
    expect(resultRows().join("|")).not.toContain("main.ts");
    expect(scanWorkspaceFiles).toHaveBeenCalledWith("/other");
  });

  it("says so when the scan was truncated even if nothing matched", async () => {
    scanWorkspaceFiles.mockImplementation(async () => ({
      files: [{ relPath: "a.txt", size: 1 }],
      truncated: true,
    }));

    await render();
    await type("zzzz");

    expect(visibleText()).toContain("fileBrowser.filterNoMatch");
    expect(visibleText()).toContain("fileBrowser.filterIncomplete");
  });

  it("shows the empty hint for an expanded folder with no children", async () => {
    await render();
    expect(visibleText()).not.toContain("fileBrowser.emptyDir");

    const label = Array.from(container.querySelectorAll("span")).find(
      (span) => span.textContent === "empty",
    );
    expect(label).toBeTruthy();
    await act(async () => {
      label?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    expect(visibleText()).toContain("fileBrowser.emptyDir");
  });
});
