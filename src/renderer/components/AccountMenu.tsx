import { useEffect, useRef, type ReactNode } from "react";
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
  /**
   * 打开充值弹窗的可选交接：余额行被激活时，把**即将随菜单退场的原 Trigger 按钮**交给
   * 上层暂存，供 TopUpModal 打开时用作回焦目标（原生缺陷：否则回不到账号入口）。
   * 不传时退回原来的 store.setTopUpOpen(true)，行为不变。
   */
  onOpenTopUp?: (target: HTMLButtonElement | null) => void;
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
  onOpenTopUp,
}: AccountMenuProps) {
  const { t } = useTranslation();
  const petEnabled = useAppStore((s) => s.settings.petEnabled);
  const updateSettings = useAppStore((s) => s.updateSettings);
  // 原生焦点：ref 直接挂在现有的 DropdownMenuTrigger 上（asChild 会把它交给真实 Trigger
  // 元素，不插包装）。openingTopUpRef 标记「这次退场是余额行 → 充值弹窗」这一次转场。
  const triggerRef = useRef<HTMLButtonElement>(null);
  const openingTopUpRef = useRef(false);

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
      {/* 触发按钮**不再有气泡**（2026-10-10）：rail 底部的账号槽位跟「?」那颗一样
          去掉了视觉提示，可访问名只由调用方 button 上的 aria-label（sidebar.user）给。
          ⚠️ trigger 必须保持「只裹 DropdownMenuTrigger 这一层 asChild」：Radix 把
          onPointerDown / aria-* / ref 交给它的**直接子元素**，中间再插任何不透传
          props/ref 的包装组件都会让菜单**打不开且不报错**（旧 Tooltip 就这么栽过）。
          回归闸：src/tests/renderer/account-menu-structure.test.ts 的 aria-haspopup 断言。 */}
      <DropdownMenuTrigger asChild ref={triggerRef}>
        {trigger}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="right"
        className="w-64"
        onCloseAutoFocus={(event) => {
          // 只有「余额行 → 充值弹窗」这一次退场抑制 Radix 默认的回焦：Dialog 的 FocusScope
          // 会把这次抢回 Trigger 的焦点弹回去（一次无意义抢焦），且原 Trigger 已被交给
          // TopUpModal 回焦。其它菜单动作（设置/退出/宠物开关）语义完全不变。
          if (openingTopUpRef.current) {
            openingTopUpRef.current = false;
            event.preventDefault();
          }
        }}
      >
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
              // 先记下「这是打开充值的转场」，再把被关闭菜单的原 Trigger 交给父级；
              // 没有父级回调（standalone）时保持原来的 store 打开路径。
              openingTopUpRef.current = true;
              if (onOpenTopUp) onOpenTopUp(triggerRef.current);
              else useAppStore.getState().setTopUpOpen(true);
              onOpenChange(false);
            }}
          >
            <span className="shrink-0 text-muted-foreground">
              <Coins className="w-4 h-4" />
            </span>
            <span className="text-muted-foreground">
              {t("accountMenu.balance")}
            </span>
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
