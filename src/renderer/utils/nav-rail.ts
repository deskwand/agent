import type { ActiveView } from "../store";

/** 该项出现在栏上（常驻）还是「更多」菜单里。 */
export type RailPlacement = "rail" | "more";

/** 图标栏上半区的一项；数组顺序即自上而下的渲染顺序。 */
export interface RailItem {
  key: string;
  view: ActiveView;
  labelKey: string;
  placement: RailPlacement;
}

/**
 * `settings` 不在其中：它不在图标栏上，而是从头像弹层进入（HelpMenu 占栏底第一格）。
 * 所以 resolveRailActiveKey("settings") 返回 null，图标栏没有对应的高亮项。
 *
 * `feedback` 同样不在其中（2026-10-22 用户决定）：它只从栏底「?」帮助菜单进入，
 * 不再占用「更多」卡片的一行、也不可固定。用户原话是「rail 那边多了一个反馈问题的入口」
 * —— 三个入口（更多卡片 / 帮助菜单 / 设置-关于）只留后两个。
 */
export const RAIL_ITEMS: readonly RailItem[] = [
  { key: "chat", view: "chat", labelKey: "navRail.chat", placement: "rail" },
  { key: "ideas", view: "ideas", labelKey: "navRail.ideas", placement: "rail" },
  { key: "feed", view: "feed", labelKey: "navRail.feed", placement: "rail" },
  {
    key: "automation",
    view: "automation",
    labelKey: "sidebar.automation",
    placement: "more",
  },
  { key: "apps", view: "apps", labelKey: "sidebar.apps", placement: "more" },
  {
    key: "vault",
    view: "vault",
    labelKey: "sidebar.vault",
    placement: "more",
  },
  {
    key: "usage",
    view: "usage",
    labelKey: "accountMenu.usage",
    placement: "more",
  },
];

/** 当前视图对应的图标栏项 key；settings 与 feedback 不在栏上，返回 null。 */
export function resolveRailActiveKey(activeView: ActiveView): string | null {
  return RAIL_ITEMS.find((item) => item.view === activeView)?.key ?? null;
}

/** 侧栏（会话列表）只在聊天视图出现。 */
export function isSidebarAllowed(activeView: ActiveView): boolean {
  return activeView === "chat";
}

/** 栏上常驻的那几格；顺序即渲染顺序。 */
export const RAIL_PRIMARY_ITEMS: readonly RailItem[] = RAIL_ITEMS.filter(
  (item) => item.placement === "rail",
);

/** 「更多」菜单里的长尾项；顺序即菜单行顺序。 */
export const RAIL_MORE_ITEMS: readonly RailItem[] = RAIL_ITEMS.filter(
  (item) => item.placement === "more",
);

/**
 * 「更多」按钮是否代表「当前所在」。
 *
 * 判据：当前视图落在长尾组里，**且**它没被固定回栏上 —— 一旦固定，它就有了
 * 自己的栏位，高亮归那一格，两处同时亮会让人不知道自己在哪（设计决定 D5）。
 */
export function isRailMoreCurrent(
  activeKey: string | null,
  pinnedKeys: readonly string[],
): boolean {
  if (activeKey === null) return false;
  if (!RAIL_MORE_ITEMS.some((item) => item.key === activeKey)) return false;
  return !pinnedKeys.includes(activeKey);
}
