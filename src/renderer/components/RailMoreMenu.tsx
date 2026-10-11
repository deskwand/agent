import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Ellipsis, Pin } from "lucide-react";
import { useAppStore } from "../store";
import {
  RAIL_MORE_ITEMS,
  isRailMoreCurrent,
  resolveRailActiveKey,
} from "../utils/nav-rail";
import { RAIL_ICONS } from "./rail-icons";
import { RAIL_BUTTON_CLASS } from "./rail-styles";
import { Button } from "./ui/button";

/**
 * 图标栏的「更多」：长尾视图的入口 + 逐项固定。
 *
 * **它是一张悬停卡片，不是点开的菜单**（2026-10-11 用户决定，与灵感那张同一族）：
 * 指针停在图标上、或键盘焦点落进这一格，卡片就出现；**点那颗图标什么也不做**
 * —— 所以这里没有 `onClick`，也不再有 Radix 的 `DropdownMenu`。
 *
 * 三处与灵感卡片逐字同源，改这里时别只改一处（`AppRail.tsx` 的 `renderNavItem`
 * 里那张是另一处）：
 *
 * ① `onMouseDown` 挡掉默认行为：卡片按 `group-focus-within` 展开，而 `:focus-within`
 *    不区分焦点怎么来的 ⇒ 鼠标点一下会把焦点留在按钮上、卡片被钉住不走（移开鼠标也不收）。
 *    挡掉默认焦点即可，键盘那条路（Tab 进来）一点没动。
 * ② `pl-1`（4px）是那条**隐形的桥**：卡片盒子紧贴按钮右边，可见气泡由 padding 推开。
 *    写成 `ml-1` 会留出一条谁都不命中的死缝，鼠标一进那条缝 `group-hover` 就断，卡片
 *    立刻 `invisible` 且再也进不去。
 * ③ **顶边与「更多」那颗图标齐平**（`top-0`）。这是与灵感那张卡片**有意不同**的一处：
 *    灵感是纵向居中（与 rail 那批 tooltip 对齐），而「更多」是弹出面板，用户
 *    2026-10-11 对着参考图确认「弹出菜单顶部要和 … 对齐」。别把 `top-0` 改回
 *    `top-1/2 -translate-y-1/2`。中间的 `pl-1`（4px）仍然不能写成 `ml-1`。
 *
 * 代价：没有 Radix 菜单白送的方向键直航与 Esc（与灵感同族，走 Tab 逐格）。
 * 面板里每行是**两颗并列的按钮**（行本体 + 图钉），不是嵌套按钮 —— 行本体切视图、
 * 图钉切固定状态；**两者点过都会收起卡片**（同灵感卡片里那颗「记一笔」）。
 */
