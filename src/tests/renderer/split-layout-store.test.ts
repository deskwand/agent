// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../renderer/store";
import {
  installSplitLayoutSync,
  SPLIT_LAYOUT_STORAGE_KEY,
  useSplitLayoutStore,
} from "../../renderer/store/split-layout";
import {
  countLeaves,
  deserializeTree,
  findLeaf,
  listLeaves,
  serializeTree,
  type SplitNode,
} from "../../renderer/store/split-tree";
import type { Session } from "../../renderer/types";

function session(id: string): Session {
  return {
    id,
    kind: "ordinary",
    title: id,
    status: "idle",
    mountedPaths: [],
    allowedTools: [],
    memoryEnabled: false,
    isProjectMode: false,
    createdAt: 1,
    updatedAt: 1,
  };
}

const leaf = (paneId: string, sessionId: string | null): SplitNode => ({
  kind: "leaf",
  paneId,
  sessionId,
});

function setLayout(root: SplitNode, focusedPaneId: string): void {
  useSplitLayoutStore.setState({ root, focusedPaneId });
}

const app = () => useAppStore.getState();
const layout = () => useSplitLayoutStore.getState();
const sessionOf = (paneId: string) =>
  findLeaf(layout().root, paneId)?.sessionId;

function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => Array.from(map.keys())[index] ?? null,
    removeItem: (key) => {
      map.delete(key);
    },
    setItem: (key, value) => {
      map.set(key, String(value));
    },
  };
}

let uninstall: (() => void) | null = null;

/** P1=S1 | P2=S2，聚焦 P1，全局 active = S1 */
function twoPanes(): void {
  app().addSession(session("S1"));
  app().addSession(session("S2"));
  app().setActiveSession("S1");
  setLayout(
    {
      kind: "split",
      dir: "row",
      ratio: 0.5,
      a: leaf("P1", "S1"),
      b: leaf("P2", "S2"),
    },
    "P1",
  );
}

beforeEach(() => {
  vi.stubGlobal("localStorage", createMemoryStorage());
  useAppStore.setState(useAppStore.getInitialState(), true);
  useSplitLayoutStore.setState(useSplitLayoutStore.getInitialState(), true);
});

