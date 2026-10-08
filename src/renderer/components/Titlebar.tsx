import {
  Minus,
  Square,
  X,
  Copy,
  PanelLeft,
  Columns2,
  SquarePen,
  FolderOpen,
  Diff,
  Globe,
  Package,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../store";
import { Tooltip } from "./Tooltip";
import { TitlebarButton } from "./TitlebarButton";
import { VoiceMiniButton } from "./voice-mode/VoiceMiniButton";
import { FeedListenButton } from "./FeedListenButton";

const isMac =
  typeof window !== "undefined" && window.electronAPI?.platform === "darwin";

export function Titlebar() {
  const { t } = useTranslation();
  const [isMaximized, setIsMaximized] = useState(false);
  // 全屏时 macOS 不显示红绿灯，左簇也就不该再留那 80px（否则窗口左上角一片空白）
  const [isFullScreen, setIsFullScreen] = useState(false);

  useEffect(() => {
    if (!isMac) return;
    const cleanup =
      window.electronAPI?.window.onFullScreenChanged?.(setIsFullScreen);
    return cleanup;
  }, []);

  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const sessions = useAppStore((s) => s.sessions);
  const activeView = useAppStore((s) => s.activeView);
  const rightPanelMode = useAppStore((s) => s.rightPanelMode);
  const isReviewOpen = useAppStore((s) => s.rightPanelMode === "review");
  const toggleFileBrowser = useAppStore((s) => s.toggleFileBrowser);
  const toggleReviewPanel = useAppStore((s) => s.toggleReviewPanel);
  const toggleBrowserPanel = useAppStore((s) => s.toggleBrowserPanel);
  const toggleArtifactPanel = useAppStore((s) => s.toggleArtifactPanel);
  const isArtifactPanelOpen = useAppStore((s) => s.isArtifactPanelOpen);
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const startNewSession = useAppStore((s) => s.startNewSession);
  // 左簇只在聊天视图渲染：侧栏只挂聊天视图，别的视图里这按钮按了不会有反应
  const isChatView = activeView === "chat";

  const activeSessionTitle = activeSessionId
    ? (sessions.find((session) => session.id === activeSessionId)?.title ?? "")
    : "";
  // 只在聊天视图显示会话标题；其余视图自带页头，中央留空
  const showSessionHeader = activeView === "chat" && Boolean(activeSessionId);

  const handleMinimize = () => {
    window.electronAPI?.window.minimize();
  };

  const handleMaximize = () => {
    window.electronAPI?.window.maximize();
    setIsMaximized(!isMaximized);
  };

  const handleClose = () => {
    window.electronAPI?.window.close();
  };

  const rightToolbar = (
    <div className="titlebar-no-drag pr-1 flex items-center justify-end gap-0.5">
      <TitlebarButton
        label={t("artifactPanel.toggle", "产物面板")}
        isOn={isArtifactPanelOpen}
        onClick={toggleArtifactPanel}
      >
        <Package className="w-3.5 h-3.5" />
      </TitlebarButton>
      <TitlebarButton
        label={
          rightPanelMode === "files"
            ? t("titlebar.closeFileBrowser")
            : t("titlebar.fileBrowser")
        }
        isOn={rightPanelMode === "files"}
        onClick={toggleFileBrowser}
      >
        <FolderOpen className="w-3.5 h-3.5" />
      </TitlebarButton>
      <TitlebarButton
        label={
          rightPanelMode === "browser"
            ? t("titlebar.closeBuiltInBrowser")
            : t("titlebar.builtInBrowser")
        }
        isOn={rightPanelMode === "browser"}
        onClick={toggleBrowserPanel}
      >
        <Globe className="w-3.5 h-3.5" />
      </TitlebarButton>
      <TitlebarButton
        label={isReviewOpen ? t("reviewPanel.close") : t("reviewPanel.title")}
        isOn={isReviewOpen}
        onClick={toggleReviewPanel}
      >
        <Diff className="w-3.5 h-3.5" />
      </TitlebarButton>
    </div>
  );

  return (
    <div className="h-10 bg-background-chrome flex items-center titlebar-drag shrink-0">
      {/* macOS 红绿灯留白：全屏时没有红绿灯，这一格跟着去掉 */}
      {isMac && !isFullScreen && <div className="w-20 flex-shrink-0" />}

      {/* 左簇：会话侧栏的开合，以及侧栏收起时的「新建会话」 */}
      {isChatView && (
        <div className="titlebar-no-drag flex items-center gap-0.5 pl-3">
          <TitlebarButton
            label={
              sidebarCollapsed
                ? t("context.expandPanel")
                : t("context.collapsePanel")
            }
            tone="secondary"
            onClick={toggleSidebar}
          >
            {sidebarCollapsed ? (
              <PanelLeft className="w-3.5 h-3.5" />
            ) : (
              <Columns2 className="w-3.5 h-3.5" />
            )}
          </TitlebarButton>

          {/* 展开态不显示：侧栏头部已经有「新建」了 */}
          {sidebarCollapsed && (
            <TitlebarButton
              label={t("sidebar.newChat")}
              tone="secondary"
              onClick={() => startNewSession()}
            >
              <SquarePen className="w-3.5 h-3.5" />
            </TitlebarButton>
          )}
        </div>
      )}

      {/* 标题在左簇与右簇之间居中。注意：不要加 titlebar-no-drag，这一块要保持可拖窗 */}
      <div className="flex-1 min-w-0 px-3 flex justify-center">
        <span className="min-w-0 truncate text-sm font-medium text-text-primary">
          {showSessionHeader ? activeSessionTitle : ""}
        </span>
      </div>

      <div className="flex items-center">
        <div
          data-testid="titlebar-widgets"
          className="titlebar-no-drag flex items-center gap-0.5"
        >
          <VoiceMiniButton />
          <FeedListenButton />
        </div>
        {rightToolbar}

        {/* Window Controls (for Windows/Linux - macOS uses native traffic lights) */}
        {!isMac && (
          <div className="flex items-center titlebar-no-drag h-full">
            <Tooltip label={t("window.minimize")}>
              <button
                type="button"
                onClick={handleMinimize}
                aria-label={t("window.minimize")}
                className="w-12 h-8 my-1 flex items-center justify-center rounded-control text-text-secondary hover:bg-overlay-hover hover:text-text-primary transition-colors"
              >
                <Minus className="w-4 h-4" />
              </button>
            </Tooltip>
            <Tooltip
              label={isMaximized ? t("window.restore") : t("window.maximize")}
            >
              <button
                type="button"
                onClick={handleMaximize}
                aria-label={
                  isMaximized ? t("window.restore") : t("window.maximize")
                }
                className="w-12 h-8 my-1 flex items-center justify-center rounded-control text-text-secondary hover:bg-overlay-hover hover:text-text-primary transition-colors"
              >
                {isMaximized ? (
                  // lucide Copy 的两个错位叠加方框就是 Windows 11 的“还原”字形
                  <Copy className="w-3.5 h-3.5" />
                ) : (
                  <Square className="w-3.5 h-3.5" />
                )}
              </button>
            </Tooltip>
            <Tooltip label={t("window.close")}>
              <button
                type="button"
                onClick={handleClose}
                aria-label={t("window.close")}
                className="group w-12 h-8 my-1 flex items-center justify-center rounded-control text-text-secondary hover:bg-window-close-hover transition-colors"
              >
                <X className="w-4 h-4 group-hover:text-white" />
              </button>
            </Tooltip>
          </div>
        )}
      </div>
    </div>
  );
}
