/**
 * 消息区分屏 store：分割树 + 聚焦区域，并与 useAppStore.activeSessionId 双向同步
 * （全局 activeSessionId 恒等于聚焦区域的会话）。
 */
import { create } from "zustand";
import { useAppStore } from "./index";
import {
  countLeaves,
  createLeaf,
  deserializeTree,
  findLeaf,
  findPaneBySession,
  listLeaves,
  MAX_PANES,
  nearestLeafAfterRemoval,
  removeLeaf,
  serializeTree,
  setLeafSession,
  setRatioAt,
  splitLeaf,
  type NodePath,
  type PaneId,
  type SplitDir,
  type SplitNode,
  type SplitSide,
} from "./split-tree";

export const SPLIT_LAYOUT_STORAGE_KEY = "deskwand.splitLayout";

interface SplitLayoutState {
  root: SplitNode;
  focusedPaneId: PaneId;
  /** 欢迎页提交时记下的发起区域：新会话创建完成后落到这里，而不是当时聚焦的区域。 */
  newSessionTargetPaneId: PaneId | null;
  splitPane(
    paneId: PaneId,
    dir: SplitDir,
    side: SplitSide,
    sessionId?: string | null,
  ): PaneId | null;
  closePane(paneId: PaneId): void;
  setPaneSession(paneId: PaneId, sessionId: string | null): void;
  setRatio(path: NodePath, ratio: number): void;
  focusPane(paneId: PaneId): void;
  markNewSessionTarget(paneId: PaneId | null): void;
}

function leafPaneId(node: SplitNode): PaneId {
  return node.kind === "leaf" ? node.paneId : "";
}

const initialLeaf = createLeaf(useAppStore.getState().activeSessionId);

/** 把聚焦叶子的会话推给全局；已相等时 app store 的订阅会跳过，不会重入。 */
function pushFocusedSessionToApp(): void {
  const { root, focusedPaneId } = useSplitLayoutStore.getState();
  const leaf = findLeaf(root, focusedPaneId);
  if (!leaf) return;
  const app = useAppStore.getState();
  if (app.activeSessionId !== leaf.sessionId) {
    app.setActiveSession(leaf.sessionId);
  }
}

export const useSplitLayoutStore = create<SplitLayoutState>()((set, get) => ({
  root: initialLeaf,
  focusedPaneId: leafPaneId(initialLeaf),
  newSessionTargetPaneId: null,

  splitPane: (paneId, dir, side, sessionId = null) => {
    const { root } = get();
    if (!findLeaf(root, paneId) || countLeaves(root) >= MAX_PANES) return null;
    if (sessionId) {
      const existing = findPaneBySession(root, sessionId);
      if (existing) {
        get().focusPane(existing);
        return null;
      }
    }
    const newLeaf = createLeaf(sessionId);
    set({
      root: splitLeaf(root, paneId, dir, side, newLeaf),
      focusedPaneId: leafPaneId(newLeaf),
    });
    pushFocusedSessionToApp();
    return leafPaneId(newLeaf);
  },

  closePane: (paneId) => {
    const { root, focusedPaneId } = get();
    if (!findLeaf(root, paneId) || countLeaves(root) <= 1) return;
    const next = nearestLeafAfterRemoval(root, paneId);
    const newRoot = removeLeaf(root, paneId);
    if (paneId === focusedPaneId && next) {
      set({ root: newRoot, focusedPaneId: next });
      pushFocusedSessionToApp();
    } else {
      set({ root: newRoot });
    }
  },

  setPaneSession: (paneId, sessionId) => {
    const { root, focusedPaneId } = get();
    if (!findLeaf(root, paneId)) return;
    if (sessionId) {
      const existing = findPaneBySession(root, sessionId);
      if (existing === paneId) return;
      if (existing) {
        get().focusPane(existing);
        return;
      }
    }
    set({ root: setLeafSession(root, paneId, sessionId) });
    if (paneId === focusedPaneId) pushFocusedSessionToApp();
  },

  setRatio: (path, ratio) => {
    set((s) => ({ root: setRatioAt(s.root, path, ratio) }));
  },

  focusPane: (paneId) => {
    if (!findLeaf(get().root, paneId)) return;
    set({ focusedPaneId: paneId });
    pushFocusedSessionToApp();
  },

  markNewSessionTarget: (paneId) => {
    set({ newSessionTargetPaneId: paneId });
  },
}));

export function useFocusedPaneId(): PaneId {
  return useSplitLayoutStore((s) => s.focusedPaneId);
}

export function usePaneCount(): number {
  return useSplitLayoutStore((s) => countLeaves(s.root));
}

