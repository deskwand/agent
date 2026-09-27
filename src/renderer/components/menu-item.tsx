import type { ReactNode } from "react";
import {
  MENU_ITEM_CLASS,
  MENU_ITEM_DEFAULT_CLASS,
  MENU_ITEM_DISABLED_CLASS,
} from "./menu-styles";

interface MenuItemProps {
  icon: ReactNode;
  label: string;
  trailing?: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}

/**
 * 弹层里的单行菜单项：图标 + 文案 + 可选行尾。
 * 原为 AccountMenu 的私有组件，帮助弹层需要同样的行，故提取共用。
 */
export function MenuItem({
  icon,
  label,
  trailing,
  onClick,
  disabled,
}: MenuItemProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${MENU_ITEM_CLASS} ${
        disabled ? MENU_ITEM_DISABLED_CLASS : MENU_ITEM_DEFAULT_CLASS
      }`}
    >
      <span className="shrink-0 text-text-muted">{icon}</span>
      <span className="truncate">{label}</span>
      {trailing ? (
        <span className="ml-auto flex-shrink-0 text-text-muted">
          {trailing}
        </span>
      ) : null}
    </button>
  );
}
