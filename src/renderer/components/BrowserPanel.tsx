import { useState, useEffect, useRef, useCallback } from "react";
import {
  X,
  ChevronLeft,
  ChevronRight,
  RotateCw,
  Loader2,
  ExternalLink,
  Globe,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../store";
import { useThemeSetting, useSystemDarkMode } from "../store/selectors";

interface BrowserState {
  visible: boolean;
  url: string;
  title: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
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
  const contentRef = useRef<HTMLDivElement>(null);

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

  const handleClose = useCallback(() => {
    toggleBrowserPanel();
  }, [toggleBrowserPanel]);

  return (
    <div
      className="h-full flex flex-col bg-surface/96 border-l border-border-subtle"
      style={{ width }}
    >
      {/* Header */}
      <div className="h-10 flex items-center gap-1 px-2 border-b border-border-subtle shrink-0">
        {/* Nav buttons */}
        <button
          onClick={() => window.electronAPI?.browser.goBack()}
          disabled={!status.canGoBack}
          className="w-7 h-7 flex items-center justify-center rounded-md text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors disabled:opacity-30 disabled:cursor-default"
          title="Back"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <button
          onClick={() => window.electronAPI?.browser.goForward()}
          disabled={!status.canGoForward}
          className="w-7 h-7 flex items-center justify-center rounded-md text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors disabled:opacity-30 disabled:cursor-default"
          title="Forward"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
        <button
          onClick={() =>
            status.isLoading
              ? window.electronAPI?.browser.stop()
              : window.electronAPI?.browser.reload()
          }
          className="w-7 h-7 flex items-center justify-center rounded-md text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors"
          title={status.isLoading ? t("chat.stop") : t("browser.reload")}
        >
          {status.isLoading ? (
            <X className="w-4 h-4" />
          ) : (
            <RotateCw className="w-4 h-4" />
          )}
        </button>

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

        {/* External open */}
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
          className="w-7 h-7 flex items-center justify-center rounded-md transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-text-secondary hover:text-text-primary hover:bg-surface-hover"
          title={t("browser.openExternal")}
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </button>

        {/* Close */}
        <button
          onClick={handleClose}
          className="w-7 h-7 flex items-center justify-center rounded-md text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors"
          title={t("close")}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Content area — WebContentsView overlays this */}
      <div ref={contentRef} className="flex-1 min-h-0 bg-background/50" />
    </div>
  );
}
