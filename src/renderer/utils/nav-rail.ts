import type { ActiveView } from "../store";

/** 图标栏上半区的一项；数组顺序即自上而下的渲染顺序。 */
export interface RailItem {
  key: string;
  view: ActiveView;
  labelKey: string;
}

/**
 * `settings` 不在其中：它渲染在图标栏底部那一格（与账号头像同组），
 * 所以 resolveRailActiveKey("settings") 返回 null，由底部自行判断激活态。
 */
export const RAIL_ITEMS: readonly RailItem[] = [
  { key: "chat", view: "chat", labelKey: "navRail.chat" },
  { key: "automation", view: "automation", labelKey: "sidebar.automation" },
  { key: "apps", view: "apps", labelKey: "sidebar.apps" },
  { key: "vault", view: "vault", labelKey: "sidebar.vault" },
  { key: "usage", view: "usage", labelKey: "accountMenu.usage" },
];

export type RailClickAction = "navigate" | "toggle-sidebar";

/** 当前视图对应的图标栏项 key；底部那格（settings）返回 null。 */
export function resolveRailActiveKey(activeView: ActiveView): string | null {
  return RAIL_ITEMS.find((item) => item.view === activeView)?.key ?? null;
}

/**
 * 点图标栏某一项的语义：只有「聊天」项承担侧栏开合，且仅在已经处于聊天视图时；
 * 其余项一律只切视图，点中当前项是 no-op。
 */
export function resolveRailClick(
  view: ActiveView,
  activeView: ActiveView,
): RailClickAction {
  if (view !== "chat") return "navigate";
  return activeView === "chat" ? "toggle-sidebar" : "navigate";
}

/** 侧栏（会话列表）只在聊天视图出现。 */
export function isSidebarAllowed(activeView: ActiveView): boolean {
  return activeView === "chat";
}
