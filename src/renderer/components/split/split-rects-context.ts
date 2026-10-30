import { create } from "zustand";
import type { PaneId, Rect } from "../../store/split-tree";

interface SplitRectsState {
  rects: Map<PaneId, Rect>;
  /** 消息区容器本身的 rect（x/y 恒为 0）。 */
  bounds: Rect;
  set(rects: Map<PaneId, Rect>, bounds: Rect): void;
  clear(): void;
}

const EMPTY_BOUNDS: Rect = { x: 0, y: 0, width: 0, height: 0 };

/**
 * SplitLayout 同步写入的 rect 快照，是区域 rect 的唯一来源：
 * PaneHeader / PaneDropZones / 侧栏菜单判断能否分割，快捷键找相邻区域。
 */
export const useSplitRectsStore = create<SplitRectsState>()((set) => ({
  rects: new Map(),
  bounds: EMPTY_BOUNDS,
  set: (rects, bounds) => set({ rects, bounds }),
  clear: () => set({ rects: new Map(), bounds: EMPTY_BOUNDS }),
}));
