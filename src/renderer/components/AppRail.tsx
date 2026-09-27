import type { ComponentType } from "react";
import { useTranslation } from "react-i18next";
import {
  Archive,
  BarChart3,
  Clock3,
  LayoutGrid,
  MessageSquare,
} from "lucide-react";
import type { ActiveView } from "../store";
import { useAppStore } from "../store";
import {
  RAIL_ITEMS,
  resolveRailActiveKey,
  resolveRailClick,
} from "../utils/nav-rail";
import { Tooltip } from "./Tooltip";
import { HelpMenu } from "./HelpMenu";
import { RAIL_BUTTON_CLASS } from "./rail-styles";
import { AccountCluster } from "./AccountCluster";

/** 图标只在这里映射：nav-rail.ts 保持纯数据，不引入 React。 */
const RAIL_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  chat: MessageSquare,
  automation: Clock3,
  apps: LayoutGrid,
  vault: Archive,
  usage: BarChart3,
};

export function AppRail() {
  const { t } = useTranslation();
  const activeView = useAppStore((s) => s.activeView);
  const setActiveView = useAppStore((s) => s.setActiveView);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);

  const activeKey = resolveRailActiveKey(activeView);

  const handleItemClick = (view: ActiveView) => {
    if (resolveRailClick(view, activeView) === "toggle-sidebar") {
      toggleSidebar();
      return;
    }
    // 视图互斥由 activeView 单一字段保证；此处不额外清空 activeSessionId，
    // 否则从 Vault/设置返回聊天会丢掉当前会话。
    setActiveView(view);
  };

  return (
    <nav
      aria-label={t("navRail.label")}
      className="w-14 flex-shrink-0 bg-background-secondary flex flex-col items-center gap-1 py-2"
    >
      {RAIL_ITEMS.map((item) => {
        const Icon = RAIL_ICONS[item.key];
        const isActive = activeKey === item.key;
        return (
          <Tooltip key={item.key} label={t(item.labelKey)}>
            <button
              type="button"
              onClick={() => handleItemClick(item.view)}
              aria-label={t(item.labelKey)}
              aria-current={isActive ? "page" : undefined}
              className={`${RAIL_BUTTON_CLASS} ${
                isActive
                  ? "bg-overlay-on text-accent"
                  : "text-text-muted hover:bg-overlay-hover hover:text-text-primary"
              }`}
            >
              {Icon ? <Icon className="w-4 h-4" /> : null}
            </button>
          </Tooltip>
        );
      })}

      <span className="flex-1" />

      <HelpMenu />

      <AccountCluster />
    </nav>
  );
}
