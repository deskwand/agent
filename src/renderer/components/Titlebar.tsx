import {
  Minus,
  Square,
  X,
  Copy,
  PanelLeft,
  Columns2,
  FolderOpen,
  Diff,
  Globe,
  Package,
} from "lucide-react";
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../store";
import { Tooltip } from "./Tooltip";

const isMac =
  typeof window !== "undefined" && window.electronAPI?.platform === "darwin";

interface TitlebarButtonProps {
  /** 气泡文案，同时用作 aria-label。调用方负责 i18n。 */
  label: string;
  /** 面板已开启。注意与 CSS :active 伪类（物理按下）不是一回事。 */
  isOn?: boolean;
  /** 静止时的图标色。仅未开启时生效。 */
  tone?: "muted" | "secondary";
  onClick?: () => void;
  children: React.ReactNode;
}

function TitlebarButton({
  label,
  isOn = false,
  tone = "muted",
  onClick,
  children,
}: TitlebarButtonProps) {
  // 已开启与未开启是两套互斥的 class 组合，不是靠 CSS 优先级叠加：
  // Tailwind 输出的 hover: 变体晚于无前缀的 bg-overlay-on，同时存在时会把
  // 已开启背景盖掉。
  const stateClasses = isOn
    ? "bg-overlay-on text-accent active:scale-[0.96] active:duration-75"
    : `hover:bg-overlay-hover hover:text-text-primary active:bg-overlay-press active:scale-[0.96] active:duration-75 ${
        tone === "secondary" ? "text-text-secondary" : "text-text-muted"
      }`;

  return (
    <Tooltip label={label}>
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className={`w-7 h-7 rounded-control grid place-items-center transition-[background-color,color,transform] duration-150 ${stateClasses}`}
      >
        {children}
      </button>
    </Tooltip>
  );
}

export function Titlebar() {
  const { t } = useTranslation();
  const [isMaximized, setIsMaximized] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);

  useEffect(() => {
    if (!isMac) return;
    const cleanup =
      window.electronAPI?.window.onFullScreenChanged?.(setIsFullScreen);
    return cleanup;
  }, []);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const sessions = useAppStore((s) => s.sessions);
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const rightPanelMode = useAppStore((s) => s.rightPanelMode);
  const isReviewOpen = useAppStore((s) => s.rightPanelMode === "review");
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const toggleFileBrowser = useAppStore((s) => s.toggleFileBrowser);
  const toggleReviewPanel = useAppStore((s) => s.toggleReviewPanel);
  const toggleBrowserPanel = useAppStore((s) => s.toggleBrowserPanel);
  const toggleArtifactPanel = useAppStore((s) => s.toggleArtifactPanel);
  const isArtifactPanelOpen = useAppStore((s) => s.isArtifactPanelOpen);
  const showSettings = useAppStore((s) => s.activeView === "settings");

  const activeSessionTitle = activeSessionId
    ? (sessions.find((session) => session.id === activeSessionId)?.title ?? "")
    : "";
  const showSessionHeader = Boolean(activeSessionId) && !showSettings;

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

  const sidebarToggle = (
    <TitlebarButton
      label={
        sidebarCollapsed ? t("context.expandPanel") : t("context.collapsePanel")
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
  );

  return (
    <div className="h-10 bg-background-secondary border-b border-border flex items-center titlebar-drag shrink-0">
      {/* macOS: Traffic lights are positioned by trafficLightPosition, we just need left padding */}

      <div
        className={`flex-1 min-w-0 px-3 ${isMac && !isFullScreen ? "pl-20" : ""}`}
      >
        {showSessionHeader ? (
          <div className="h-full grid grid-cols-[17.5rem_1fr_18rem] items-center">
            <div className="titlebar-no-drag px-2">{sidebarToggle}</div>
            <div className="text-sm font-medium text-text-primary text-center truncate px-4">
              {activeSessionTitle}
            </div>
            {rightToolbar}
          </div>
        ) : !showSettings ? (
          // 没有会话时也不能只剩右侧工具条：侧栏会被预览/浏览器自动收起，
          // 少了这个按钮就再也展不开。
          <div className="h-full flex items-center justify-between titlebar-no-drag">
            <div className="px-2">{sidebarToggle}</div>
            {rightToolbar}
          </div>
        ) : null}
      </div>

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
  );
}
