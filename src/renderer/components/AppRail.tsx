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
import { Tooltip, TooltipContent, TooltipTrigger } from "./app-tooltip";
import { HelpMenu } from "./HelpMenu";
import { RAIL_BUTTON_CLASS } from "./rail-styles";
import { AccountCluster } from "./AccountCluster";
import { Button } from "./ui/button";

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
      className="w-14 flex-shrink-0 bg-app-chrome flex flex-col items-center gap-1 py-2"
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
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost"
                  type="button"
                  onClick={() => handleItemClick(item.view)}
                  aria-label={label}
                  aria-current={isActive ? "page" : undefined}
                  className={`${RAIL_BUTTON_CLASS} relative ${
                    isActive
                      ? "bg-accent text-primary-text"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  }`}
                >
                  {Icon ? <Icon className="w-4 h-4" /> : null}
                  {unread > 0 ? (
                    <span
                      data-testid="feed-badge"
                      aria-hidden
                      className="absolute -right-0.5 -top-0.5 min-w-[15px] rounded-full bg-primary px-1 text-center text-[9px] font-bold leading-[15px] text-primary-foreground"
                      style={{
                        boxShadow: "0 0 0 2px var(--app-chrome)",
                      }}
                    >
                      {unread > 99 ? "99+" : unread}
                    </span>
                  ) : null}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">{t(item.labelKey)}</TooltipContent>
            </Tooltip>
            {item.key === "chat" ? (
              /* 刻意不用麦克风：输入框那个 Mic 是听写，两个语音类按钮
                 必须一眼分得开。声波条在栏内的线性图标里也不突兀。 */
              <Tooltip>
                <TooltipTrigger asChild>
                  {/* ⚠️ 锦点必须是这层 **span**，不能是按钮本身 ✗（2026-10-09 实测 ✓）：
                      浏览器不给 `disabled` 的表单控件派发鼠标/指针事件 ⇒ 监听器落在按钮上时，
                      禁用态（`voiceCreating` 或 `onCreateVoiceSession` 未接入）的提示**永不出现** ——
                      而那正是最需要它的时刻。迁移前的 `Tooltip.tsx` 把监听器挂在外层 `.tt-anchor`
                      span 上，所以那时是能弹的 ⇒ **这层 span 就是那条行为的载体**。
                      必须是有**盒子**的元素（`display: contents` 没有盒子 ⇒ 同样收不到事件 ✗）；
                      `inline-flex` 让它恰好包住 w-8 h-8 的按钮，栏内几何与间距不变 ✓。
                      同类待办（同一根因，各自迁移批次里带进来的）：
                      `ChatInputBottomBar.tsx:172` · `BrowserPanel.tsx:207` ·
                      `SettingsSkills.tsx:1174` · `SkillCard.tsx:41,253,278`。

                      ⚠️ 已记账的代价（审查员 2026-10-10 指出，**有意接受** ✓）：这层 span 成了
                      Radix 的 trigger 元素 ⇒ `aria-describedby` 写在 **span** 上，而真正可聚焦、
                      带 `aria-label` 的是它内部的 Button ⇒ 语音按钮**启用**时读屏不会括报气泡文案。
                      导航项没这个问题（`asChild` 直接落在 Button 上）。
                      要根治得让 Button 自己当触发器（`aria-disabled` + onClick 守卫替代 `disabled` ✗
                      —— 但那是改写 `disabled` 语义、还得到处改 `disabled:` 变体，不属本轮 ✗）。
                      ⇒ 与上面四处同根因的位置一起，在下一轮那层抽象里收口。 */}
                  <span className="inline-flex">
                    <Button variant="ghost"
                      type="button"
                      aria-label={t("navRail.newVoiceSession")}
                      disabled={voiceCreating || !onCreateVoiceSession}
                      onClick={onCreateVoiceSession}
                      className={`${RAIL_BUTTON_CLASS} text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50`}
                    >
                      <AudioLines className="w-4 h-4" />
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="right">
                  {t("navRail.newVoiceSession")}
                </TooltipContent>
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
