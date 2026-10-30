import { useEffect } from "react";
import { useSplitLayoutStore } from "../../store/split-layout";
import { canSplit, findNeighborPane } from "../../store/split-tree";
import { useSplitRectsStore } from "./split-rects-context";

const ARROWS = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
} as const;

/**
 * 分屏快捷键（监听在 window，命中时 preventDefault）：
 * Mod+D 向右分割，Mod+Shift+D 向下分割，Mod+Shift+W 关闭聚焦区域，
 * Mod+Alt+方向键 移动聚焦。Mod 在 macOS 为 ⌘，其余平台为 Ctrl。
 */
export function useSplitShortcuts(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const isMac = window.electronAPI?.platform === "darwin";

    const onKeyDown = (e: KeyboardEvent) => {
      const mod = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
      if (!mod) return;
      const layout = useSplitLayoutStore.getState();
      const { rects, bounds } = useSplitRectsStore.getState();
      const key = e.key.toLowerCase();

      if (key === "d" && !e.altKey) {
        e.preventDefault();
        const dir = e.shiftKey ? "column" : "row";
        const rect = rects.get(layout.focusedPaneId);
        if (!rect || !canSplit(layout.root, rect, dir).ok) return;
        layout.splitPane(layout.focusedPaneId, dir, "after");
        return;
      }
      if (key === "w" && e.shiftKey && !e.altKey) {
        e.preventDefault();
        layout.closePane(layout.focusedPaneId);
        return;
      }
      if (e.altKey && !e.shiftKey && e.key in ARROWS) {
        e.preventDefault();
        const direction = ARROWS[e.key as keyof typeof ARROWS];
        const target = findNeighborPane(
          layout.root,
          bounds,
          layout.focusedPaneId,
          direction,
        );
        if (target) layout.focusPane(target);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