function readStored(): string | null {
  try {
    return localStorage.getItem(SPLIT_LAYOUT_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStored(root: SplitNode): void {
  try {
    localStorage.setItem(SPLIT_LAYOUT_STORAGE_KEY, serializeTree(root));
  } catch {
    /* ignore */
  }
}

/** 全局 → 区域：清理失效会话，并让聚焦区域跟随 activeSessionId。 */
function reconcileFromApp(
  skipPruneWhenNoSessions: boolean,
  sessionsJustLoaded = false,
): void {
  const app = useAppStore.getState();
  const layout = useSplitLayoutStore.getState();

  let root = layout.root;
  if (!(skipPruneWhenNoSessions && app.sessions.length === 0)) {
    // 已归档会话不进分屏，但用户正在看的那条（active）要保留，否则选中即被弹回。
    const valid = new Set(
      app.sessions
        .filter((s) => !s.archived || s.id === app.activeSessionId)
        .map((s) => s.id),
    );
    for (const leaf of listLeaves(root)) {
      if (leaf.sessionId && !valid.has(leaf.sessionId)) {
        root = setLeafSession(root, leaf.paneId, null);
      }
    }
  }

  const focused = findLeaf(root, layout.focusedPaneId);
  if (!focused) return;
  const active = app.activeSessionId;
  // 启动时会话列表还没到（或刚到、active 尚未恢复）：null 不代表「清空聚焦区域」。
  if (
    active === null &&
    focused.sessionId !== null &&
    (app.sessions.length === 0 || sessionsJustLoaded)
  ) {
    if (root !== layout.root) useSplitLayoutStore.setState({ root });
    // useIPC 只会恢复仍存在的 lastSessionId；它不在了就不会再有 setActiveSession，
    // 这里把聚焦区域的会话回写全局，免得侧栏 / 右侧面板与聚焦区域对不上。
    if (sessionsJustLoaded) {
      const lastId = readLastSessionId();
      if (!lastId || !app.sessions.some((s) => s.id === lastId)) {
        const kept = findLeaf(root, layout.focusedPaneId)?.sessionId ?? null;
        if (kept) app.setActiveSession(kept);
      }
    }
    return;
  }
  const activeIsValid =
    active === null ||
    app.sessions.length === 0 ||
    app.sessions.some((s) => s.id === active);

  if (active === focused.sessionId) {
    if (root !== layout.root) useSplitLayoutStore.setState({ root });
    return;
  }
  // 目标只用一次：不论这次是否真的落在目标区域，都清掉，避免陈旧目标劫持之后的切换。
  const target = layout.newSessionTargetPaneId;
  if (target !== null) {
    useSplitLayoutStore.setState({ newSessionTargetPaneId: null });
  }
  if (!activeIsValid) {
    // 全局指向了已删除的会话：以聚焦区域为准回写全局。
    if (root !== layout.root) useSplitLayoutStore.setState({ root });
    app.setActiveSession(focused.sessionId);
    return;
  }
  const existing = active ? findPaneBySession(root, active) : null;
  if (existing) {
    useSplitLayoutStore.setState({ root, focusedPaneId: existing });
    return;
  }
  if (target !== null && findLeaf(root, target)) {
    useSplitLayoutStore.setState({
      root: setLeafSession(root, target, active),
      focusedPaneId: target,
    });
    return;
  }
  useSplitLayoutStore.setState({
    root: setLeafSession(root, focused.paneId, active),
  });
}

export function installSplitLayoutSync(): () => void {
  const raw = readStored();
  if (raw !== null) {
    const tree = deserializeTree(raw);
    const app = useAppStore.getState();
    if (tree) {
      const leaves = listLeaves(tree);
      const restoreId = app.activeSessionId ?? readLastSessionId();
      const holder = restoreId ? findPaneBySession(tree, restoreId) : null;
      useSplitLayoutStore.setState({
        root: tree,
        focusedPaneId: holder ?? leaves[0].paneId,
      });
    } else {
      console.warn(
        "[split-layout] invalid persisted layout, using single pane",
      );
      const leaf = createLeaf(app.activeSessionId);
      useSplitLayoutStore.setState({
        root: leaf,
        focusedPaneId: leafPaneId(leaf),
      });
    }
  }
  reconcileFromApp(true);

  const unsubApp = useAppStore.subscribe((state, prev) => {
    if (
      state.activeSessionId !== prev.activeSessionId ||
      state.sessions !== prev.sessions
    ) {
      reconcileFromApp(
        false,
        prev.sessions.length === 0 && state.sessions.length > 0,
      );
    }
  });
  const unsubLayout = useSplitLayoutStore.subscribe((state, prev) => {
    if (state.root !== prev.root) writeStored(state.root);
  });
  return () => {
    unsubApp();
    unsubLayout();
  };
}

function readLastSessionId(): string | null {
  try {
    return localStorage.getItem("deskwand.lastSessionId");
  } catch {
    return null;
  }
}
