import { useState, type DragEvent, type ReactNode } from "react";
import { useSplitLayoutStore } from "../../store/split-layout";
import {
  canSplit,
  type PaneId,
  type Rect,
  type SplitDir,
  type SplitSide,
} from "../../store/split-tree";
import { useSplitRectsStore } from "./split-rects-context";

export const SESSION_DRAG_MIME = "application/x-deskwand-session";

export type DropTarget =
  | { kind: "split"; dir: SplitDir; side: SplitSide }
  | { kind: "replace" };

const EDGE_RATIO = 0.25;

/** 离哪条边最近且在 25% 范围内 → 分割；否则替换。 */
export function resolveDropTarget(
  rect: Rect,
  point: { x: number; y: number },
): DropTarget {
  const fx = (point.x - rect.x) / rect.width;
  const fy = (point.y - rect.y) / rect.height;
  const edges: Array<{ dist: number; target: DropTarget }> = [
    { dist: fx, target: { kind: "split", dir: "row", side: "before" } },
    { dist: 1 - fx, target: { kind: "split", dir: "row", side: "after" } },
    { dist: fy, target: { kind: "split", dir: "column", side: "before" } },
    { dist: 1 - fy, target: { kind: "split", dir: "column", side: "after" } },
  ];
  const nearest = edges.reduce((a, b) => (b.dist < a.dist ? b : a));
  return nearest.dist < EDGE_RATIO ? nearest.target : { kind: "replace" };
}

function previewClass(target: DropTarget): string {
  if (target.kind === "replace") return "inset-0";
  if (target.dir === "row") {
    return target.side === "before"
      ? "inset-y-0 left-0 w-1/4"
      : "inset-y-0 right-0 w-1/4";
  }
  return target.side === "before"
    ? "inset-x-0 top-0 h-1/4"
    : "inset-x-0 bottom-0 h-1/4";
}

function isSessionDrag(e: DragEvent): boolean {
  return Array.from(e.dataTransfer.types).includes(SESSION_DRAG_MIME);
}

/** 区域外壳：接收从侧栏拖来的会话，显示落点预览，drop 时分割或替换。 */
export function PaneDropZones({
  paneId,
  children,
}: {
  paneId: PaneId;
  children: ReactNode;
}) {
  const [target, setTarget] = useState<DropTarget | null>(null);

  const resolve = (e: DragEvent<HTMLDivElement>): DropTarget => {
    const box = e.currentTarget.getBoundingClientRect();
    const next = resolveDropTarget(
      { x: box.left, y: box.top, width: box.width, height: box.height },
      { x: e.clientX, y: e.clientY },
    );
    if (next.kind === "split") {
      // 到上限或空间不够时边缘不可用，退化为替换。
      const rect = useSplitRectsStore.getState().rects.get(paneId);
      const { root } = useSplitLayoutStore.getState();
      if (!rect || !canSplit(root, rect, next.dir).ok) {
        return { kind: "replace" };
      }
    }
    return next;
  };

  return (
    <div
      className="relative flex min-h-0 min-w-0 flex-1 flex-col"
      onDragOver={(e) => {
        if (!isSessionDrag(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setTarget(resolve(e));
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setTarget(null);
        }
      }}
      onDrop={(e) => {
        if (!isSessionDrag(e)) return;
        e.preventDefault();
        const sessionId = e.dataTransfer.getData(SESSION_DRAG_MIME);
        const resolved = resolve(e);
        setTarget(null);
        if (!sessionId) return;
        const layout = useSplitLayoutStore.getState();
        if (resolved.kind === "split") {
          layout.splitPane(paneId, resolved.dir, resolved.side, sessionId);
        } else {
          layout.focusPane(paneId);
          layout.setPaneSession(paneId, sessionId);
        }
      }}
    >
      {children}
      {target && (
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute z-20 rounded-md border border-primary/40 bg-primary/10 ${previewClass(target)}`}
        />
      )}
    </div>
  );
}
