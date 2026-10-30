/**
 * 消息区分割树：纯函数、不可变，不依赖 React / store。
 */

export type PaneId = string;
export type SplitDir = "row" | "column"; // row = 左右
export type SplitSide = "before" | "after";
export type SplitNode =
  | { kind: "leaf"; paneId: PaneId; sessionId: string | null }
  | { kind: "split"; dir: SplitDir; ratio: number; a: SplitNode; b: SplitNode };
export type NodePath = Array<"a" | "b">;
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

type LeafNode = Extract<SplitNode, { kind: "leaf" }>;

export const MAX_PANES = 4;
export const MIN_PANE_WIDTH = 360;
export const MIN_PANE_HEIGHT = 240;
export const MIN_RATIO = 0.15;
export const MAX_RATIO = 0.85;

function clampRatio(ratio: number): number {
  const r = Number.isFinite(ratio) ? ratio : 0.5;
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, r));
}

export function createLeaf(
  sessionId: string | null,
  paneId: PaneId = crypto.randomUUID(),
): SplitNode {
  return { kind: "leaf", paneId, sessionId };
}

export function listLeaves(root: SplitNode): LeafNode[] {
  if (root.kind === "leaf") return [root];
  return [...listLeaves(root.a), ...listLeaves(root.b)];
}

export function countLeaves(root: SplitNode): number {
  return listLeaves(root).length;
}

export function findLeaf(root: SplitNode, paneId: PaneId): LeafNode | null {
  return listLeaves(root).find((l) => l.paneId === paneId) ?? null;
}

export function findPaneBySession(
  root: SplitNode,
  sessionId: string,
): PaneId | null {
  return (
    listLeaves(root).find((l) => l.sessionId === sessionId)?.paneId ?? null
  );
}

export function splitLeaf(
  root: SplitNode,
  paneId: PaneId,
  dir: SplitDir,
  side: SplitSide,
  newLeaf: SplitNode,
): SplitNode {
  if (root.kind === "leaf") {
    if (root.paneId !== paneId) return root;
    return {
      kind: "split",
      dir,
      ratio: 0.5,
      a: side === "before" ? newLeaf : root,
      b: side === "before" ? root : newLeaf,
    };
  }
  const a = splitLeaf(root.a, paneId, dir, side, newLeaf);
  const b = splitLeaf(root.b, paneId, dir, side, newLeaf);
  if (a === root.a && b === root.b) return root;
  return { ...root, a, b };
}

export function removeLeaf(root: SplitNode, paneId: PaneId): SplitNode {
  if (root.kind === "leaf") return root;
  if (root.a.kind === "leaf" && root.a.paneId === paneId) return root.b;
  if (root.b.kind === "leaf" && root.b.paneId === paneId) return root.a;
  const a = removeLeaf(root.a, paneId);
  const b = removeLeaf(root.b, paneId);
  if (a === root.a && b === root.b) return root;
  return { ...root, a, b };
}

export function setLeafSession(
  root: SplitNode,
  paneId: PaneId,
  sessionId: string | null,
): SplitNode {
  if (root.kind === "leaf") {
    return root.paneId === paneId ? { ...root, sessionId } : root;
  }
  const a = setLeafSession(root.a, paneId, sessionId);
  const b = setLeafSession(root.b, paneId, sessionId);
  if (a === root.a && b === root.b) return root;
  return { ...root, a, b };
}

export function setRatioAt(
  root: SplitNode,
  path: NodePath,
  ratio: number,
): SplitNode {
  if (root.kind === "leaf") return root;
  if (path.length === 0) return { ...root, ratio: clampRatio(ratio) };
  const [head, ...rest] = path;
  return { ...root, [head]: setRatioAt(root[head], rest, ratio) };
}

export function canSplit(
  root: SplitNode,
  paneRect: Rect,
  dir: SplitDir,
): { ok: true } | { ok: false; reason: "limit" | "space" } {
  if (countLeaves(root) >= MAX_PANES) return { ok: false, reason: "limit" };
  const enough =
    dir === "row"
      ? paneRect.width >= MIN_PANE_WIDTH * 2
      : paneRect.height >= MIN_PANE_HEIGHT * 2;
  return enough ? { ok: true } : { ok: false, reason: "space" };
}

export function layoutRects(root: SplitNode, bounds: Rect): Map<PaneId, Rect> {
  const out = new Map<PaneId, Rect>();
  const walk = (node: SplitNode, rect: Rect): void => {
    if (node.kind === "leaf") {
      out.set(node.paneId, rect);
      return;
    }
    if (node.dir === "row") {
      const w = rect.width * node.ratio;
      walk(node.a, { ...rect, width: w });
      walk(node.b, { ...rect, x: rect.x + w, width: rect.width - w });
    } else {
      const h = rect.height * node.ratio;
      walk(node.a, { ...rect, height: h });
      walk(node.b, { ...rect, y: rect.y + h, height: rect.height - h });
    }
  };
  walk(root, bounds);
  return out;
}