export function RailMoreMenu({
  pinnedKeys,
  onTogglePin,
}: {
  pinnedKeys: string[];
  onTogglePin: (key: string) => void;
}) {
  const { t } = useTranslation();
  const activeView = useAppStore((s) => s.activeView);
  const setActiveView = useAppStore((s) => s.setActiveView);
  const activeKey = resolveRailActiveKey(activeView);
  const moreCurrent = isRailMoreCurrent(activeKey, pinnedKeys);
  // 「点过行就收起」的开关：指针还停在图标上也收（同灵感那张）。
  // 复位挂在**重新进入**这一格（或焦点回到这一格）上，**不能**挂在离开上 —— 见下面 ① 的说明。
  const [dismissed, setDismissed] = useState(false);

  return (
    <div
      className="group relative"
      /* ① 复位必须挂 `onMouseEnter`，**不能**挂 `onMouseLeave`（2026-10-11 真实浏览器实测）：
         点面板里的按钮会把面板自己变成 `invisible` ⇒ 它立刻不再参与命中测试 ⇒ 指针脚下那一下
         被判定成「离开这一格」⇒ 离开事件里的复位会把刚设的「已收起」当场抹掉，面板又弹回来
         （面板覆盖在内容区上时，重新命中判定还会让它维持可见 ⇒ 用户看到「点了按钮菜单还在」）。
         复现页 `design-docs/mockups/_repro-rail-more-panel-dismiss.html`（可切 leave / enter 两种
         复位策略对比：leave 策略下日志是 `click → is-dismissed=true` 紧跟着
         `mouseleave → 复位`；enter 策略下 `is-dismissed=true` 保持住，面板真的消失）。
         灵感那张卡片点图标时不会踩到（指针还在图标自己的盒子里），但它卡片里的「记一笔」
         走的是同一条路 ⇒ 两处都按 enter 复位。 */
      onMouseEnter={() => setDismissed(false)}
      onFocus={() => setDismissed(false)}
    >
      <Button
        variant="ghost"
        type="button"
        aria-label={t("navRail.more")}
        /* 测试钩子：栏上每一项都带 data-rail-key，用来断言「谁在栏上、什么顺序」
           （比数按钮个数稳 —— nav 里还有灵感卡片那颗「记一笔」按钮）。 */
        data-rail-key="more"
        onMouseDown={(event) => event.preventDefault()}
        className={`${RAIL_BUTTON_CLASS} relative ${
          moreCurrent
            ? "bg-accent text-primary-text"
            : "text-muted-foreground hover:bg-accent hover:text-foreground"
        }`}
      >
        <Ellipsis className="w-4 h-4" />
      </Button>

      <div
        data-testid="rail-more-card"
        className={`invisible absolute left-full top-0 z-[60] pl-1 w-[184px] opacity-0 transition-opacity duration-150 ${
          // 顶边与那颗图标齐平（见文件头 ③）；展开类在「点过」之后整条摘掉：
          // `group-hover` 还在（指针没走），但没规则去读它。
          dismissed
            ? ""
            : "group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
        }`}
      >
        {/* 皮肤与灵感那张卡片、以及 rail 那批 tooltip 同一身
            （`bg-secondary` / `rounded-md` / `shadow-elevated`）。 */}
        <div className="rounded-md bg-secondary p-2 text-secondary-foreground shadow-elevated">
          {/* 没有标题行：「更多」两个字是多余的（图标本身就说明一切，用户 2026-10-11 要求去掉）。
              可访问名仍由那颗图标按钮的 aria-label 给。 */}
          {RAIL_MORE_ITEMS.map((item) => {
            const Icon = RAIL_ICONS[item.key];
            const pinned = pinnedKeys.includes(item.key);
            const isActive = activeKey === item.key;
            const label = t(item.labelKey);
            return (
              <div key={item.key} className="flex items-center gap-0.5">
                <button
                  type="button"
                  aria-current={isActive ? "page" : undefined}
                  // 别让这次点击把焦点留在按钮上：点完面板会变成 invisible，
                  // 而被隐藏的可聚焦元素留不住焦点 ⇒ 焦点掉回 body，之后 Tab 从文档头开始
                  //（评审 2026-10-11 指出；仓库同类按钮同款守卫：AttachMenu.tsx:589、SlashMenu.tsx:229）。
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={(event) => {
                    // 指针点击（detail > 0）⇒ 收起卡片；键盘激活（detail === 0）不摘，
                    // 免得 Shift+Tab 回来时卡片没了。同灵感那张。
                    if (event.detail > 0) setDismissed(true);
                    setActiveView(item.view);
                  }}
                  className={`flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-xs ${
                    isActive
                      ? "bg-background text-primary-text"
                      : "hover:bg-background"
                  }`}
                >
                  {Icon ? (
                    <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" />
                  ) : null}
                  <span className="truncate">{label}</span>
                </button>

                {/* 图钉常显（不藏在 hover 里）：卡片本身就是「悬停才出现」的一层，
                    再藏一层就是双重隐藏。 */}
                <button
                  type="button"
                  aria-label={
                    pinned
                      ? t("navRail.unpinItem", { name: label })
                      : t("navRail.pinItem", { name: label })
                  }
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={(event) => {
                    // 面板里的**任何**按钮点过都要收起卡片（用户 2026-10-11：
                    // 「点击菜单里面的按钮这个菜单要消失才对」）—— 只在指针点击时收起，
                    // 键盘激活（detail === 0）不摘，免得 Shift+Tab 回来卡片没了。
                    if (event.detail > 0) setDismissed(true);
                    onTogglePin(item.key);
                  }}
                  className={`grid h-7 w-7 shrink-0 place-items-center rounded-md ${
                    pinned
                      ? "bg-background text-primary-text"
                      : "text-secondary-foreground/60 hover:bg-background hover:text-secondary-foreground"
                  }`}
                >
                  <Pin className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
