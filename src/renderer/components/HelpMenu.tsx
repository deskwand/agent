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
import { RAIL_BUTTON_CLASS } from "./rail-styles";
import { UpdateConfirmDialog } from "./UpdateConfirmDialog";
import { Button } from "./app-button";

/** 外部链接是常量不是文案：不进 i18n，也没有跨组件共享需求。 */
const MANUAL_URL = "https://www.deskwand.com/manual";

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
        <Button variant="ghost"
          type="button"
          aria-label={railLabel}
          onClick={() => {
            // 菜单可能正开着：假状态被清掉时它不该自己冒出来
            setMenuOpen(false);
            setShowUpdateDialog(true);
          }}
          className={`${RAIL_BUTTON_CLASS} relative text-primary-text hover:bg-hover-surface`}
        >
          <CircleArrowUp className="w-4 h-4" />
        </Button>
      ) : (
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          {/* 这颗按钮**不再有气泡**（2026-10-10）：整条 rail 底部的「? / 头像」槽位
              都去掉了视觉提示，可访问名只由 aria-label 提供（升级态那支同此）。
              asChild 仍然必要：它把 trigger 的 props/ref 交给**直接子元素**，
              少一层它们就会落在包装组件上而不是 button 上。 */}
          <DropdownMenuTrigger asChild>
            <Button variant="ghost"
              type="button"
              aria-label={railLabel}
              // aria-haspopup / aria-expanded 由 Radix 的 Trigger 管，不要手写
              className={`${RAIL_BUTTON_CLASS} relative text-muted-foreground hover:bg-hover-surface hover:text-foreground`}
            >
              <CircleHelp className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="start" side="right" className="w-64">
            <DropdownMenuItem
              className="h-7 gap-2"
              onClick={() => openExternal(MANUAL_URL)}
            >
              <span className="shrink-0 text-muted-foreground">
                <BookOpen className="w-4 h-4" />
              </span>
              <span className="truncate">{t("help.docs")}</span>
              <span className="ml-auto shrink-0 text-muted-foreground">
                <ArrowUpRight className="w-4 h-4" />
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="h-7 gap-2"
              onClick={() => {
                useAppStore.getState().setActiveView("feedback");
              }}
            >
              <span className="shrink-0 text-muted-foreground">
                <Bug className="w-4 h-4" />
              </span>
              <span className="truncate">{t("help.feedback")}</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="h-7 gap-2"
              onClick={() => {
                const store = useAppStore.getState();
                store.setSettingsTab("about");
                store.setActiveView("settings");
              }}
            >
              <span className="shrink-0 text-muted-foreground">
                <Info className="w-4 h-4" />
              </span>
              <span className="truncate">{t("about.title")}</span>
              {currentAppVersion ? (
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
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
              <span className="shrink-0 text-muted-foreground">
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
