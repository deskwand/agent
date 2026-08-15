import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { LogIn, User, Settings, LogOut, Zap, Coins } from "lucide-react";
import type { CloudConfig } from "../types";
import { useAppStore } from "../store";
import { CloudApiClient } from "../services/cloud-api";

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
        if (snapshot.creditsBalance !== me.credits_balance) {
          useAppStore.getState().setCloudConfig({
            ...snapshot,
            creditsBalance: me.credits_balance,
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
      <div className="absolute bottom-full left-0 mb-2 w-56 rounded-xl border border-border bg-background shadow-soft p-1.5 z-50 animate-account-menu-in">
        <MenuItem
          icon={<Settings className="w-4 h-4" />}
          label={t("sidebar.settings")}
          onClick={() => {
            onOpenSettings();
            onClose();
          }}
        />

        <div className="mx-2 my-1 border-t border-border" />

        {cloudRestoring ? (
          <div className="flex items-center gap-2 px-2.5 py-2 text-sm text-text-muted">
            <span className="truncate">...</span>
          </div>
        ) : isLoggedIn && cloudConfig ? (
          <>
            <div className="flex items-center gap-2 px-2.5 py-2 text-sm text-text-primary">
              <User className="w-4 h-4 text-text-muted flex-shrink-0" />
              <span className="truncate">{cloudConfig.email}</span>
            </div>
            <div className="flex items-center gap-2 px-2.5 py-2 text-sm">
              <Coins className="w-4 h-4 text-text-muted flex-shrink-0" />
              <span className="text-text-muted">
                {t("accountMenu.balance")}
              </span>
              <span className="ml-auto text-text-primary font-medium">
                {cloudConfig.creditsBalance.toLocaleString()}{" "}
                {t("accountMenu.creditsUnit")}
              </span>
              <button
                type="button"
                onClick={() => {
                  useAppStore.getState().setTopUpOpen(true);
                  onClose();
                }}
                className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-text-primary transition-colors hover:bg-surface-hover"
              >
                <Zap className="w-3.5 h-3.5" />
                {t("accountMenu.topUpAction")}
              </button>
            </div>
            <div className="mx-2 my-1 border-t border-border" />
            <MenuItem
              icon={<LogOut className="w-4 h-4" />}
              label={t("auth.logout")}
              onClick={() => {
                onLogout();
                onClose();
              }}
            />
          </>
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
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm hover:bg-surface-hover transition-colors disabled:opacity-50 disabled:cursor-default"
    >
      <span className="text-text-muted flex-shrink-0">{icon}</span>
      <span className="text-text-primary truncate">{label}</span>
    </button>
  );
}
