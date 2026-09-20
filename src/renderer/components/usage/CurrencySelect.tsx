import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { USAGE_CURRENCIES, type CurrencyCode } from "../../../shared/usage";
import {
  MENU_ITEM_CLASS,
  MENU_ITEM_DEFAULT_CLASS,
  MENU_ITEM_SELECTED_CLASS,
  MENU_PANEL_PADDED_CLASS,
} from "../menu-styles";

interface Props {
  value: CurrencyCode;
  onChange: (currency: CurrencyCode) => void;
}

/**
 * 用量页货币菜单。
 *
 * 样式不是新造的：面板与菜单行走 menu-styles 的共享 token，触发按钮照抄输入框
 * 模型菜单（MergedInputChip）的形态 —— 只去掉 chat 芯片专用的宽度伸缩逻辑。
 *
 * 为什么不用原生 select：它的展开菜单由操作系统绘制，跟随**系统**外观而不是 app
 * 主题 —— 浅色主题 + 深色系统会弹出系统深色菜单（选中行是系统高亮色），CSS 够不着。
 */
export function CurrencySelect({ value, onChange }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleOutsideClick(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  return (
    <span ref={containerRef} className="relative inline-flex items-center">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${t("usage.currency")}, ${value}`}
        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-2xl border border-border-subtle bg-background/60 px-2 text-xs whitespace-nowrap text-text-primary transition-[background-color] duration-150 hover:bg-surface-hover"
      >
        <span className="text-text-muted">{t("usage.currency")}</span>
        <span className="font-mono">{value}</span>
        <ChevronDown
          className={`h-3 w-3 shrink-0 text-text-muted transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && (
        <div
          role="menu"
          aria-label={t("usage.currency")}
          className={`${MENU_PANEL_PADDED_CLASS} animate-menu-in-down absolute top-[calc(100%_+_8px)] right-0 z-30 w-28`}
        >
          {USAGE_CURRENCIES.map((code) => (
            <button
              key={code}
              type="button"
              role="option"
              aria-selected={code === value}
              onClick={() => {
                setOpen(false);
                // 选中当前项时不回传：setCurrency 会清掉汇率，而 currency 没变
                // 就不会重新取汇率 —— 会留下「选择器写着 CNY、金额却是美元」的死状态
                // （原生 select 重选同项不触发 change，所以这是换成自绘菜单才有的路径）
                if (code !== value) onChange(code);
              }}
              className={`${MENU_ITEM_CLASS} ${
                code === value
                  ? MENU_ITEM_SELECTED_CLASS
                  : MENU_ITEM_DEFAULT_CLASS
              }`}
            >
              <span className="truncate font-mono">{code}</span>
              {code === value && <Check className="h-4 w-4 shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
