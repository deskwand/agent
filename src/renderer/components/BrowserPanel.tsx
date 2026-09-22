import { useState, useEffect, useRef, useCallback } from "react";
import {
  X,
  ChevronLeft,
  ChevronRight,
  RotateCw,
  Loader2,
  ExternalLink,
  Globe,
  Maximize2,
  Minimize2,
  MousePointerSquareDashed,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../store";
import { Tooltip } from "./Tooltip";
import { useThemeSetting, useSystemDarkMode } from "../store/selectors";

interface BrowserState {
  visible: boolean;
  url: string;
  title: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  loadError?: string;
}

function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed) || /^about:/i.test(trimmed)) return trimmed;
  if (/^[\w-]+(\.[\w-]+)+/.test(trimmed)) return `https://${trimmed}`;
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

export function BrowserPanel({ width }: { width: number }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<BrowserState>({
    visible: false,
    url: "about:blank",
    title: "",
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
  });
  const [urlInput, setUrlInput] = useState("");
  const [pickerActive, setPickerActive] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // 空白页 / 状态页 / 加载失败时没有可拾取的元素
  const pickerUnavailable =
    !status.url || status.url === "about:blank" || Boolean(status.loadError);

  // 拾取态以主进程为准：事件可能错过（面板重挂、订阅晚于状态变化），
  // 而“按钮显示关、页面其实还开着”这种各说各话必须能自愈。
  const syncPickerState = useCallback(async () => {
    const state = await window.electronAPI?.browser?.picker?.getState();
    if (state) setPickerActive(state.active);
  }, []);

  useEffect(() => {
    const unsub = window.electronAPI?.browser?.picker?.onStateChanged((state) =>
      setPickerActive(state.active),
    );
    void syncPickerState();
    return unsub;
  }, [syncPickerState]);

  const handleTogglePicker = useCallback(async () => {
    const picker = window.electronAPI?.browser?.picker;
    if (!picker) return;
    if (pickerActive) {
      await picker.stop();
    } else {
      const result = await picker.start();
      // 失败一律静默：不弹 toast、不按 reason 分支提示。
      // 用户启动后立即取消也会走到这里（reason 回落为 not-available），
      // 那是主动取消不是错误，报出来就是假报错。
      if (!result.ok) setPickerActive(false);
    }
    // 以主进程为准收口：不管事件是否到了，按钮都必须反映真实状态
    await syncPickerState();
  }, [pickerActive, syncPickerState]);

  // Sync WebContentsView bounds to match the content area below the header
  const syncBounds = useCallback(() => {
    if (!contentRef.current) return;
    const rect = contentRef.current.getBoundingClientRect();
    window.electronAPI?.browser.setBounds(
      Math.round(rect.x),
      Math.round(rect.y),
      Math.round(rect.width),
      Math.round(rect.height),
    );
  }, []);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    syncBounds();
    const observer = new ResizeObserver(syncBounds);
    observer.observe(el);
    return () => observer.disconnect();
  }, [syncBounds, width]);

  // Re-sync bounds when width changes (sidebar/panel resize)
  useEffect(() => {
    syncBounds();
  }, [width, syncBounds]);

  // show() reattaches WebContentsView as invisible until bounds are applied.
  useEffect(() => {
    if (status.visible) syncBounds();
  }, [status.visible, syncBounds]);

  // Listen for state changes from main process
  useEffect(() => {
    const unsub = window.electronAPI?.browser.onStateChanged((s) => {
      setStatus(s);
      if (s.url && s.url !== "about:blank") {
        setUrlInput(s.url);
      }
    });
    return unsub;
  }, []);

  // Fetch initial status
  useEffect(() => {
    window.electronAPI?.browser.getStatus().then((s) => {
      if (s) {
        setStatus(s);
        if (s.url && s.url !== "about:blank") setUrlInput(s.url);
      }
    });
  }, []);

  // Sync blank-page theme with app theme (theme + actual CSS background colour)
  const themeSetting = useThemeSetting();
  const themePreset = useAppStore((s) => s.settings.themePreset);
  const systemDarkMode = useSystemDarkMode();
  const isDark =
    themeSetting === "system" ? systemDarkMode : themeSetting === "dark";
  useEffect(() => {
    const bgColor = getComputedStyle(document.documentElement)
      .getPropertyValue("--color-background")
      .trim();
    window.electronAPI?.browser.setTheme(
      isDark ? "dark" : "light",
      bgColor || (isDark ? "#18181b" : "#ffffff"),
    );
  }, [isDark, themePreset]);

  const handleNavigate = useCallback(() => {
    const url = normalizeUrl(urlInput);
    if (!url) return;
    window.electronAPI?.browser.navigate(url);
  }, [urlInput]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") handleNavigate();
    },
    [handleNavigate],
  );

  const toggleBrowserPanel = useAppStore((s) => s.toggleBrowserPanel);
  const isBrowserFullscreen = useAppStore((s) => s.isBrowserFullscreen);
  const enterBrowserFullscreen = useAppStore((s) => s.enterBrowserFullscreen);
  const exitBrowserFullscreen = useAppStore((s) => s.exitBrowserFullscreen);

  const handleClose = useCallback(() => {
    if (isBrowserFullscreen) {
      exitBrowserFullscreen();
      window.electronAPI?.browser.exitFullscreen();
    }
    toggleBrowserPanel();
  }, [isBrowserFullscreen, exitBrowserFullscreen, toggleBrowserPanel]);

  const handleToggleFullscreen = useCallback(() => {
    if (isBrowserFullscreen) {
      exitBrowserFullscreen();
      window.electronAPI?.browser.exitFullscreen();
    } else {
      enterBrowserFullscreen();
      window.electronAPI?.browser.enterFullscreen();
    }
  }, [isBrowserFullscreen, enterBrowserFullscreen, exitBrowserFullscreen]);

  // 随状态变化的提示文案，提出来供 Tooltip 的 label 与 aria-label 共用
  const reloadLabel = status.isLoading ? t("chat.stop") : t("browser.reload");
  const fullscreenLabel = isBrowserFullscreen
    ? t("browser.exitFullscreen")
    : t("browser.enterFullscreen");

  return (
    <div
      className="h-full flex flex-col bg-surface/96 border-l border-border"
      style={{ width }}
    >
      {/* Header */}
      <div className="h-10 flex items-center gap-1 px-2 border-b border-border-subtle shrink-0">
        {/* Nav buttons */}
        <Tooltip label={t("browser.back")}>
          <button
            onClick={() => window.electronAPI?.browser.goBack()}
            disabled={!status.canGoBack}
            aria-label={t("browser.back")}
            className="w-7 h-7 flex items-center justify-center rounded-md text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors disabled:opacity-30 disabled:cursor-default"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        </Tooltip>
        <Tooltip label={t("browser.forward")}>
          <button
            onClick={() => window.electronAPI?.browser.goForward()}
            disabled={!status.canGoForward}
            aria-label={t("browser.forward")}
            className="w-7 h-7 flex items-center justify-center rounded-md text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors disabled:opacity-30 disabled:cursor-default"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </Tooltip>
        <Tooltip label={reloadLabel}>
          <button
            onClick={() =>
              status.isLoading
                ? window.electronAPI?.browser.stop()
                : window.electronAPI?.browser.reload()
            }
            aria-label={reloadLabel}
            className="w-7 h-7 flex items-center justify-center rounded-md text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors"
          >
            {status.isLoading ? (
              <X className="w-4 h-4" />
            ) : (
              <RotateCw className="w-4 h-4" />
            )}
          </button>
        </Tooltip>

        {/* URL bar */}
        <div className="flex-1 min-w-0 flex items-center gap-1.5 rounded-lg bg-surface-muted px-2.5 h-7">
          {status.isLoading ? (
            <Loader2 className="w-3 h-3 text-accent animate-spin shrink-0" />
          ) : (
            <Globe className="w-3 h-3 text-text-muted shrink-0" />
          )}
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("browser.placeholder")}
            className="flex-1 min-w-0 bg-transparent text-xs text-text-primary placeholder:text-text-muted outline-none"
            spellCheck={false}
          />
        </div>

        {/* Element picker (Design Mode v1) */}
        <Tooltip
          label={
            pickerActive
              ? t("browser.picker.active")
              : t("browser.picker.toggle")
          }
        >
          <button
            onClick={() => void handleTogglePicker()}
            disabled={pickerUnavailable}
            aria-pressed={pickerActive}
            aria-label={
              pickerActive
                ? t("browser.picker.active")
                : t("browser.picker.toggle")
            }
            className={`w-7 h-7 flex items-center justify-center rounded-md transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
              pickerActive
                ? "bg-accent/15 text-accent"
                : "text-text-secondary hover:text-text-primary hover:bg-surface-hover"
            }`}
          >
            <MousePointerSquareDashed className="w-3.5 h-3.5" />
          </button>
        </Tooltip>

        {/* External open */}
        <Tooltip label={t("browser.openExternal")}>
          <button
            onClick={() => {
              if (!status.url || status.url === "about:blank") return;
              window.electronAPI
                ?.openExternal(status.url)
                ?.catch((err: unknown) => {
                  console.error("[BrowserPanel] openExternal failed:", err);
                });
            }}
            disabled={!status.url || status.url === "about:blank"}
            aria-label={t("browser.openExternal")}
            className="w-7 h-7 flex items-center justify-center rounded-md transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-text-secondary hover:text-text-primary hover:bg-surface-hover"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        </Tooltip>

        {/* Fullscreen toggle */}
        <Tooltip label={fullscreenLabel}>
          <button
            onClick={handleToggleFullscreen}
            disabled={!status.url || status.url === "about:blank"}
            aria-label={fullscreenLabel}
            className="w-7 h-7 flex items-center justify-center rounded-md transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-text-secondary hover:text-text-primary hover:bg-surface-hover"
          >
            {isBrowserFullscreen ? (
              <Minimize2 className="w-3.5 h-3.5" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5" />
            )}
          </button>
        </Tooltip>

        {/* Close */}
        <Tooltip label={t("common.close")}>
          <button
            onClick={handleClose}
            aria-label={t("common.close")}
            className="w-7 h-7 flex items-center justify-center rounded-md text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </Tooltip>
      </div>

      {status.loadError ? (
        <div className="shrink-0 border-b border-border-subtle bg-error/10 px-3 py-1.5 text-xs text-error">
          {t("browser.loadFailed")}
          {": "}
          {status.loadError}
        </div>
      ) : null}

      {/* Content area — WebContentsView overlays this */}
      <div ref={contentRef} className="flex-1 min-h-0 bg-background/50" />
    </div>
  );
}
