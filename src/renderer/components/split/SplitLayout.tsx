import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { PaneView } from "./PaneView";
import { useSplitRectsStore } from "./split-rects-context";
import { useSplitShortcuts } from "./use-split-shortcuts";
import { useAppStore } from "../../store";
import { SplitDivider } from "./SplitDivider";
import { useSplitLayoutStore } from "../../store/split-layout";
import {
  layoutDividers,
  layoutRects,
  listLeaves,
  setRatioAt,
  type NodePath,
  type Rect,
  type SplitNode,
} from "../../store/split-tree";

const UNIT_BOUNDS: Rect = { x: 0, y: 0, width: 1, height: 1 };
/** 分隔线的命中区厚度（px），与 ResizeHandle 的 w-1 / h-1 一致。 */
const DIVIDER_THICKNESS = 4;

function ratioAt(root: SplitNode, path: NodePath): number {
  let node = root;
  for (const step of path) {
    if (node.kind !== "split") break;
    node = node[step];
  }
  return node.kind === "split" ? node.ratio : 0.5;
}

function pct(value: number): string {
  return `${value * 100}%`;
}

/**
 * 消息区：扁平渲染——每个区域一个按 paneId 作 key 的绝对定位容器，
 * 分割 / 关闭只改变位置，不会让存活区域重挂载。只有一个叶子时外观与单栏一致（无标题栏）。
 */
export function SplitLayout() {
  const root = useSplitLayoutStore((s) => s.root);
  const setRatio = useSplitLayoutStore((s) => s.setRatio);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [preview, setPreview] = useState<{
    path: NodePath;
    ratio: number;
  } | null>(null);

  const measure = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setSize((prev) =>
      prev.width === r.width && prev.height === r.height
        ? prev
        : { width: r.width, height: r.height },
    );
  }, []);

  useLayoutEffect(() => {
    measure();
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure]);

  // 拖拽预览只影响显示：setRatioAt 内部会夹到 MIN/MAX_RATIO。
  const effectiveRoot = useMemo(
    () => (preview ? setRatioAt(root, preview.path, preview.ratio) : root),
    [root, preview],
  );
  const pixelBounds = useMemo<Rect>(() => ({ x: 0, y: 0, ...size }), [size]);

  // 定位用单位矩形换成百分比，首次测量前（尺寸为 0）也能正确铺满。
  const unitRects = useMemo(
    () => layoutRects(effectiveRoot, UNIT_BOUNDS),
    [effectiveRoot],
  );
  const dividers = useMemo(
    () => layoutDividers(effectiveRoot, pixelBounds),
    [effectiveRoot, pixelBounds],
  );
  const unitDividers = useMemo(
    () => layoutDividers(effectiveRoot, UNIT_BOUNDS),
    [effectiveRoot],
  );
  // 给其它入口（能否分割 / 快捷键）的像素矩形只跟随已提交的布局，拖拽中不刷屏。
  const rects = useMemo(
    () => layoutRects(root, pixelBounds),
    [root, pixelBounds],
  );
  const showHeader = root.kind === "split";

  useLayoutEffect(() => {
    useSplitRectsStore.getState().set(rects, pixelBounds);
  }, [rects, pixelBounds]);
  useLayoutEffect(() => () => useSplitRectsStore.getState().clear(), []);

  useSplitShortcuts(useAppStore((s) => s.activeView) === "chat");

  return (
    <div
      ref={containerRef}
      className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden"
    >
      {listLeaves(effectiveRoot).map((leaf) => {
        const r = unitRects.get(leaf.paneId);
        if (!r) return null;
        return (
          <div
            key={leaf.paneId}
            className="absolute flex min-h-0 min-w-0"
            style={{
              left: pct(r.x),
              top: pct(r.y),
              width: pct(r.width),
              height: pct(r.height),
            }}
          >
            <PaneView
              paneId={leaf.paneId}
              sessionId={leaf.sessionId}
              showHeader={showHeader}
            />
          </div>
        );
      })}
      {dividers.map((d, i) => {
        const u = unitDividers[i].rect;
        const isRow = d.dir === "row";
        return (
          <div
            key={d.path.join("") || "root"}
            className="absolute z-10"
            style={
              isRow
                ? {
                    left: `calc(${pct(u.x)} - ${DIVIDER_THICKNESS / 2}px)`,
                    top: pct(u.y),
                    width: DIVIDER_THICKNESS,
                    height: pct(u.height),
                  }
                : {
                    left: pct(u.x),
                    top: `calc(${pct(u.y)} - ${DIVIDER_THICKNESS / 2}px)`,
                    width: pct(u.width),
                    height: DIVIDER_THICKNESS,
                  }
            }
          >
            <SplitDivider
              dir={d.dir}
              ratio={ratioAt(root, d.path)}
              containerSize={d.size}
              onRatioPreview={(ratio) => setPreview({ path: d.path, ratio })}
              onRatioCommit={(ratio) => {
                setRatio(d.path, ratio);
                setPreview(null);
              }}
              onReset={() => setRatio(d.path, 0.5)}
            />
          </div>
        );
      })}
    </div>
  );
}