const EPS = 1;

function overlap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.min(a1, b1) - Math.max(a0, b0);
}

export function findNeighborPane(
  root: SplitNode,
  bounds: Rect,
  from: PaneId,
  direction: "left" | "right" | "up" | "down",
): PaneId | null {
  const rects = layoutRects(root, bounds);
  const src = rects.get(from);
  if (!src) return null;
  let best: PaneId | null = null;
  let bestOverlap = 0;
  for (const [id, r] of rects) {
    if (id === from) continue;
    let adjacent: boolean;
    let ov: number;
    if (direction === "left" || direction === "right") {
      adjacent =
        direction === "right"
          ? Math.abs(r.x - (src.x + src.width)) < EPS
          : Math.abs(r.x + r.width - src.x) < EPS;
      ov = overlap(src.y, src.y + src.height, r.y, r.y + r.height);
    } else {
      adjacent =
        direction === "down"
          ? Math.abs(r.y - (src.y + src.height)) < EPS
          : Math.abs(r.y + r.height - src.y) < EPS;
      ov = overlap(src.x, src.x + src.width, r.x, r.x + r.width);
    }
    if (adjacent && ov > bestOverlap) {
      best = id;
      bestOverlap = ov;
    }
  }
  return best;
}

export function nearestLeafAfterRemoval(
  root: SplitNode,
  paneId: PaneId,
): PaneId | null {
  if (root.kind === "leaf") return null;
  if (root.a.kind === "leaf" && root.a.paneId === paneId) {
    return listLeaves(root.b)[0]?.paneId ?? null;
  }
  if (root.b.kind === "leaf" && root.b.paneId === paneId) {
    return listLeaves(root.a)[0]?.paneId ?? null;
  }
  return (
    nearestLeafAfterRemoval(root.a, paneId) ??
    nearestLeafAfterRemoval(root.b, paneId)
  );
}

export function serializeTree(root: SplitNode): string {
  return JSON.stringify(root);
}

function parseNode(value: unknown): SplitNode | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (v.kind === "leaf") {
    if (typeof v.paneId !== "string" || v.paneId === "") return null;
    if (v.sessionId !== null && typeof v.sessionId !== "string") return null;
    return { kind: "leaf", paneId: v.paneId, sessionId: v.sessionId };
  }
  if (v.kind === "split") {
    if (v.dir !== "row" && v.dir !== "column") return null;
    const a = parseNode(v.a);
    const b = parseNode(v.b);
    if (!a || !b) return null;
    const ratio = typeof v.ratio === "number" ? v.ratio : Number.NaN;
    return { kind: "split", dir: v.dir, ratio: clampRatio(ratio), a, b };
  }
  return null;
}

export function deserializeTree(raw: string): SplitNode | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const tree = parseNode(parsed);
  if (!tree || countLeaves(tree) > MAX_PANES) return null;
  return tree;
}

/** 当前可见区域里的会话 id；分屏区未挂载（设置页、浏览器全屏等）时为空。 */
export function visiblePaneSessionIds(
  root: SplitNode,
  splitMounted: boolean,
): Set<string> {
  if (!splitMounted) return new Set();
  return new Set(
    listLeaves(root).flatMap((l) => (l.sessionId ? [l.sessionId] : [])),
  );
}

/**
 * 每个分割节点的分隔线：rect 是 a/b 交界处的零厚度线段（row 为竖线、column 为横线），
 * size 是该节点沿分割方向的总长度（把拖拽位移换算成比例用）。
 */
export function layoutDividers(
  root: SplitNode,
  bounds: Rect,
): Array<{ path: NodePath; dir: SplitDir; rect: Rect; size: number }> {
  const out: Array<{
    path: NodePath;
    dir: SplitDir;
    rect: Rect;
    size: number;
  }> = [];
  const walk = (node: SplitNode, rect: Rect, path: NodePath): void => {
    if (node.kind === "leaf") return;
    if (node.dir === "row") {
      const w = rect.width * node.ratio;
      out.push({
        path,
        dir: "row",
        rect: { x: rect.x + w, y: rect.y, width: 0, height: rect.height },
        size: rect.width,
      });
      walk(node.a, { ...rect, width: w }, [...path, "a"]);
      walk(node.b, { ...rect, x: rect.x + w, width: rect.width - w }, [
        ...path,
        "b",
      ]);
    } else {
      const h = rect.height * node.ratio;
      out.push({
        path,
        dir: "column",
        rect: { x: rect.x, y: rect.y + h, width: rect.width, height: 0 },
        size: rect.height,
      });
      walk(node.a, { ...rect, height: h }, [...path, "a"]);
      walk(node.b, { ...rect, y: rect.y + h, height: rect.height - h }, [
        ...path,
        "b",
      ]);
    }
  };
  walk(root, bounds, []);
  return out;
}
