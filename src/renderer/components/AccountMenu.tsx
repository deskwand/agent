import { useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { formatMicroUsd } from "../utils/topup";
import {
  LogIn,
  User,
  Settings,
  LogOut,
  Zap,
  Coins,
  CircleDot,
} from "lucide-react";
import type { CloudConfig } from "../types";
import { useAppStore } from "../store";
import { Tooltip, TooltipContent, TooltipTrigger } from "./app-tooltip";
import { CloudApiClient } from "../services/cloud-api";
import { avatarInitials } from "../utils/identity";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Switch } from "./ui/switch";

interface AccountMenuProps {
  /**
   * 定位锚点。必须由调用方提供 —— Radix 的 Trigger 就是锚点，
   * 它没有「相对某个父容器定位」这个概念（原实现是 absolute 定位到父元素）。
   */
  trigger: ReactNode;
  /** 受控开关。调用方仍需能程序化关闭（见 AccountCluster 的 onOpenSettings）。 */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cloudConfig: CloudConfig | null;
  cloudRestoring?: boolean;
  onOpenLogin: () => void;
  onOpenSettings: () => void;
  onLogout: () => void;
}

export function AccountMenu({
  trigger,
  open,
  onOpenChange,
  cloudConfig,
  cloudRestoring,
  onOpenLogin,
  onOpenSettings,
  onLogout,
}: AccountMenuProps) {
  const { t } = useTranslation();
  const petEnabled = useAppStore((s) => s.settings.petEnabled);
  const updateSettings = useAppStore((s) => s.updateSettings);

  useEffect(() => {
    if (!open || cloudRestoring || !cloudConfig?.token) return;
    const cloudApi = new CloudApiClient(cloudConfig.token);
    cloudApi
      .getMe()
      .then((me) => {
        const snapshot = useAppStore.getState().cloudConfig;
        // 账户可能已切换/登出：token 不符则丢弃过期响应
        if (!snapshot || snapshot.token !== cloudConfig.token) return;
        if (snapshot.balanceMicroUsd !== me.balance_micro_usd) {
          useAppStore.getState().setCloudConfig({
            ...snapshot,
            balanceMicroUsd: me.balance_micro_usd,
          });
        }
      })
      .catch(() => {
        /* refresh failure is silent; keep the previous balance */
      });
  }, [open, cloudRestoring, cloudConfig?.token]);

  const isLoggedIn = cloudConfig?.isLoggedIn ?? false;

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      {/* Tooltip 必须在 Trigger **外面**：Radix 的 asChild 只处理它的直接子元素，
          所以顺序必须是 Tooltip > TooltipTrigger asChild > DropdownMenuTrigger asChild
          > (调用方的 button)。
          反过来（把 DropdownMenuTrigger 当 Tooltip 的 trigger）会让菜单的 props 全丢。 */}
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        </TooltipTrigger>
        {/* rail 里的账号气泡在图标**右侧**（本仓老 Tooltip 的 placement="right"）。 */}
        <TooltipContent side="right">{t("sidebar.user")}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" side="right" className="w-64">
        {isLoggedIn && cloudConfig ? (
          <>
            {/* 身份区：首字母头像 + 完整邮箱。触发行截断长邮箱，这里是完整版。 */}
            <div className="flex items-center gap-2 px-2.5 py-2">
              <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary-text">
                {avatarInitials(cloudConfig.email ?? "") || (
                  <User className="h-4 w-4" />
                )}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                {cloudConfig.email}
              </span>
            </div>
            <DropdownMenuSeparator />
          </>
        ) : null}

        {isLoggedIn && cloudConfig ? (
          /* 余额行现在是**菜单项本身**（Review 的 Critical：Radix 的菜单
             `preventDefault` 掉 Tab、只在注册过的 item 间 rove 焦点 —— 行内嵌一个
             普通 button 会让它在键盘上完全不可达 ✗）。
             做成 DropdownMenuItem 后：① 键盘可达；② 不再有按钮嵌套
             （原来那个内嵌的「充值」按钮已删 —— 整行的动作就是充值）。 */
          <DropdownMenuItem
            className="h-7 gap-2"
            onSelect={() => {
              useAppStore.getState().setTopUpOpen(true);
              onOpenChange(false);
            }}
          >
            <span className="shrink-0 text-muted-foreground">
              <Coins className="w-4 h-4" />
            </span>
            <span className="text-muted-foreground">{t("accountMenu.balance")}</span>
            <span className="min-w-0 truncate font-medium">
              {formatMicroUsd(cloudConfig.balanceMicroUsd)}
            </span>
            <span className="flex-1" />
            <span className="flex flex-shrink-0 items-center gap-1 text-xs font-medium text-foreground">
              <Zap className="h-3.5 w-3.5" />
              {t("accountMenu.topUpAction")}
            </span>
          </DropdownMenuItem>
        ) : null}

        <DropdownMenuItem
          className="h-7 gap-2"
          onClick={() => {
            onOpenSettings();
            onOpenChange(false);
          }}
        >
          <span className="shrink-0 text-muted-foreground">
            <Settings className="w-4 h-4" />
          </span>
          <span className="truncate">{t("sidebar.settings")}</span>
        </DropdownMenuItem>
        {/* 桌面宠物开关：**这一行本身就是那个开关** —— Radix 的菜单会 preventDefault 掉 Tab、
            只在注册过的 item 之间 rove 焦点，所以行内不能再嵌一个**可聚焦**的按钮
            （Review Critical #2：余额行当初就是这么把键盘可达性弄丢的）。
            右侧的 Switch 是它的状态显示：pointer-events-none 让点击穿到行上，且不挂
            onCheckedChange —— 否则同一次点击会被取反两次（行与 Switch 各一次）。 */}
        <DropdownMenuItem
          onSelect={() => updateSettings({ petEnabled: !petEnabled })}
          className="h-7 gap-2"
        >
          <CircleDot className="w-4 h-4 text-muted-foreground" />
          <span className="flex-1 text-left">
            {t("accountMenu.desktopPet")}
          </span>
          <Switch
            checked={petEnabled}
            aria-label={t("accountMenu.desktopPet")}
            tabIndex={-1}
            className="pointer-events-none flex-none"
          />
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {cloudRestoring ? (
          <div className="flex items-center gap-2 px-2.5 py-2 text-sm text-muted-foreground">
            <span className="truncate">...</span>
          </div>
        ) : isLoggedIn && cloudConfig ? (
          <DropdownMenuItem
            className="h-7 gap-2"
            onClick={() => {
              onLogout();
              onOpenChange(false);
            }}
          >
            <span className="shrink-0 text-muted-foreground">
              <LogOut className="w-4 h-4" />
            </span>
            <span className="truncate">{t("auth.logout")}</span>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            className="h-7 gap-2"
            onClick={() => {
              onOpenLogin();
              onOpenChange(false);
            }}
          >
            <span className="shrink-0 text-muted-foreground">
              <LogIn className="w-4 h-4" />
            </span>
            <span className="truncate">{t("auth.loginEntry")}</span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
