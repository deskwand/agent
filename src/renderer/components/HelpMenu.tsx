import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowUpRight,
  BookOpen,
  Bug,
  CircleArrowUp,
  CircleHelp,
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

  // 更新就绪后菜单必须收起：否则它会停在「检查更新」那一行上，
  // 而更新已经在硬盘上了（设计文档 §3.4）。
  const menuVisible = menuOpen && !hasUpdate;

  // 有更新时这颗按钮不再是「帮助」，而是「升级」：文案与可访问名同源。
  // store 存裸 semver，前缀 v 在这里补 —— 与弹窗版本徽标的拼法一致。
  const railLabel = hasUpdate
    ? t("update.railLabel", { version: `v${updateVersion}` })
    : t("help.label");

  return (
    <div className="relative flex flex-col items-center">
      <Tooltip label={railLabel} placement="right">
        <button
          type="button"
          aria-label={railLabel}
          // 有更新时它是直接动作按钮，不是菜单按钮：两个菜单属性必须一起撤掉
          aria-haspopup={hasUpdate ? undefined : "menu"}
          aria-expanded={hasUpdate ? undefined : menuOpen}
          onClick={() => {
            if (hasUpdate) {
              // 菜单可能正开着：假状态被清掉时它不该自己冒出来
              setMenuOpen(false);
              setShowUpdateDialog(true);
              return;
            }
            setMenuOpen((v) => !v);
          }}
          className={`${RAIL_BUTTON_CLASS} relative ${
            hasUpdate
              ? // hover 底用 overlay-hover：accent 压在 accent-muted 上时，
                // 亮色 ember 只有 2.97:1（低于 3:1），实测见设计文档 §5
                "text-accent hover:bg-overlay-hover"
              : "text-text-muted hover:bg-overlay-hover hover:text-text-primary"
          }`}
        >
          {hasUpdate ? (
            <CircleArrowUp className="w-4 h-4" />
          ) : (
            <CircleHelp className="w-4 h-4" />
          )}
        </button>
      </Tooltip>

      {menuVisible && (
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
