import { useState, useEffect, useCallback, useRef } from "react";

interface ResizeHandleProps {
  onResize: (deltaX: number) => void;
  /** Reset to default on double-click */
  onDoubleClick?: () => void;
  position?: "left" | "right";
  className?: string;
  /**
   * 拖动开始/结束通知。面板在拖动期间必须关掉宽度过渡：
   * 过渡会把每一帧的宽度变化再延迟 300ms，让面板永远追不上光标（1:1 跟手的前提）。
   *
   * 由下面那个**只依赖 isDragging** 的 effect 上报。两件事不能动：
   *   - 不要把其它东西（尤其是父组件传进来的内联回调）放进它的依赖数组。拖动会持续
   *     触发父组件重渲染（宽度存在 store 里），内联回调每帧换身份，依赖里带上它就会
   *     每帧拆建 effect —— 那样 cleanup 会在第一次 mousemove 就把标志位清掉，
   *     修复直接失效。回调一律经 ref 读取。
   *   - 不要删掉 cleanup 里的 false。拖到一半 handle 被卸载是可达的：Titlebar 的
   *     折叠按钮（store toggleSidebar）与右侧面板的 Esc 关闭都会让它卸载，
   *     不补发 false 就会把标志位卡住，反而弄丢折叠/展开的动画。
   */
  onDraggingChange?: (dragging: boolean) => void;
}

export function ResizeHandle({
  onResize,
  onDoubleClick,
  className,
  onDraggingChange,
}: ResizeHandleProps) {
  const [isDragging, setIsDragging] = useState(false);
  const startXRef = useRef(0);
  const onDraggingChangeRef = useRef(onDraggingChange);

  useEffect(() => {
    onDraggingChangeRef.current = onDraggingChange;
  });

  useEffect(() => {
    if (!isDragging) return;
    onDraggingChangeRef.current?.(true);
    return () => onDraggingChangeRef.current?.(false);
  }, [isDragging]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    startXRef.current = e.clientX;
    setIsDragging(true);
  }, []);

  const handleMouseUp = useCallback(() => {
    if (isDragging) {
      setIsDragging(false);
    }
  }, [isDragging]);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging) return;
      onResize(e.clientX - startXRef.current);
      startXRef.current = e.clientX;
    },
    [isDragging, onResize],
  );

  useEffect(() => {
    if (!isDragging) return;

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    // Prevent text selection while dragging
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isDragging, handleMouseMove, handleMouseUp]);

  return (
    <div
      className={`relative w-1 shrink-0 cursor-col-resize group ${className || ""}`.trim()}
      onMouseDown={handleMouseDown}
      onDoubleClick={onDoubleClick}
    >
      {/* Expanded hit area */}
      <div className="absolute inset-y-0 -left-[2px] -right-[2px]" />
      {/* Visual indicator on hover/drag */}
      <div
        className={`absolute inset-y-0 left-0 w-px transition-colors ${
          isDragging ? "bg-accent" : "bg-transparent group-hover:bg-accent/30"
        }`}
      />
    </div>
  );
}
