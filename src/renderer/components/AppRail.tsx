import { Fragment, type ComponentType } from "react";
import { useTranslation } from "react-i18next";
import {
  Archive,
  AudioLines,
  BarChart3,
  Clock3,
  LayoutGrid,
  MessageSquare,
  Newspaper,
} from "lucide-react";
import type { ActiveView } from "../store";
import { useAppStore } from "../store";
import { RAIL_ITEMS, resolveRailActiveKey } from "../utils/nav-rail";
import { Tooltip } from "./Tooltip";
import { HelpMenu } from "./HelpMenu";
import { RAIL_BUTTON_CLASS } from "./rail-styles";
import { AccountCluster } from "./AccountCluster";

/** 图标只在这里映射：nav-rail.ts 保持纯数据，不引入 React。 */
const RAIL_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  chat: MessageSquare,
  feed: Newspaper,
  automation: Clock3,
  apps: LayoutGrid,
  vault: Archive,
  usage: BarChart3,
};

export function AppRail({
  onCreateVoiceSession,
  voiceCreating = false,
}: {
  onCreateVoiceSession?: () => void;
  voiceCreating?: boolean;
}) {
  const { t } = useTranslation();
  const activeView = useAppStore((s) => s.activeView);
  const setActiveView = useAppStore((s) => s.setActiveView);
  const feedUnread = useAppStore((s) => s.feedUnread);

  const activeKey = resolveRailActiveKey(activeView);

  const handleItemClick = (view: ActiveView) => {
    // 图标栏只切视图；侧栏开合由顶栏左簇的专用按钮负责。
    // 视图互斥由 activeView 单一字段保证；此处不额外清空 activeSessionId，
    // 否则从 Vault/设置返回聊天会丢掉当前会话。
    setActiveView(view);
  };

  return (
    <nav
      aria-label={t("navRail.label")}
      className="w-14 flex-shrink-0 bg-background-chrome flex flex-col items-center gap-1 py-2"
    >
      {RAIL_ITEMS.map((item) => {
        const Icon = RAIL_ICONS[item.key];
        const isActive = activeKey === item.key;
        // 未读角标只属于动态；未读为 0 时**不渲染**（不是渲染成透明）
        const unread = item.key === "feed" ? feedUnread : 0;
        const label =
          unread > 0
            ? t("feed.railLabelUnread", { count: unread })
            : t(item.labelKey);
        return (
          <Fragment key={item.key}>
            <Tooltip label={t(item.labelKey)} placement="right">
              <button
                type="button"
                onClick={() => handleItemClick(item.view)}
                aria-label={label}
                aria-current={isActive ? "page" : undefined}
                className={`${RAIL_BUTTON_CLASS} relative ${
                  isActive
                    ? "bg-overlay-on text-accent"
                    : "text-text-muted hover:bg-overlay-hover hover:text-text-primary"
                }`}
              >
                {Icon ? <Icon className="w-4 h-4" /> : null}
                {unread > 0 ? (
                  <span
                    data-testid="feed-badge"
                    aria-hidden
                    className="absolute -right-0.5 -top-0.5 min-w-[15px] rounded-full bg-accent px-1 text-center text-[9px] font-bold leading-[15px] text-accent-foreground"
                    style={{
                      boxShadow: "0 0 0 2px var(--color-background-chrome)",
                    }}
                  >
                    {unread > 99 ? "99+" : unread}
                  </span>
                ) : null}
              </button>
            </Tooltip>
            {item.key === "chat" ? (
              <Tooltip label={t("navRail.newVoiceSession")} placement="right">
                {/* 刻意不用麦克风：输入框那个 Mic 是听写，两个语音类按钮
                    必须一眼分得开。声波条在栏内的线性图标里也不突兀。 */}
                <button
                  type="button"
                  aria-label={t("navRail.newVoiceSession")}
                  disabled={voiceCreating || !onCreateVoiceSession}
                  onClick={onCreateVoiceSession}
                  className={`${RAIL_BUTTON_CLASS} text-text-muted hover:bg-overlay-hover hover:text-text-primary disabled:opacity-50`}
                >
                  <AudioLines className="w-4 h-4" />
                </button>
              </Tooltip>
            ) : null}
          </Fragment>
        );
      })}

      <span className="flex-1" />

      <HelpMenu />

      <AccountCluster />
    </nav>
  );
}
