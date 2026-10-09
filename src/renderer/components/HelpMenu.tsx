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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
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

  // 有更新时这颗按钮不再是「帮助」，而是「升级」：文案与可访问名同源。
  // store 存裸 semver，前缀 v 在这里补 —— 与弹窗版本徽标的拼法一致。
  const railLabel = hasUpdate
    ? t("update.railLabel", { version: `v${updateVersion}` })
    : t("help.label");

  return (
    <div className="relative flex flex-col items-center">
      {hasUpdate ? (
        // 有更新时它是**直接动作按钮**，不是菜单按钮 —— 而 Radix 的
        // DropdownMenuTrigger 会硬塞 aria-haspopup="menu" 并接管点击，
        // 所以这条分支不能接 Radix，必须条件渲染（设计 §3.4）。
        <Tooltip label={railLabel} placement="right">
          <button
            type="button"
            aria-label={railLabel}
            onClick={() => {
              // 菜单可能正开着：假状态被清掉时它不该自己冒出来
              setMenuOpen(false);
              setShowUpdateDialog(true);
            }}
            className={`${RAIL_BUTTON_CLASS} relative text-accent hover:bg-overlay-hover`}
          >
            <CircleArrowUp className="w-4 h-4" />
          </button>
        </Tooltip>
      ) : (
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          {/* Tooltip 在外、Trigger 在内：本仓的 Tooltip 是**包一层 span** 的，
              反过来会让 asChild 把 trigger props 传给 Tooltip 而不是 button。 */}
          <Tooltip label={railLabel} placement="right">
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={railLabel}
                // aria-haspopup / aria-expanded 由 Radix 的 Trigger 管，不要手写
                className={`${RAIL_BUTTON_CLASS} relative text-text-muted hover:bg-overlay-hover hover:text-text-primary`}
              >
                <CircleHelp className="w-4 h-4" />
              </button>
            </DropdownMenuTrigger>
          </Tooltip>

          <DropdownMenuContent align="start" side="right" className="w-64">
            <DropdownMenuItem
              className="h-7 gap-2"
              onClick={() => openExternal(MANUAL_URL)}
            >
              <span className="shrink-0 text-text-muted">
                <BookOpen className="w-4 h-4" />
              </span>
              <span className="truncate">{t("help.docs")}</span>
              <span className="ml-auto shrink-0 text-text-muted">
                <ArrowUpRight className="w-4 h-4" />
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="h-7 gap-2"
              onClick={() => openExternal(FEEDBACK_URL)}
            >
              <span className="shrink-0 text-text-muted">
                <Bug className="w-4 h-4" />
              </span>
              <span className="truncate">{t("help.feedback")}</span>
              <span className="ml-auto shrink-0 text-text-muted">
                <ArrowUpRight className="w-4 h-4" />
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="h-7 gap-2"
              onClick={() => {
                const store = useAppStore.getState();
                store.setSettingsTab("about");
                store.setActiveView("settings");
              }}
            >
              <span className="shrink-0 text-text-muted">
                <Info className="w-4 h-4" />
              </span>
              <span className="truncate">{t("about.title")}</span>
              {currentAppVersion ? (
                <span className="ml-auto shrink-0 text-xs text-text-muted">
                  v{currentAppVersion}
                </span>
              ) : null}
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            <DropdownMenuItem
              className="h-7 gap-2"
              onClick={() => {
                window.electronAPI?.send({
                  type: "update.check",
                  payload: {},
                });
              }}
            >
              <span className="shrink-0 text-text-muted">
                <RefreshCw className="w-4 h-4" />
              </span>
              <span className="truncate">{t("about.checkUpdate")}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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
