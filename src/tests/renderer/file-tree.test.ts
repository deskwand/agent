// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFileTree } from "../../renderer/hooks/use-file-tree";

type Entry = {
  name: string;
  isDir: boolean;
  size: number;
  ext: string;
};

const DISK: Record<string, Entry[]> = {
  "/repo": [
    { name: "src", isDir: true, size: 0, ext: "" },
    { name: "README.md", isDir: false, size: 30, ext: ".md" },
  ],
  "/repo/src": [
    { name: "components", isDir: true, size: 0, ext: "" },
    { name: "main.ts", isDir: false, size: 120, ext: ".ts" },
  ],
  "/repo/src/components": [
    { name: "Button.tsx", isDir: false, size: 210, ext: ".tsx" },
  ],
  "/parents": [{ name: "hollow", isDir: true, size: 0, ext: "" }],
  "/parents/hollow": [],
};

let latest: ReturnType<typeof useFileTree> | null = null;

function Harness({ root }: { root: string }) {
  latest = useFileTree(root);
  return React.createElement("div", null, String(latest.rows.length));
}

describe("useFileTree", () => {
  let container: HTMLDivElement;
  let root: Root;
  let listDirectory: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    listDirectory = vi.fn(async (dirPath: string) => DISK[dirPath] ?? []);
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: { listDirectory },
    });
    container = document.createElement("div");
    document.body.innerHTML = "";
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    vi.restoreAllMocks();
    latest = null;
  });

  async function flush() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  async function mount(rootPath: string) {
    await act(async () => {
      root.render(React.createElement(Harness, { root: rootPath }));
    });
    await flush();
  }

  function api() {
    if (!latest) throw new Error("hook not mounted");
    return latest;
  }

  function paths(dirPath: string) {
    return listDirectory.mock.calls.filter(([p]) => p === dirPath);
  }

  it("loads the root on mount and flattens it into rows", async () => {
    await mount("/repo");

    expect(listDirectory).toHaveBeenCalledWith("/repo");
    expect(api().rows).toEqual([
      {
        path: "/repo/src",
        name: "src",
        isDir: true,
        size: 0,
        depth: 0,
        expanded: false,
      },
      {
        path: "/repo/README.md",
        name: "README.md",
        isDir: false,
        size: 30,
        depth: 0,
        expanded: false,
      },
    ]);
    expect(api().rootLoading).toBe(false);
  });

  it("expands in place so children and siblings are visible at once", async () => {
    await mount("/repo");
    await act(async () => api().toggle("/repo/src"));
    await flush();

    expect(
      api().rows.map((row) => [row.path, row.depth, row.expanded]),
    ).toEqual([
      ["/repo/src", 0, true],
      ["/repo/src/components", 1, false],
      ["/repo/src/main.ts", 1, false],
      ["/repo/README.md", 0, false],
    ]);
  });

  it("nests a second level and collapses it independently", async () => {
    await mount("/repo");
    await act(async () => api().toggle("/repo/src"));
    await flush();
    await act(async () => api().toggle("/repo/src/components"));
    await flush();

    expect(api().rows.map((row) => [row.path, row.depth])).toEqual([
      ["/repo/src", 0],
      ["/repo/src/components", 1],
      ["/repo/src/components/Button.tsx", 2],
      ["/repo/src/main.ts", 1],
      ["/repo/README.md", 0],
    ]);

    await act(async () => api().toggle("/repo/src"));
    await flush();

    expect(api().rows.map((row) => row.path)).toEqual([
      "/repo/src",
      "/repo/README.md",
    ]);
  });

  it("re-reads a directory on every expand instead of caching it", async () => {
    await mount("/repo");
    await act(async () => api().toggle("/repo/src"));
    await flush();
    await act(async () => api().toggle("/repo/src")); // 收起
    await flush();
    await act(async () => api().toggle("/repo/src")); // 再展开 = 刷新
    await flush();

    expect(paths("/repo/src")).toHaveLength(2);
  });

  it("dedupes concurrent expands of the same directory", async () => {
    await mount("/repo");

    let release: (() => void) | undefined;
    listDirectory.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve(DISK["/repo/src"]);
        }),
    );

    await act(async () => {
      api().toggle("/repo/src");
      api().toggle("/repo/src");
    });
    release?.();
    await flush();

    expect(paths("/repo/src")).toHaveLength(1);
    expect(api().rows.map((row) => row.path)).toContain("/repo/src/main.ts");
  });

  it("reports an expanded directory with no children as empty", async () => {
    await mount("/parents");
    expect(api().isEmpty("/parents/hollow")).toBe(false);

    await act(async () => api().toggle("/parents/hollow"));
    await flush();

    expect(api().isEmpty("/parents/hollow")).toBe(true);
    await act(async () => api().toggle("/parents/hollow"));
    await flush();
    expect(api().isEmpty("/parents/hollow")).toBe(false);
  });

  it("does not call a directory with children empty", async () => {
    await mount("/repo");
    await act(async () => api().toggle("/repo/src"));
    await flush();

    expect(api().isEmpty("/repo/src")).toBe(false);
  });

  it("rebuilds the whole tree when the root changes", async () => {
    await mount("/repo");
    await act(async () => api().toggle("/repo/src"));
    await flush();
    expect(api().rows).toHaveLength(4);

    await act(async () => {
      root.render(React.createElement(Harness, { root: "/repo/src" }));
    });
    await flush();

    expect(listDirectory).toHaveBeenCalledWith("/repo/src");
    // 旧根的展开状态与行都清空了，只剩新根的两个条目
    expect(api().rows.map((row) => [row.path, row.depth])).toEqual([
      ["/repo/src/components", 0],
      ["/repo/src/main.ts", 0],
    ]);
  });

  it("does not touch the disk when there is no root", async () => {
    await mount("");

    expect(listDirectory).not.toHaveBeenCalled();
    expect(api().rows).toEqual([]);
    expect(api().rootLoading).toBe(false);
  });
});
