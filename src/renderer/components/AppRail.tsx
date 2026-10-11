import { Fragment, useState } from "react";
import { useTranslation } from "react-i18next";
import { AudioLines, Plus } from "lucide-react";
import type { ActiveView } from "../store";
import { useAppStore } from "../store";
import {
  RAIL_MORE_ITEMS,
  RAIL_PRIMARY_ITEMS,
  resolveRailActiveKey,
  type RailItem,
} from "../utils/nav-rail";
import { loadRailPins, toggleRailPin } from "../utils/rail-pins";
import { Tooltip, TooltipContent, TooltipTrigger } from "./app-tooltip";
import { HelpMenu } from "./HelpMenu";
import { RAIL_BUTTON_CLASS } from "./rail-styles";
import { captureShortcutLabel } from "../utils/capture-shortcut-label";
import { AccountCluster } from "./AccountCluster";
import { Button } from "./ui/button";

import { RAIL_ICONS } from "./rail-icons";
import { RailMoreMenu } from "./RailMoreMenu";

export function AppRail({
  onCreateVoiceSession,
  voiceCreating = false,
}: {
  onCreateVoiceSession?: () => void;
  voiceCreating?: boolean;
}) {
  const { t } = useTranslation();
  // 「点了就把卡片收起来」的状态：见下面灵感那一格里的说明。声明在顶层是因为
  // hooks 不能进条件分支；它只影响带卡片的那一格。
  const [ideasCardDismissed, setIdeasCardDismissed] = useState(false);
  const activeView = useAppStore((s) => s.activeView);
  const setActiveView = useAppStore((s) => s.setActiveView);
  const feedUnread = useAppStore((s) => s.feedUnread);
  const openIdeaCapture = useAppStore((s) => s.openIdeaCapture);

  const activeKey = resolveRailActiveKey(activeView);
  // 固定集合：本机存储是唯一来源；切换走 toggleRailPin（它会顺带落盘）。
  // 归一化：只留长尾组里真实存在的 key（越界/幽灵数据不进 state、也就不会被写回存储）
  const [pinnedKeys, setPinnedKeys] = useState<string[]>(() =>
    loadRailPins().filter((key) =>
      RAIL_MORE_ITEMS.some((item) => item.key === key),
    ),
  );

  const handleItemClick = (view: ActiveView) => {
    // 图标栏只切视图；侧栏开合由顶栏左簇的专用按钮负责。
    // 视图互斥由 activeView 单一字段保证；此处不额外清空 activeSessionId，
    // 否则从 Vault/设置返回聊天会丢掉当前会话。
    setActiveView(view);
  };

  // 唯一一处导航项 JSX：栏上常驻项与固定上来的项共用它 —— 于是「气泡 + 点击切视图」
  // 只有一份，未读角标与灵感卡片也各只有一份。
  const renderNavItem = (item: RailItem) => {
    const Icon = RAIL_ICONS[item.key];
    const isActive = activeKey === item.key;
    // 未读角标只属于动态；未读为 0 时**不渲染**（不是渲染成透明）
    const unread = item.key === "feed" ? feedUnread : 0;
    // 已经在动态视图里就不必再提醒：**纯视觉隐藏**，未读数据一个字不动
    //（离开后仍有未读，角标会回来）。`unread` 只对 feed 项可能非 0
    // ⇒ `!isActive` 就是「当前不在这一项的视图里」。
    const showBadge = unread > 0 && !isActive;
    const label =
      unread > 0
        ? t("feed.railLabelUnread", { count: unread })
        : t(item.labelKey);
    // 灵感这一格多一张 hover 卡片：栏里只有它带卡片，因为只有它同时是
    // "一个地方"与"一个动作"（记一笔）。栏上其余图标保持统一的「气泡 + 点击切视图」。
    if (item.key === "ideas") {
      return (
        <div
          key={item.key}
          className="group relative"
          // 指针**重新进入**这一格 ⇒ 复位（重新悬停照旧展开）；
          // 挂 `onMouseEnter` 而不是 `onMouseLeave`（2026-10-11）：点卡片里的「记一笔」会把卡片
          // 自己变成 invisible ⇒ 指针脚下那一下被判定成「离开这一格」⇒ 离开事件里的复位会把刚设的
          // 「已收起」抹掉，卡片又弹回来。复现与两种策略的对比见
          // `design-docs/mockups/_repro-rail-more-panel-dismiss.html`（RailMoreMenu 里那段同源）。
          // 键盘焦点回到这一格 ⇒ 也复位（否则"先用鼠标点过、再改用键盘"的人
          // 会再也看不到卡片，也就 Tab 不进卡片里的「记一笔」）。
          // 不做 `:focus-visible` 匹配：jsdom 上那个伪类会抛，且指针点击已被
          // mousedown 的 preventDefault 挡在焦点之外 ⇒ 这里的焦点基本就等于键盘来的。
          onMouseEnter={() => setIdeasCardDismissed(false)}
          onFocus={() => setIdeasCardDismissed(false)}
        >
          <Button
            variant="ghost"
            type="button"
            onClick={(event) => {
              // 点过就收起来 —— **指针还停在图标上也算**。只靠 hover 的话，
              // 点完卡片会一直杵着，直到鼠标移开（用户："用户都点击灵感了，
              // 这个 tooltip 是不是该立刻消失"）。
              // 只认指针点击（`detail > 0`）：回车 / 空格激活是 `detail === 0`，
              // 那种情况不摘，键盘用户 Shift+Tab 回来时卡片还在。
              if (event.detail > 0) setIdeasCardDismissed(true);
              handleItemClick(item.view);
            }}
            // 鼠标按下时别把焦点留在按钮上。
            //
            // 卡片是按 `group-focus-within` 展开的，而 `:focus-within` **不区分焦点怎么来的**：
            // 鼠标点一下图标也会给按钮焦点，于是卡片在鼠标移开之后继续赖着不走
            // （浏览器里实测：点击后焦点在按钮上、`matches(':focus-visible')` 为 false、
            // 卡片仍 `visible`；移开鼠标也不消失，只有点到别处才收）。
            // 挡掉 mousedown 的默认行为即可：click 照常触发（实测点击处理仍执行一次），
            // Tab / 回车激活不受影响 —— 键盘那条路一点没动。
            //
            // 试过并否掉的另一条路：把 `group-focus-within` 换成
            // `group-has-[:focus-visible]`（区分指针与键盘焦点）。它会让焦点往卡片里走的那一瞬
            // 先失去 focus-visible ⇒ 卡片变 `visibility: hidden` ⇒ 卡片里的按钮随即不可聚焦、
            // 焦点掉回 body —— **键盘进不了卡片**。所以补丁打在"别留焦点"这一头。
            onMouseDown={(event) => event.preventDefault()}
            data-rail-key={item.key}
            aria-label={label}
            aria-current={isActive ? "page" : undefined}
            className={`${RAIL_BUTTON_CLASS} relative ${
              isActive
                ? "bg-accent text-primary-text"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            {Icon ? <Icon className="w-4 h-4" /> : null}
          </Button>
          {/* 悬停/聚焦展开：图标放不下的入口都在这里。
                  `z-[60]` 要盖过内容区右上的产物面板（z-50），又低于灯箱（z-[100]）；
                  与 FeedListenButton 的卡片同一套做法（含 focus-within 那条键盘路径）。

                  **`pl-1`（4px）不能写成 `ml-1`**：margin 不扩元素盒子，按钮右边到卡片左边
                  会留出一条谁都不命中的死区 —— 鼠标一进那条缝，`group-hover` 就断，卡片立刻
                  `invisible`（而 `visibility: hidden` 不参与命中测试，于是再也进不去），
                  表现就是"挪一下鼠标卡片就消失、怎么都点不到记一笔"。padding 才是那条隐形的
                  桥：盒子紧贴按钮右边，可见气泡由 padding 推开。
                  实测（dist 真 CSS + 真实鼠标）：`ml-2` 时空隙 8px、那 8px 里命中的是图标栏
                  本身；`pl-*` 时空隙 0px。复现页 `design-docs/mockups/_repro-rail-card-hover.html`，
                  改动前先在浏览器里量一遍。

                  **间距 4px + 垂直居中，是和 rail 里那批 tooltip 对齐**（`ui/tooltip.tsx` 的
                  `sideOffset = 4`、Radix 默认 `align = center`，Rail 里都用 `side="right"`）：
                  卡片气泡的左缘与 tooltip 气泡的左缘落在同一条竖线上，纵向也同以图标为中心。
                  别把 `top-1/2 -translate-y-1/2` 改回 `top-0` —— 那会让卡片比旁边的 tooltip
                  低 19px，同一条栏上两种悬停反馈各站各的。对照稿见
                  `design-docs/mockups/2026-10-11-ideas-rail-card-align.html`。 */}
          <div
            data-testid="ideas-rail-card"
            className={`invisible absolute left-full top-1/2 -translate-y-1/2 z-[60] pl-1 w-[184px] opacity-0 transition-opacity duration-150 ${
              // 点过之后把展开类整条摘掉：`group-hover` 还在（指针没走），但没规则去读它。
              ideasCardDismissed
                ? ""
                : "group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
            }`}
          >
            {/* 皮肤与 rail 那批 tooltip 同一身（`app-tooltip.tsx` 的 APP_TOOLTIP_SKIN +
                    vendored 的 `rounded-md text-xs`）：bg-secondary / rounded-md / shadow-elevated。
                    浅色下气泡离页面底色只 1.10，**阴影是唯一的分隔**，别当装饰删掉
                    （tooltip 那份皮肤文档里算过同一笔账）。

                    ⚠️ 行动行的底色**不能**用 `bg-accent`（静止的底与悬停的底都不行）：在这个
                    主题体系里 `--accent` 与 `--secondary` 是同一个值 —— 2026-10-12 扫过
                    `globals.css` 全部 13 个主题块，每一块里这两者的 oklch 字面量都逐个相等、
                    而 `--background` 每块都不等于 `--secondary` ⇒ 铺 `bg-accent` 的行会彻底消失，
                    底色只能走 `bg-background`。

                    **没有标题行**，且这一行静止时透明、悬停才亮、字色不再自己指定 ——
                    三条都是与「更多」那张卡片逐条同款（用户 2026-10-12：「灵感」那两个字是多余的，
                    样式参照「更多」那张）。去掉 `text-foreground` 后字色继承卡片，实测
                    与「更多」的行取值完全相同（改前更深一档）。
                    图标本身就说明一切，可访问名仍由这一格图标按钮的 `aria-label` 给。

                    键盘那条路不缺反馈：`globals.css` 对裸 `button` 统一给了
                    `focus-visible:ring-1 ring-primary` 的环（与「更多」卡片里的行一致）
                    ⇒ 别为它补 `focus-visible:bg-background`，那反而与参考的那张卡片不一致。 */}
            <div className="rounded-md bg-secondary p-2 text-secondary-foreground shadow-elevated">
              <button
                type="button"
                data-testid="ideas-rail-capture"
                onClick={(event) => {
                  // 点过就把卡片收起来（同这一格图标那颗按钮的规则）：
                  // 只认指针点击（`detail > 0`），键盘激活不摘 —— 否则键盘用户
                  // Shift+Tab 回来时卡片已经没了。
                  if (event.detail > 0) setIdeasCardDismissed(true);
                  openIdeaCapture();
                }}
                className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-xs hover:bg-background"
              >
                <Plus className="h-3.5 w-3.5 shrink-0 opacity-70" />
                {t("capture.title")}
                <span className="ml-auto text-[11px] text-muted-foreground">
                  {captureShortcutLabel(window.electronAPI?.platform)}
                </span>
              </button>
            </div>
          </div>
        </div>
      );
    }
    return (
      <Fragment key={item.key}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              type="button"
              onClick={() => handleItemClick(item.view)}
              data-rail-key={item.key}
              aria-label={label}
              aria-current={isActive ? "page" : undefined}
              className={`${RAIL_BUTTON_CLASS} relative ${
                isActive
                  ? "bg-accent text-primary-text"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              {Icon ? <Icon className="w-4 h-4" /> : null}
              {showBadge ? (
                <span
                  data-testid="feed-badge"
                  aria-hidden
                  className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-primary/70"
                  style={{
                    boxShadow: "0 0 0 2px var(--app-chrome)",
                  }}
                />
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
                <Button
                  variant="ghost"
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
  };

  // 固定集合 → 项：**只认长尾组里的 key** —— 越界数据（`["chat"]` 这类）不许在栏上
  // 多长一颗重复按钮；顺序照 pinnedKeys（= 固定先后），查不到的 key 丢掉。
  const pinnedItems = pinnedKeys
    .map((key) => RAIL_MORE_ITEMS.find((item) => item.key === key))
    .filter((item): item is RailItem => item !== undefined);

  const handleTogglePin = (key: string) =>
    // 传 pinnedKeys（而不是让 rail-pins 重读存储）：存储写不进去时 state 才是权威
    setPinnedKeys(toggleRailPin(key, pinnedKeys));

  return (
    <nav
      aria-label={t("navRail.label")}
      className="w-14 flex-shrink-0 bg-app-chrome flex flex-col items-center gap-1 py-2"
    >
      {RAIL_PRIMARY_ITEMS.map((item) => renderNavItem(item))}

      <RailMoreMenu pinnedKeys={pinnedKeys} onTogglePin={handleTogglePin} />

      {pinnedItems.length > 0 ? (
        <>
          {/* 固定组：与「更多」之间一条细线（D4）。顺序 = 固定先后 */}
          <span
            aria-hidden
            data-testid="rail-pins-divider"
            className="my-0.5 h-px w-[22px] flex-none bg-foreground/15"
          />
          {pinnedItems.map((item) => renderNavItem(item))}
        </>
      ) : null}

      <span className="flex-1" />

      <HelpMenu />

      <AccountCluster />
    </nav>
  );
}
