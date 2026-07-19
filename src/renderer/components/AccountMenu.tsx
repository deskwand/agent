import { useTranslation } from "react-i18next";
import { LogIn, User, Settings, LogOut, Clock3, Cloud } from "lucide-react";
import type { CloudConfig } from "../types";

interface AccountMenuProps {
  isOpen: boolean;
  cloudConfig: CloudConfig | null;
  cloudRestoring?: boolean;
  onOpenLogin: () => void;
  onOpenSettings: () => void;
  onOpenAutomation: () => void;
  onOpenMarketplace: () => void;
  onLogout: () => void;
  onClose: () => void;
}

export function AccountMenu({
  isOpen,
  cloudConfig,
  cloudRestoring,
  onOpenLogin,
  onOpenSettings,
  onOpenAutomation,
  onOpenMarketplace,
  onLogout,
  onClose,
}: AccountMenuProps) {
  const { t } = useTranslation();
  if (!isOpen) return null;

  const isLoggedIn = cloudConfig?.isLoggedIn ?? false;

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute bottom-full left-0 mb-2 w-56 rounded-xl border border-border bg-background shadow-soft p-1.5 z-50 animate-account-menu-in">
        <MenuItem icon={<Cloud className="w-4 h-4" />} label={t("sidebar.skillsCloud")} onClick={() => { onOpenMarketplace(); onClose(); }} />
        <MenuItem icon={<Clock3 className="w-4 h-4" />} label={t("sidebar.automation")} onClick={() => { onOpenAutomation(); onClose(); }} />
        <MenuItem icon={<Settings className="w-4 h-4" />} label={t("sidebar.settings")} onClick={() => { onOpenSettings(); onClose(); }} />

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
            {/* TODO: 恢复剩余用量显示时取消注释 */}
            {/* <MenuItem
              icon={<Zap className="w-4 h-4" />}
              label={`${t("auth.creditsLabel")} ${cloudConfig.creditsBalance.toLocaleString()}`}
              onClick={() => {}}
              disabled
            /> */}
            <MenuItem icon={<LogOut className="w-4 h-4" />} label={t("auth.logout")} onClick={() => { onLogout(); onClose(); }} />
          </>
        ) : (
          <MenuItem icon={<LogIn className="w-4 h-4" />} label={t("auth.loginEntry")} onClick={() => { onOpenLogin(); onClose(); }} />
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
