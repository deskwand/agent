import { useCallback, useRef } from "react";
import { ResizeHandle } from "../ResizeHandle";
import { MAX_RATIO, MIN_RATIO, type SplitDir } from "../../store/split-tree";

export interface SplitDividerProps {
  dir: SplitDir;
  /** 当前（已提交的）比例，拖拽起点。 */
  ratio: number;
  onRatioPreview(ratio: number): void;
  onRatioCommit(ratio: number): void;
  onReset(): void;
  /** 分割节点沿分割方向的总长度（px），用来把像素位移换算成比例。 */
  containerSize: number;
}

/** 区域间拖拽柄：拖拽中只上报预览比例，松手才提交。 */
export function SplitDivider({
  dir,
  ratio,
  onRatioPreview,
  onRatioCommit,
  onReset,
  containerSize,
}: SplitDividerProps) {
  const currentRef = useRef(ratio);

  const handleResize = useCallback(
    (delta: number) => {
      if (containerSize <= 0) return;
      currentRef.current = Math.min(
        MAX_RATIO,
        Math.max(MIN_RATIO, currentRef.current + delta / containerSize),
      );
      onRatioPreview(currentRef.current);
    },
    [containerSize, onRatioPreview],
  );

  const handleDragging = useCallback(
    (dragging: boolean) => {
      if (dragging) currentRef.current = ratio;
      else onRatioCommit(currentRef.current);
    },
    [ratio, onRatioCommit],
  );

  return (
    <ResizeHandle
      axis={dir === "row" ? "x" : "y"}
      className={dir === "row" ? "h-full" : "w-full"}
      onResize={handleResize}
      onDoubleClick={onReset}
      onDraggingChange={handleDragging}
    />
  );
}
