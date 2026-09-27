import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { User } from "lucide-react";
import { useAppStore } from "../store";
import { DESKWAND_API_URL } from "../../shared/oauth-config";
import { avatarInitials } from "../utils/identity";
import { buildDeskwandProviderPayload } from "../utils/cloud-provider";
import { CloudApiClient } from "../services/cloud-api";
import { AccountMenu } from "./AccountMenu";
import { ConfirmDialog } from "./ConfirmDialog";
import { LoginModal } from "./LoginModal";
import { Tooltip } from "./Tooltip";

/**
 * 图标栏底部的账号簇：头像触发按钮 + 账号弹层 + 它带出的两个弹窗，
 * 以及启动时恢复云端登录状态一个副作用。
 *
 * 它放在图标栏而不是侧栏，是因为侧栏只在聊天视图挂载（见 utils/nav-rail.ts
 * 的 isSidebarAllowed）——若留在侧栏，切到设置/用量页时账号入口和弹窗会一起消失。
 * 应用级的帮助 / 更新 / 关于在 HelpMenu，不在这里。
 */
export function AccountCluster() {
  const { t } = useTranslation();
  const cloudConfig = useAppStore((s) => s.cloudConfig);
  const showLoginModal = useAppStore((s) => s.showLoginModal);
  const setShowLoginModal = useAppStore((s) => s.setShowLoginModal);
  const setCloudConfig = useAppStore((s) => s.setCloudConfig);

  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [confirmLogoutOpen, setConfirmLogoutOpen] = useState(false);
  const [cloudRestoring, setCloudRestoring] = useState(false);
  // 触发行身份化：登录恢复期/空邮箱保持图标态，避免身份行闪变或空内容
  const identityEmail =
    !cloudRestoring && cloudConfig?.isLoggedIn && cloudConfig.email
      ? cloudConfig.email
      : null;

  // 启动时恢复云端登录状态
  useEffect(() => {
    try {
      const raw = localStorage.getItem("deskwand.cloud");
      if (!raw) return;
      const c = JSON.parse(raw);
      if (!c?.token) return;
      setCloudRestoring(true);
      (async () => {
        try {
          const me = await new CloudApiClient(c.token).getMe();
          setCloudConfig({
            serverUrl: DESKWAND_API_URL,
            token: c.token,
            isLoggedIn: true,
            email: me.email,
            level: me.level,
            balanceMicroUsd: me.balance_micro_usd,
          });
          // 已登录用户升级后仍持有带模式名的旧 payload：启动时按当前定价重建。
          // 列表为空（如接口异常）时保留已保存的 payload，不能把云模型清空。
          try {
            const pricing = await new CloudApiClient(c.token).getPricing();
            // 用户在全局路径选过的默认模型不能被启动重建静默改回第一个
            const previousDefault =
              useAppStore.getState().appConfig?.providers?.["custom:deskwand"]
                ?.defaultModel;
            const payload = buildDeskwandProviderPayload(
              pricing.models,
              c.token,
              t,
              previousDefault,
            );
            if (payload.config.models.length > 0) {
              await window.electronAPI.config.saveProvider(payload);
            }
          } catch {
            /* 保留已保存的 provider 配置 */
          }
        } catch (e: unknown) {
          const status = (e as { status?: number } | null)?.status;
          if (status === 401) {
            localStorage.removeItem("deskwand.cloud");
            try {
              await window.electronAPI.config.deleteProvider({
                profileKey: "custom:deskwand",
              });
            } catch {
              /* ignore */
            }
          }
          // 网络错误时保留 localStorage，下次启动再试
        } finally {
          setCloudRestoring(false);
        }
      })();
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <div className="relative flex flex-col items-center">
      <Tooltip label={t("sidebar.user")}>
        <button
          type="button"
          aria-label={t("sidebar.user")}
          aria-haspopup="menu"
          aria-expanded={accountMenuOpen}
          onClick={() => setAccountMenuOpen((v) => !v)}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/15 text-[10px] font-semibold text-accent transition-colors hover:bg-accent/25"
        >
          {identityEmail ? (
            avatarInitials(identityEmail)
          ) : (
            <User className="h-4 w-4" />
          )}
        </button>
      </Tooltip>

      <AccountMenu
        isOpen={accountMenuOpen}
        cloudConfig={cloudConfig}
        cloudRestoring={cloudRestoring}
        onOpenLogin={() => setShowLoginModal(true)}
        onOpenSettings={() => {
          useAppStore.getState().setActiveView("settings");
          setAccountMenuOpen(false);
        }}
        onLogout={() => {
          setAccountMenuOpen(false);
          setConfirmLogoutOpen(true);
        }}
        onClose={() => setAccountMenuOpen(false)}
      />

      <LoginModal
        isOpen={showLoginModal}
        onClose={() => setShowLoginModal(false)}
        onLoginSuccess={(config) => setCloudConfig(config)}
      />
      <ConfirmDialog
        isOpen={confirmLogoutOpen}
        title={t("auth.logoutConfirm")}
        confirmLabel={t("auth.logoutConfirmBtn")}
        onConfirm={async () => {
          setConfirmLogoutOpen(false);
          if (cloudConfig?.token) {
            try {
              await new CloudApiClient(cloudConfig.token).logout();
            } catch {
              /* ignore */
            }
            try {
              await window.electronAPI.config.deleteProvider({
                profileKey: "custom:deskwand",
              });
            } catch {
              /* ignore */
            }
            setCloudConfig(null);
          } else {
            setCloudConfig(null);
          }
        }}
        onCancel={() => setConfirmLogoutOpen(false)}
      />
    </div>
  );
}