afterEach(() => {
  uninstall?.();
  uninstall = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("split-layout store", () => {
  it("聚焦区域同步到全局", () => {
    twoPanes();
    uninstall = installSplitLayoutSync();
    layout().focusPane("P2");
    expect(app().activeSessionId).toBe("S2");
  });

  it("外部 setActiveSession 聚焦已有区域", () => {
    twoPanes();
    uninstall = installSplitLayoutSync();
    const before = layout().root;
    app().setActiveSession("S2");
    expect(layout().focusedPaneId).toBe("P2");
    expect(layout().root).toBe(before);
    app().setActiveSession("S1");
    expect(layout().focusedPaneId).toBe("P1");
  });

  it("外部 setActiveSession 替换聚焦区域", () => {
    twoPanes();
    app().addSession(session("S3"));
    uninstall = installSplitLayoutSync();
    app().setActiveSession("S3");
    expect(sessionOf("P1")).toBe("S3");
    expect(countLeaves(layout().root)).toBe(2);
  });

  it("新会话 setActiveSession 填入聚焦的空叶子", () => {
    twoPanes();
    setLayout(
      {
        kind: "split",
        dir: "row",
        ratio: 0.5,
        a: leaf("P1", null),
        b: leaf("P2", "S2"),
      },
      "P1",
    );
    app().setActiveSession(null);
    uninstall = installSplitLayoutSync();
    app().addSession(session("S4"));
    app().setActiveSession("S4");
    expect(sessionOf("P1")).toBe("S4");
    expect(sessionOf("P2")).toBe("S2");
    expect(countLeaves(layout().root)).toBe(2);
  });

  it("setPaneSession 不允许重复", () => {
    twoPanes();
    uninstall = installSplitLayoutSync();
    layout().focusPane("P2");
    layout().setPaneSession("P2", "S1");
    expect(sessionOf("P2")).toBe("S2");
    expect(layout().focusedPaneId).toBe("P1");
  });

  it("splitPane 第 5 个返回 null", () => {
    uninstall = installSplitLayoutSync();
    const first = layout().focusedPaneId;
    const ids = [first];
    for (let i = 0; i < 3; i++) {
      const id = layout().splitPane(ids[ids.length - 1], "row", "after");
      expect(id).not.toBeNull();
      ids.push(id as string);
    }
    expect(countLeaves(layout().root)).toBe(4);
    expect(layout().splitPane(first, "row", "after")).toBeNull();
    expect(countLeaves(layout().root)).toBe(4);
  });

  it("closePane 聚焦移到兄弟", () => {
    twoPanes();
    uninstall = installSplitLayoutSync();
    layout().closePane("P1");
    expect(layout().focusedPaneId).toBe("P2");
    expect(app().activeSessionId).toBe("S2");
    layout().closePane("P2");
    expect(countLeaves(layout().root)).toBe(1);
    expect(layout().focusedPaneId).toBe("P2");
  });

  it("删除会话置空叶子", () => {
    twoPanes();
    uninstall = installSplitLayoutSync();
    app().removeSession("S2");
    expect(sessionOf("P2")).toBeNull();
    expect(countLeaves(layout().root)).toBe(2);

    layout().focusPane("P1");
    app().removeSession("S1");
    expect(sessionOf("P1")).toBeNull();
    expect(app().activeSessionId).toBeNull();
  });

  it("删除正聚焦的会话时全局为 null", () => {
    twoPanes();
    uninstall = installSplitLayoutSync();
    layout().focusPane("P2");
    app().removeSession("S2");
    expect(sessionOf("P2")).toBeNull();
    expect(app().activeSessionId).toBeNull();
  });

  it("归档会话置空叶子", () => {
    twoPanes();
    uninstall = installSplitLayoutSync();
    app().updateSession("S2", { archived: true });
    expect(sessionOf("P2")).toBeNull();
    expect(countLeaves(layout().root)).toBe(2);
  });

  it("持久化", () => {
    twoPanes();
    uninstall = installSplitLayoutSync();
    layout().splitPane("P1", "row", "after");
    const raw = localStorage.getItem(SPLIT_LAYOUT_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const tree = deserializeTree(raw as string);
    expect(tree && countLeaves(tree)).toBe(3);
  });

  it("恢复时清掉不存在的会话", () => {
    app().addSession(session("S1"));
    app().setActiveSession("S1");
    localStorage.setItem(
      SPLIT_LAYOUT_STORAGE_KEY,
      serializeTree({
        kind: "split",
        dir: "row",
        ratio: 0.5,
        a: leaf("P1", "S1"),
        b: leaf("P2", "S9"),
      }),
    );
    uninstall = installSplitLayoutSync();
    expect(sessionOf("P1")).toBe("S1");
    expect(sessionOf("P2")).toBeNull();
    expect(listLeaves(layout().root)).toHaveLength(2);
  });

  it("恢复损坏数据回退单栏", () => {
    app().addSession(session("S1"));
    app().setActiveSession("S1");
    localStorage.setItem(SPLIT_LAYOUT_STORAGE_KEY, "garbage");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    uninstall = installSplitLayoutSync();
    const leaves = listLeaves(layout().root);
    expect(leaves).toHaveLength(1);
    expect(leaves[0].sessionId).toBe(app().activeSessionId);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("split-layout restore with active session not yet known", () => {
  const stored = (): SplitNode => ({
    kind: "split",
    dir: "row",
    ratio: 0.5,
    a: leaf("P1", "S1"),
    b: leaf("P2", "S2"),
  });

  it("启动时 sessions 为空、active 为 null：保留叶子并聚焦 lastSessionId 所在区域", () => {
    localStorage.setItem(SPLIT_LAYOUT_STORAGE_KEY, serializeTree(stored()));
    localStorage.setItem("deskwand.lastSessionId", "S2");
    uninstall = installSplitLayoutSync();
    expect(sessionOf("P1")).toBe("S1");
    expect(sessionOf("P2")).toBe("S2");
    expect(layout().focusedPaneId).toBe("P2");
  });

  it("没有 lastSessionId 时聚焦第一个区域并保留叶子", () => {
    localStorage.setItem(SPLIT_LAYOUT_STORAGE_KEY, serializeTree(stored()));
    uninstall = installSplitLayoutSync();
    expect(sessionOf("P1")).toBe("S1");
    expect(sessionOf("P2")).toBe("S2");
    expect(layout().focusedPaneId).toBe("P1");
  });

  it("会话列表加载后再恢复 active，布局不变", () => {
    localStorage.setItem(SPLIT_LAYOUT_STORAGE_KEY, serializeTree(stored()));
    localStorage.setItem("deskwand.lastSessionId", "S2");
    uninstall = installSplitLayoutSync();
    app().setSessions([session("S1"), session("S2")]);
    expect(sessionOf("P1")).toBe("S1");
    expect(sessionOf("P2")).toBe("S2");
    app().setActiveSession("S2");
    expect(sessionOf("P1")).toBe("S1");
    expect(sessionOf("P2")).toBe("S2");
    expect(layout().focusedPaneId).toBe("P2");
  });

  it("lastSessionId 已失效：会话列表到达后全局取聚焦区域的会话", () => {
    localStorage.setItem(SPLIT_LAYOUT_STORAGE_KEY, serializeTree(stored()));
    localStorage.setItem("deskwand.lastSessionId", "GONE");
    uninstall = installSplitLayoutSync();
    expect(app().activeSessionId).toBeNull();
    app().setSessions([session("S1"), session("S2")]);
    expect(app().activeSessionId).toBe("S1");
    expect(sessionOf("P1")).toBe("S1");
    expect(sessionOf("P2")).toBe("S2");
  });
});

describe("new session target pane", () => {
  it("新会话落在发起提交的区域并聚焦它，而不是提交时刻聚焦的区域", () => {
    twoPanes();
    uninstall = installSplitLayoutSync();
    layout().markNewSessionTarget("P2");
    layout().focusPane("P1");
    app().addSession(session("S9"));
    app().setActiveSession("S9");
    expect(sessionOf("P2")).toBe("S9");
    expect(sessionOf("P1")).toBe("S1");
    expect(layout().focusedPaneId).toBe("P2");
    expect(app().activeSessionId).toBe("S9");
  });

  it("目标只用一次，之后的新会话落在聚焦区域", () => {
    twoPanes();
    uninstall = installSplitLayoutSync();
    layout().markNewSessionTarget("P2");
    app().addSession(session("S9"));
    app().setActiveSession("S9");
    layout().focusPane("P1");
    app().addSession(session("S8"));
    app().setActiveSession("S8");
    expect(sessionOf("P1")).toBe("S8");
    expect(sessionOf("P2")).toBe("S9");
  });

  it("目标区域已被关闭时回退到聚焦区域", () => {
    twoPanes();
    uninstall = installSplitLayoutSync();
    layout().markNewSessionTarget("P2");
    layout().closePane("P2");
    app().addSession(session("S9"));
    app().setActiveSession("S9");
    expect(sessionOf("P1")).toBe("S9");
  });
});

describe("archived active session", () => {
  it("选中已归档会话：聚焦区域显示它，全局保持不回弹", () => {
    twoPanes();
    app().addSession(session("S5"));
    app().updateSession("S5", { archived: true });
    uninstall = installSplitLayoutSync();
    app().setActiveSession("S5");
    expect(app().activeSessionId).toBe("S5");
    expect(sessionOf("P1")).toBe("S5");
    expect(sessionOf("P2")).toBe("S2");
  });

  it("当前活动的已归档会话所在叶子不会被剪掉，切走后才清空", () => {
    twoPanes();
    uninstall = installSplitLayoutSync();
    app().setActiveSession("S2");
    app().updateSession("S2", { archived: true });
    expect(sessionOf("P2")).toBe("S2");
    expect(app().activeSessionId).toBe("S2");
    app().setActiveSession("S1");
    expect(sessionOf("P2")).toBeNull();
  });
});
