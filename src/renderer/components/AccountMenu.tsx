import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { formatMicroUsd } from "../utils/topup";
import {
  LogIn,
  User,
  Settings,
  LogOut,
  Zap,
  Coins,
  BarChart3,
  ChevronRight,
} from "lucide-react";
import type { CloudConfig } from "../types";
import { useAppStore } from "../store";
import { CloudApiClient } from "../services/cloud-api";
import { avatarInitials } from "../utils/identity";
import {
  MENU_ITEM_CLASS,
  MENU_ITEM_DEFAULT_CLASS,
  MENU_ITEM_DISABLED_CLASS,
  MENU_PANEL_PADDED_CLASS,
  MENU_SEPARATOR_CLASS,
} from "./menu-styles";

interface AccountMenuProps {
  isOpen: boolean;
  cloudConfig: CloudConfig | null;
  cloudRestoring?: boolean;
  onOpenLogin: () => void;
  onOpenSettings: () => void;
  onLogout: () => void;
  onClose: () => void;
}

export function AccountMenu({
  isOpen,
  cloudConfig,
  cloudRestoring,
  onOpenLogin,
  onOpenSettings,
  onLogout,
  onClose,
}: AccountMenuProps) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!isOpen || cloudRestoring || !cloudConfig?.token) return;
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
  }, [isOpen, cloudRestoring, cloudConfig?.token]);

  if (!isOpen) return null;

  const isLoggedIn = cloudConfig?.isLoggedIn ?? false;

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className={`${MENU_PANEL_PADDED_CLASS} animate-menu-in-up absolute bottom-full left-0 z-50 mb-2 w-64`}
      >
        {isLoggedIn && cloudConfig ? (
          <>
            {/* 身份区：首字母头像 + 完整邮箱。触发行截断长邮箱，这里是完整版。 */}
            <div className="flex items-center gap-2 px-2.5 py-2">
              <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-accent/15 text-xs font-semibold text-accent">
                {avatarInitials(cloudConfig.email ?? "") || (
                  <User className="h-4 w-4" />
                )}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-text-primary">
                {cloudConfig.email}
              </span>
            </div>
            <div className={MENU_SEPARATOR_CLASS} />
          </>
        ) : null}

        <MenuItem
          icon={<Settings className="w-4 h-4" />}
          label={t("sidebar.settings")}
          onClick={() => {
            onOpenSettings();
            onClose();
          }}
        />

        {/* Local usage stats need no account: keep this entry outside the
            logged-in branch so it is reachable while logged out. */}
        <MenuItem
          icon={<BarChart3 className="w-4 h-4" />}
          label={t("accountMenu.usage")}
          trailing={<ChevronRight className="w-4 h-4" />}
          onClick={() => {
            useAppStore.getState().setActiveView("usage");
            onClose();
          }}
        />

        {isLoggedIn && cloudConfig ? (
          /* 余额行是 div 而非 button（内含充值按钮，避免按钮嵌套）；
             不用 MENU_ITEM_DEFAULT_CLASS——整行不可点，不应有 hover 底色 */
          <div className={`${MENU_ITEM_CLASS} text-text-primary`}>
            <span className="shrink-0 text-text-muted">
              <Coins className="w-4 h-4" />
            </span>
            <span className="text-text-muted">{t("accountMenu.balance")}</span>
            <span className="min-w-0 truncate font-medium">
              {formatMicroUsd(cloudConfig.balanceMicroUsd)}
            </span>
            <span className="flex-1" />
            <button
              type="button"
              onClick={() => {
                useAppStore.getState().setTopUpOpen(true);
                onClose();
              }}
              className="flex flex-shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-text-primary transition-colors hover:bg-surface-hover"
            >
              <Zap className="h-3.5 w-3.5" />
              {t("accountMenu.topUpAction")}
            </button>
          </div>
        ) : null}

        <div className={MENU_SEPARATOR_CLASS} />

        {cloudRestoring ? (
          <div className="flex items-center gap-2 px-2.5 py-2 text-sm text-text-muted">
            <span className="truncate">...</span>
          </div>
        ) : isLoggedIn && cloudConfig ? (
          <MenuItem
            icon={<LogOut className="w-4 h-4" />}
            label={t("auth.logout")}
            onClick={() => {
              onLogout();
              onClose();
            }}
          />
        ) : (
          <MenuItem
            icon={<LogIn className="w-4 h-4" />}
            label={t("auth.loginEntry")}
            onClick={() => {
              onOpenLogin();
              onClose();
            }}
          />
        )}
      </div>
    </>
  );
}

function MenuItem({
  icon,
  label,
  trailing,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  trailing?: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
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
