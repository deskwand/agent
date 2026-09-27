import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowUpRight,
  BookOpen,
  Bug,
  CircleHelp,
  Download,
  Info,
  RefreshCw,
} from "lucide-react";
import { useAppStore } from "../store";
import { MenuItem } from "./menu-item";
import { MENU_PANEL_PADDED_CLASS, MENU_SEPARATOR_CLASS } from "./menu-styles";
import { Tooltip } from "./Tooltip";
import { RAIL_BUTTON_CLASS } from "./rail-styles";
import { UpdateConfirmDialog } from "./UpdateConfirmDialog";

/** 外部链接是常量不是文案：不进 i18n，也没有跨组件共享需求。 */
const MANUAL_URL = "https://www.deskwand.com/manual";
const FEEDBACK_URL = "https://github.com/deskwand/agent/issues";

/**
 * 图标栏底部的帮助菜单：? 按钮 + 弹层 + 更新弹窗。
 * 应用级信息（帮助 / 更新 / 关于）都在这里，账号相关在 AccountCluster。
 */
export function HelpMenu() {
  const { t } = useTranslation();
  const updateReady = useAppStore((s) => s.updateReady);
  const updateVersion = useAppStore((s) => s.updateVersion);
  const updateNotes = useAppStore((s) => s.updateNotes);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showUpdateDialog, setShowUpdateDialog] = useState(false);
  const [currentAppVersion, setCurrentAppVersion] = useState("");

  // Get current app version for update dialog
  useEffect(() => {
    if (!window.electronAPI) return;
    try {
      const v = window.electronAPI.getVersion?.();
      if (v instanceof Promise) {
        v.then((ver) => {
          if (ver) setCurrentAppVersion(ver);
        });
      } else if (v) {
        setCurrentAppVersion(v);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const openExternal = (url: string) => {
    void window.electronAPI?.openExternal?.(url);
  };

  const hasUpdate = updateReady && Boolean(updateVersion);

  return (
    <div className="relative flex flex-col items-center">
      <Tooltip label={t("help.label")} placement="right">
        <button
          type="button"
          aria-label={t("help.label")}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
          className={`${RAIL_BUTTON_CLASS} relative text-text-muted hover:bg-overlay-hover hover:text-text-primary`}
        >
          <CircleHelp className="w-4 h-4" />
          {hasUpdate && (
            <span
              aria-hidden="true"
              // 挖坑环必须等于图标栏自己的底色：这颗点长在图标栏（外圈，background）上。
              // 2026-09-27 图标栏从 secondary 改入 background 时这里漏改过一次（reviewer 抓的）；
              // 会话栏里那颗（sidebar-disclosure-motion.tsx）仍在 secondary 上，别一起改。
              className="absolute right-[-2px] top-[-2px] h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_0_2px_var(--color-background)]"
            />
          )}
        </button>
      </Tooltip>

      {menuOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setMenuOpen(false)}
          />
          <div
            className={`${MENU_PANEL_PADDED_CLASS} animate-menu-in-up absolute bottom-0 left-full z-50 ml-2 w-64`}
          >
            <MenuItem
              icon={<BookOpen className="w-4 h-4" />}
              label={t("help.docs")}
              trailing={<ArrowUpRight className="w-4 h-4" />}
              onClick={() => {
                openExternal(MANUAL_URL);
                setMenuOpen(false);
              }}
            />
            <MenuItem
              icon={<Bug className="w-4 h-4" />}
              label={t("help.feedback")}
              trailing={<ArrowUpRight className="w-4 h-4" />}
              onClick={() => {
                openExternal(FEEDBACK_URL);
                setMenuOpen(false);
              }}
            />
            <MenuItem
              icon={<Info className="w-4 h-4" />}
              label={t("about.title")}
              trailing={
                currentAppVersion ? (
                  <span className="text-xs">v{currentAppVersion}</span>
                ) : undefined
              }
              onClick={() => {
                const store = useAppStore.getState();
                store.setSettingsTab("about");
                store.setActiveView("settings");
                setMenuOpen(false);
              }}
            />

            <div className={MENU_SEPARATOR_CLASS} />

            {hasUpdate ? (
              <MenuItem
                icon={<Download className="w-4 h-4" />}
                label={t("update.title")}
                trailing={
                  // store 里存的是裸 semver（electron-updater 的 info.version），
                  // 前缀 v 由界面补 —— 与上面「关于」行的 v1.0.41 保持一致
                  <span className="inline-block max-w-[96px] truncate text-xs">
                    v{updateVersion}
                  </span>
                }
                onClick={() => {
                  setShowUpdateDialog(true);
                  setMenuOpen(false);
                }}
              />
            ) : (
              <MenuItem
                icon={<RefreshCw className="w-4 h-4" />}
                label={t("about.checkUpdate")}
                onClick={() => {
                  window.electronAPI?.send({
                    type: "update.check",
                    payload: {},
                  });
                  setMenuOpen(false);
                }}
              />
            )}
          </div>
        </>
      )}

      <UpdateConfirmDialog
        isOpen={showUpdateDialog}
        currentVersion={currentAppVersion}
        newVersion={updateVersion}
        releaseNotes={updateNotes}
        onConfirm={() => {
          setShowUpdateDialog(false);
          // Send IPC to install the update (quitAndInstall)
          if (window.electronAPI) {
            window.electronAPI.send({
              type: "update.install",
              payload: {},
            });
          }
        }}
        onCancel={() => setShowUpdateDialog(false)}
      />
    </div>
  );
}
