import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useSplitLayoutStore } from "../../store/split-layout";
import { layoutRects, listLeaves } from "../../store/split-tree";

const SIZE = 14;
/** 格与格之间留 2px 缝：每格四边各内缩一半。 */
const INSET = 1;

/**
 * 侧栏用的迷你布局图：按当前分屏切格，本会话所在那格不透明，其余格淡显。
 * 聚焦区域用主色，其余已打开的区域用前景色；单栏或会话不在任何区域时不渲染。
 */
export function PaneLocator({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation();
  const root = useSplitLayoutStore((s) => s.root);
  const focusedPaneId = useSplitLayoutStore((s) => s.focusedPaneId);

  const layout = useMemo(() => {
    const leaves = listLeaves(root);
    if (leaves.length < 2) return null;
    const index = leaves.findIndex((l) => l.sessionId === sessionId);
    if (index < 0) return null;
    const rects = layoutRects(root, { x: 0, y: 0, width: SIZE, height: SIZE });
    return { leaves, index, rects };
  }, [root, sessionId]);

  if (!layout) return null;
  const { leaves, index, rects } = layout;
  const focused = leaves[index].paneId === focusedPaneId;

  return (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className={`h-3.5 w-3.5 shrink-0 ${focused ? "text-primary" : "text-foreground/70"}`}
      data-state={focused ? "focused" : "open"}
      role="img"
      aria-label={t("split.openInPane", {
        index: index + 1,
        count: leaves.length,
      })}
    >
      {leaves.map((leaf, i) => {
        const r = rects.get(leaf.paneId);
        if (!r) return null;
        const current = i === index;
        return (
          <rect
            key={leaf.paneId}
            data-current={current ? "" : undefined}
            x={r.x + INSET}
            y={r.y + INSET}
            width={Math.max(0, r.width - INSET * 2)}
            height={Math.max(0, r.height - INSET * 2)}
            rx={1.5}
            fill="currentColor"
            // 小尺寸下细描边会糊成一团：空格用低透明度实心块。
            fillOpacity={current ? 1 : 0.22}
          />
        );
      })}
    </svg>
  );
}
