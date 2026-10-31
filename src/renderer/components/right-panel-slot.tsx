/**
 * @module renderer/components/right-panel-slot
 *
 * 右栏一块面板的内层外壳。只管两件事：什么时候挂载、激活时淡入。
 * 宽度与滑入滑出仍由 App 那一层的 `panelWidthTransitionClass` 负责 ——
 * 预览 / 审查 / 概览 / 文件共用这里，四段包装因此只有一处实现。
 */
import { useState } from "react";
import type { ReactElement, ReactNode } from "react";

export interface RightPanelSlotProps {
  /** 这块面板此刻是否应当显示（调用方按 mode + rightPanelVisible 算好）。 */
  active: boolean;
  children: ReactNode;
}

export function RightPanelSlot({
  active,
  children,
}: RightPanelSlotProps): ReactElement | null {
  // 首次激活那一帧就挂载。放 effect 里会让滑出的第一帧是个空槽 ——
  // 旧实现正是在 effect 里补 visitedPanels，四块面板首开都要先滑一个空槽。
  const [mounted, setMounted] = useState(active);
  if (active && !mounted) setMounted(true);

  // 关掉后只切 display:none，不卸载：文件树展开 / review 选中文件 / 预览 tab
  // 都靠这层保活；`hidden` 同时还是 position:fixed 全屏层不外溢的兜底。
  if (!mounted) return null;

  return (
    <div className={active ? "flex flex-1 min-w-0 animate-panel-in" : "hidden"}>
      {children}
    </div>
  );
}
