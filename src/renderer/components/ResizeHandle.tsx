import { useState, useEffect, useCallback, useRef } from "react";

interface ResizeHandleProps {
  onResize: (deltaX: number) => void;
  /** Reset to default on double-click */
  onDoubleClick?: () => void;
  position?: "left" | "right";
  className?: string;
}

export function ResizeHandle({
  onResize,
  onDoubleClick,
  className,
}: ResizeHandleProps) {
  const [isDragging, setIsDragging] = useState(false);
  const startXRef = useRef(0);

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
