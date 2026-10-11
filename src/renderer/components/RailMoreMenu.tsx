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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Button } from "./ui/button";

/**
 * 图标栏的「更多」：长尾视图的入口 + 逐项固定。
 *
 * 结构上与栏底「?」/头像同一族：`DropdownMenuTrigger asChild` 直接裹 Button，外面**不**再包 Tooltip。
 * 这是设计选择、不是技术禁区 —— `attach/AttachMenu.tsx:450` 就有活着的
 * `Tooltip > TooltipTrigger asChild > DropdownMenuTrigger asChild > Button` 链。
 * 若日后要加气泡：保持那条链（中间别插不透传 props/ref 的包装组件，`AccountMenu.tsx:83`
 * 记过旧 Tooltip 这么栽过，菜单会打不开且不报错），可访问名仍由 `aria-label` 给。
 *
 * 每一行是**两颗并列的菜单项**（行本体 + 图钉），不是嵌套按钮：Radix 的 item 自带
 * `role="menuitem"`，在它里面塞 `<button>` 既不合规、也会让点击冒泡成「既固定又切视图」。
 * 代价是方向键每行多一个停靠点 —— 长尾组只有 4 项，**用户 2026-10-11 已明确接受**（D3）。
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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          type="button"
          aria-label={t("navRail.more")}
          /* 测试钩子：栏上每一项都带 data-rail-key，用来断言「谁在栏上、什么顺序」
             （比数按钮个数稳 —— nav 里还有灵感卡片那颗「记一笔」按钮）。 */
          data-rail-key="more"
          /* 「当前所在的组」只用**视觉**高亮表达（`bg-accent text-primary-text`，由
             isRailMoreCurrent 决定）。**不**在这里再写 `aria-current="page"`：当前页是
             菜单里那一行（它带着 aria-current），两个元素同时声称自己是 current page
             会让读屏把「更多/当前页」与「密库/当前页」并报（评审 2026-10-11）。 */
          className={`${RAIL_BUTTON_CLASS} relative ${
            moreCurrent
              ? "bg-accent text-primary-text"
              : "text-muted-foreground hover:bg-accent hover:text-foreground"
          }`}
        >
          <Ellipsis className="w-4 h-4" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" side="right" className="w-48">
        {RAIL_MORE_ITEMS.map((item) => {
          const Icon = RAIL_ICONS[item.key];
          const pinned = pinnedKeys.includes(item.key);
          const isActive = activeKey === item.key;
          const label = t(item.labelKey);
          return (
            /* group 让「鼠标停在行上」时右侧图钉显形；键盘走到图钉时由
               `data-[highlighted]` 兜（Radix 给当前聚焦的项打这个标记）。 */
            <div key={item.key} className="group flex items-center gap-1">
              <DropdownMenuItem
                className={`h-7 flex-1 gap-2 ${
                  isActive ? "bg-accent text-primary-text" : ""
                }`}
                aria-current={isActive ? "page" : undefined}
                onSelect={() => setActiveView(item.view)}
              >
                {Icon ? (
                  <span className="shrink-0 text-muted-foreground">
                    <Icon className="h-4 w-4" />
                  </span>
                ) : null}
                <span className="truncate">{label}</span>
              </DropdownMenuItem>

              <DropdownMenuItem
                className={`h-7 w-7 justify-center p-0 ${
                  pinned
                    ? "text-primary-text"
                    : "opacity-0 group-hover:opacity-100 data-[highlighted]:opacity-100"
                }`}
                aria-label={
                  pinned
                    ? t("navRail.unpinItem", { name: label })
                    : t("navRail.pinItem", { name: label })
                }
                /* 固定不改视图、不关菜单：preventDefault 阻止 Radix 关掉菜单，
                   于是可以连着固定几项（D3）。 */
                onSelect={(event) => {
                  event.preventDefault();
                  onTogglePin(item.key);
                }}
              >
                <Pin />
              </DropdownMenuItem>
            </div>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
