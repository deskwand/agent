import type { ComponentType } from "react";
import {
  Archive,
  BarChart3,
  Clock3,
  LayoutGrid,
  MessageSquare,
  Newspaper,
  NotebookPen,
} from "lucide-react";

/**
 * 图标只在这里映射：`utils/nav-rail.ts` 保持纯数据，不引入 React。
 *
 * 单独一个模块是为了让 `AppRail` 与 `RailMoreMenu` 共用同一份映射，又不互相
 * import 成环（同 `rail-styles.ts` 的约定）。
 */
export const RAIL_ICONS: Record<
  string,
  ComponentType<{ className?: string }>
> = {
  chat: MessageSquare,
  ideas: NotebookPen,
  feed: Newspaper,
  automation: Clock3,
  apps: LayoutGrid,
  vault: Archive,
  usage: BarChart3,
};
