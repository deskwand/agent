import {
  Minus,
  Square,
  X,
  Copy,
  SidebarOpen,
  SidebarClose,
  FolderOpen,
  GitCompare,
  Globe,
  Layers,
} from "lucide-react";
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../store";

const isMac =
  typeof window !== "undefined" && window.electronAPI?.platform === "darwin";

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
  const isReviewOpen = useAppStore((s) => s.isReviewOpen);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const toggleFileBrowser = useAppStore((s) => s.toggleFileBrowser);
  const toggleReviewPanel = useAppStore((s) => s.toggleReviewPanel);
  const toggleBrowserPanel = useAppStore((s) => s.toggleBrowserPanel);
  const toggleArtifactPanel = useAppStore((s) => s.toggleArtifactPanel);
  const isArtifactPanelOpen = useAppStore((s) => s.isArtifactPanelOpen);
  const gitChangeCount = useAppStore((s) => s.gitChangeCount);
  const showSettings = useAppStore((s) => s.showSettings);

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
      {/* Artifact panel toggle */}
      <button
        data-artifact-toggle
        onClick={toggleArtifactPanel}
        className="relative w-7 h-7 rounded-md flex items-center justify-center hover:bg-surface-hover transition-colors"
        title={t("artifactPanel.toggle", "产物面板")}
      >
        <Layers
          className={`w-3.5 h-3.5 ${
            isArtifactPanelOpen ? "text-accent" : "text-text-muted"
          }`}
        />
        {!isArtifactPanelOpen && gitChangeCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 inline-flex items-center justify-center min-w-[1.125rem] h-[1.125rem] rounded-full bg-accent text-[0.625rem] font-bold text-background px-1 leading-none">
            {gitChangeCount}
          </span>
        )}
      </button>
      {/* File browser toggle */}
      <button
        onClick={toggleFileBrowser}
        className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-surface-hover transition-colors"
        title={
          rightPanelMode === "files" ? "切回上下文面板" : "文件浏览"
        }
      >
        <FolderOpen
          className={`w-3.5 h-3.5 ${
            rightPanelMode === "files"
              ? "text-accent"
              : "text-text-muted"
          }`}
        />
      </button>
      {/* Browser toggle */}
      <button
        onClick={toggleBrowserPanel}
        className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-surface-hover transition-colors"
        title={
          rightPanelMode === "browser"
            ? t("titlebar.switchToContext")
            : t("titlebar.builtInBrowser")
        }
      >
        <Globe
          className={`w-3.5 h-3.5 ${
            rightPanelMode === "browser"
              ? "text-accent"
              : "text-text-muted"
          }`}
        />
      </button>
      {/* Review toggle */}
      <button
        onClick={toggleReviewPanel}
        className="relative w-7 h-7 rounded-md flex items-center justify-center hover:bg-surface-hover transition-colors"
        title={isReviewOpen ? "关闭代码审查" : "代码审查"}
      >
        <GitCompare
          className={`w-3.5 h-3.5 ${
            isReviewOpen ? "text-accent" : "text-text-muted"
          }`}
        />
        {gitChangeCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 inline-flex items-center justify-center min-w-[1.125rem] h-[1.125rem] rounded-full bg-accent text-[0.625rem] font-bold text-background px-1 leading-none">
            {gitChangeCount}
          </span>
        )}
      </button>
    </div>
  );

  return (
    <div className="h-10 bg-background-secondary border-b border-border flex items-center titlebar-drag shrink-0">
      {/* macOS: Traffic lights are positioned by trafficLightPosition, we just need left padding */}

      <div
        className={`flex-1 min-w-0 px-3 ${isMac && !isFullScreen ? "pl-20" : ""}`}
      >
        {showSessionHeader ? (
          <div className="h-full grid grid-cols-[17.5rem_1fr_18rem] items-center">
            <div className="titlebar-no-drag px-2">
              <button
                onClick={toggleSidebar}
                className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-surface-hover transition-colors text-text-secondary"
                title={
                  sidebarCollapsed
                    ? t("context.expandPanel")
                    : t("context.collapsePanel")
                }
              >
                {sidebarCollapsed ? (
                  <SidebarOpen className="w-3.5 h-3.5" />
                ) : (
                  <SidebarClose className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
            <div className="text-sm font-medium text-text-primary text-center truncate px-4">
              {activeSessionTitle}
            </div>
            {rightToolbar}
          </div>
        ) : !showSettings ? (
          <div className="h-full flex items-center justify-end titlebar-no-drag">
            {rightToolbar}
          </div>
        ) : null}
      </div>

      {/* Window Controls (for Windows/Linux - macOS uses native traffic lights) */}
      {!isMac && (
        <div className="flex items-center titlebar-no-drag h-full">
          <button
            onClick={handleMinimize}
            className="w-12 h-full flex items-center justify-center hover:bg-surface transition-colors"
            title={t("window.minimize")}
          >
            <Minus className="w-4 h-4 text-text-secondary" />
          </button>
          <button
            onClick={handleMaximize}
            className="w-12 h-full flex items-center justify-center hover:bg-surface transition-colors"
            title={isMaximized ? t("window.restore") : t("window.maximize")}
          >
            {isMaximized ? (
              <Copy className="w-3.5 h-3.5 text-text-secondary" />
            ) : (
              <Square className="w-3.5 h-3.5 text-text-secondary" />
            )}
          </button>
          <button
            onClick={handleClose}
            className="w-12 h-full flex items-center justify-center hover:bg-red-500 transition-colors group"
            title={t("window.close")}
          >
            <X className="w-4 h-4 text-text-secondary group-hover:text-white" />
          </button>
        </div>
      )}
    </div>
  );
}
