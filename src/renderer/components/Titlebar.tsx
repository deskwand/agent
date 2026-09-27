import {
  Minus,
  Square,
  X,
  Copy,
  FolderOpen,
  Diff,
  Globe,
  Package,
} from "lucide-react";
import { useState } from "react";
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
    <div className="relative h-10 bg-background flex items-center titlebar-drag shrink-0">
      {/* 会话标题相对窗口居中：左右各留 160px，避免压住 macOS 的 traffic lights
          与右侧按钮组。pointer-events-none 让这块仍然可以拖窗。 */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-40">
        <span className="min-w-0 truncate text-sm font-medium text-text-primary">
          {showSessionHeader ? activeSessionTitle : ""}
        </span>
      </div>

      {/* 侧栏开合已改由图标栏的「聊天」项承担，顶栏不再有这个按钮 */}
      <div className="ml-auto flex items-center">
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
