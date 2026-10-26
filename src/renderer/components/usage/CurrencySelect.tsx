import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { USAGE_CURRENCIES, type CurrencyCode } from "../../../shared/usage";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Button } from "../app-button";

interface Props {
  value: CurrencyCode;
  onChange: (currency: CurrencyCode) => void;
}

/**
 * 用量页货币菜单。
 *
 * 样式不是新造的：触发器照抄输入框模型菜单（MergedInputChip）的形态 —— 只去掉
 * chat 芯片专用的宽度伸缩逻辑；面板与行由 `ui/dropdown-menu` 提供（计划 11 的
 * Task 2 把它从手写浮层迁到 Radix，与 `SettingsSelect` 同一套）。
 *
 * 为什么不用原生 select：它的展开菜单由操作系统绘制，跟随**系统**外观而不是 app
 * 主题 —— 浅色主题 + 深色系统会弹出系统深色菜单（选中行是系统高亮色），CSS 够不着。
 *
 * ⚠️ 老实现自己挂 `document` 的 mousedown/keydown 来关面板，**已整块删除**：
 * 迁到 Radix 后「点外部关」「Esc 关」由 `DropdownMenuContent` 的 DismissableLayer
 * 负责，留着旧监听就会「刚打开就被那次 click 关掉」。
 * ⚠️ 面板经 portal 挂到 `document.body`（设置卡那类 `overflow-hidden` 容器裁不到它），
 * 定位交给 popper，所以不再需要那个只为 `absolute` 面板存在的 relative 包裹层。
 */
export function CurrencySelect({ value, onChange }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost"
          type="button"
          aria-label={`${t("usage.currency")}, ${value}`}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-2xl border border-border/40 bg-background/60 px-2 text-xs whitespace-nowrap text-foreground transition-[background-color] duration-150 hover:bg-hover-surface"
        >
          <span className="text-muted-foreground">{t("usage.currency")}</span>
          <span className="font-mono">{value}</span>
          <ChevronDown
            className={`h-3 w-3 shrink-0 text-muted-foreground transition-transform ${
              open ? "rotate-180" : ""
            }`}
          />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        // 原面板是 `absolute right-0 w-28`（贴着触发器的右边），align="end" 保持这一点；
        // min-w 用 Radix 公布的触发器宽度变量，保住「面板至少与触发器同宽」的不变量
        //（原实现就是固定 w-28，触发器更宽时面板反而变窄、文案被截）。
        align="end"
        // ⚠️ loop 必须显式给：Radix 的菜单**默认不回绕**（loop = false）。
        // 老实现没有方向键导航，所以这里不是「恢复丢失的契约」而是新增 ——
        // 但既然迁到 Radix 的菜单模型，就让键盘行为与其它菜单一致（与 SettingsSelect 同）。
        loop
        aria-label={t("usage.currency")}
        className="w-28 min-w-[var(--radix-dropdown-menu-trigger-width)]"
      >
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => {
            // 选中当前项时不回传：setCurrency 会清掉汇率，而 currency 没变
            // 就不会重新取汇率 —— 会留下「选择器写着 CNY、金额却是美元」的死状态
            // （原生 select 重选同项不触发 change，所以这是换成自绘菜单才有的路径）
            if (next !== value) onChange(next as CurrencyCode);
          }}
        >
          {USAGE_CURRENCIES.map((code) => (
            <DropdownMenuRadioItem
              key={code}
              value={code}
              // 行高与老菜单一致（h-7）；pl-8 是 RadioItem 留给选中指示器的槽位，
              // 指示器由 vendored 的 DropdownMenuRadioItem 渲染（老实现是行尾的 Check）。
              className="h-7 gap-2 pr-2 font-mono"
            >
              <span className="truncate">{code}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
