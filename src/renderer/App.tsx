import {
  Suspense,
  lazy,
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
} from "react";
import { useAppStore } from "./store";
import {
  useActiveSessionId,
  useSettings,
  useSystemDarkMode,
  useSettingsState,
  useConfigModalState,
  useGlobalNotice,
  useSandboxSetupState,
  useSandboxSyncStatus,
  usePendingDialogs,
  useScheduleViewState,
  useMarketplaceViewState,
} from "./store/selectors";
import { useIPC } from "./hooks/useIPC";
import { useWindowSize } from "./hooks/useWindowSize";
import { Sidebar } from "./components/Sidebar";
import { ResizeHandle } from "./components/ResizeHandle";
import { WelcomeView } from "./components/WelcomeView";
import { ScheduleView } from "./components/ScheduleView";
import { MarketplaceView } from "./components/MarketplaceView";
import { PermissionDialog } from "./components/PermissionDialog";
import { SudoPasswordDialog } from "./components/SudoPasswordDialog";
import { Titlebar } from "./components/Titlebar";
import { SandboxSetupDialog } from "./components/SandboxSetupDialog";
import { SandboxSyncToast } from "./components/SandboxSyncToast";
import { GlobalNoticeToast } from "./components/GlobalNoticeToast";
import { PanelErrorBoundary } from "./components/PanelErrorBoundary";
import type { AppConfig } from "./types";
import type { GlobalNoticeAction } from "./store";

const ChatView = lazy(() =>
  import("./components/ChatView").then((module) => ({
    default: module.ChatView,
  })),
);
const FileBrowser = lazy(() =>
  import("./components/FileBrowser").then((module) => ({
    default: module.FileBrowser,
  })),
);
const ReviewPanel = lazy(() =>
  import("./components/ReviewPanel").then((module) => ({
    default: module.ReviewPanel,
  })),
);
const BrowserPanel = lazy(() =>
  import("./components/BrowserPanel").then((module) => ({
    default: module.BrowserPanel,
  })),
);
const ArtifactPanel = lazy(() =>
  import("./components/ArtifactPanel").then((module) => ({
    default: module.ArtifactPanel,
  })),
);
const ConfigModal = lazy(() =>
  import("./components/ConfigModal").then((module) => ({
    default: module.ConfigModal,
  })),
);
const SettingsPanel = lazy(() =>
  import("./components/SettingsPanel").then((module) => ({
    default: module.SettingsPanel,
  })),
);

function MainPanelFallback() {
  return (
    <div className="flex-1 min-h-0 bg-background px-6 py-6">
      <div className="h-full rounded-6xl border border-border-subtle bg-background/70" />
    </div>
  );
}

function App() {
  // --- Store state via selectors (each subscription is minimally scoped) ---
  const activeSessionId = useActiveSessionId();
  const settings = useSettings();
  const systemDarkMode = useSystemDarkMode();
  const { showSettings } = useSettingsState();
  const showSchedule = useScheduleViewState();
  const { showMarketplace } = useMarketplaceViewState();
  const { showConfigModal, isConfigured, appConfig } = useConfigModalState();
  const globalNotice = useGlobalNotice();
  const { progress: sandboxSetupProgress, isComplete: isSandboxSetupComplete } =
    useSandboxSetupState();
  const sandboxSyncStatus = useSandboxSyncStatus();
  const { pendingPermission, pendingSudoPassword } = usePendingDialogs();

  // Actions are still pulled directly from the store
  const setShowConfigModal = useAppStore((s) => s.setShowConfigModal);
  const setIsConfigured = useAppStore((s) => s.setIsConfigured);
  const setAppConfig = useAppStore((s) => s.setAppConfig);
  const clearGlobalNotice = useAppStore((s) => s.clearGlobalNotice);
  const setSandboxSetupComplete = useAppStore((s) => s.setSandboxSetupComplete);
  const setShowSettings = useAppStore((s) => s.setShowSettings);
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const rightPanelMode = useAppStore((s) => s.rightPanelMode);
  const isReviewOpen = useAppStore((s) => s.isReviewOpen);
  const isArtifactPanelOpen = useAppStore((s) => s.isArtifactPanelOpen);
  const sidebarWidth = useAppStore((s) => s.sidebarWidth);
  const contextPanelWidth = useAppStore((s) => s.contextPanelWidth);
  const setSidebarWidth = useAppStore((s) => s.setSidebarWidth);
  const setContextPanelWidth = useAppStore((s) => s.setContextPanelWidth);
  const setRightPanelMode = useAppStore((s) => s.setRightPanelMode);
  const isBrowserFullscreen = useAppStore((s) => s.isBrowserFullscreen);
  const exitBrowserFullscreen = useAppStore((s) => s.exitBrowserFullscreen);

  const { listSessions, isElectron } = useIPC();
  useWindowSize();
  const initialized = useRef(false);

  useEffect(() => {
    // Only run once on mount
    if (initialized.current) return;
    initialized.current = true;

    if (isElectron) {
      listSessions();
    }
  }, []); // Empty deps - run once

  // Apply theme to document root (useLayoutEffect ensures paint-before-render,
  // fixing the issue where theme change on Settings page doesn't take effect until navigating away)
  useLayoutEffect(() => {
    const effectiveTheme =
      settings.theme === "system"
        ? systemDarkMode
          ? "dark"
          : "light"
        : settings.theme;

    if (effectiveTheme === "light") {
      document.documentElement.classList.add("light");
    } else {
      document.documentElement.classList.remove("light");
    }

    document.documentElement.setAttribute(
      "data-theme-preset",
      settings.themePreset,
    );
  }, [settings.theme, settings.themePreset, systemDarkMode]);

  // Auto-collapse panels based on window width (disabled per user preference)
  // useEffect(() => {
  //   setContextPanelCollapsed(width < 1100);
  //   setSidebarCollapsed(width < 800);
  // }, [width, setContextPanelCollapsed, setSidebarCollapsed]);

  // Handle config save
  const handleConfigSave = useCallback(
    async (newConfig: Partial<AppConfig>) => {
      if (!isElectron) {
        console.log("[App] Browser mode - config save simulated");
        return;
      }

      const result = await window.electronAPI.config.save(newConfig);
      if (result.success) {
        setIsConfigured(Boolean(result.config?.isConfigured));
        setAppConfig(result.config);
      }
    },
    [setIsConfigured, setAppConfig],
  );

  // Handle config modal close
  const handleConfigClose = useCallback(() => {
    setShowConfigModal(false);
  }, [setShowConfigModal]);

  // Handle sandbox setup complete
  const handleSandboxSetupComplete = useCallback(() => {
    setSandboxSetupComplete(true);
  }, [setSandboxSetupComplete]);

  const handleGlobalNoticeAction = useCallback(
    (action: GlobalNoticeAction) => {
      if (action === "open_api_settings") {
        setShowConfigModal(true);
      }
      clearGlobalNotice();
    },
    [clearGlobalNotice, setShowConfigModal],
  );

  // Track whether user manually dismissed the browser panel to avoid force-reopening
  const browserDismissedRef = useRef(false);

  // Sync browser WebContentsView visibility with panel state.
  // WebContentsView is a native Electron layer — any full-screen React view
  // (settings, marketplace, schedule, review, config modal) must hide it.
  const isFullScreenView =
    showSettings ||
    showMarketplace ||
    showSchedule ||
    isReviewOpen ||
    showConfigModal;

  useEffect(() => {
    if (isFullScreenView) {
      window.electronAPI?.browser.hide();
    } else if (rightPanelMode === "browser") {
      browserDismissedRef.current = false; // reset on explicit open
      window.electronAPI?.browser.show();
    } else {
      window.electronAPI?.browser.hide();
    }
  }, [rightPanelMode, isFullScreenView]);

  // Auto-open browser panel when MCP triggers navigation (browser becomes visible),
  // but only if the user hasn't manually dismissed it.
  useEffect(() => {
    const unsub = window.electronAPI?.browser.onStateChanged((status) => {
      if (
        status.visible &&
        rightPanelMode !== "browser" &&
        !browserDismissedRef.current
      ) {
        setRightPanelMode("browser");
      }
    });
    return unsub;
  }, [rightPanelMode, setRightPanelMode]);

  // When user manually closes the browser panel (any mode transition away from browser),
  // mark it as dismissed so MCP navigations won't force-reopen it.
  const prevRightPanelModeRef = useRef(rightPanelMode);
  useEffect(() => {
    if (
      prevRightPanelModeRef.current === "browser" &&
      rightPanelMode !== "browser"
    ) {
      browserDismissedRef.current = true;
    }
    prevRightPanelModeRef.current = rightPanelMode;
  }, [rightPanelMode]);

  // When user exits system fullscreen via ESC/macOS green button while in
  // browser-fullscreen mode, restore layout to pre-fullscreen state.
  useEffect(() => {
    const unsub = window.electronAPI?.window.onFullScreenChanged(
      (isFullScreen) => {
        if (!isFullScreen && isBrowserFullscreen) {
          exitBrowserFullscreen();
        }
      },
    );
    return unsub;
  }, [isBrowserFullscreen, exitBrowserFullscreen]);

  // Determine if we should show the sandbox setup dialog
  // Show if there's progress and setup is not complete
  const showSandboxSetup = sandboxSetupProgress && !isSandboxSetupComplete;

  return (
    <div className="h-full w-full min-h-0 flex flex-col overflow-hidden bg-background">
      {/* Titlebar - draggable region */}
      <Titlebar />

      {/* Main Content */}
      {isBrowserFullscreen ? (
        <Suspense
          fallback={
            <div className="flex-1 min-h-0 bg-background/60" />
          }
        >
          <div className="flex-1 min-h-0">
            <BrowserPanel width={window.innerWidth} />
          </div>
        </Suspense>
      ) : (
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Sidebar — always visible across all views */}
        <>
          <PanelErrorBoundary name="Sidebar" fallback={<div className="w-0" />}>
            <Sidebar width={sidebarWidth} />
          </PanelErrorBoundary>

          {/* Sidebar resize handle */}
          {!sidebarCollapsed && (
            <ResizeHandle
              onResize={(delta) =>
                setSidebarWidth(
                  Math.max(200, Math.min(400, sidebarWidth + delta)),
                )
              }
              onDoubleClick={() => setSidebarWidth(280)}
            />
          )}
        </>

        {/* Main Content Area */}
        <main className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden bg-background relative">
          {showSettings ? (
            <Suspense fallback={<MainPanelFallback />}>
              <SettingsPanel onClose={() => setShowSettings(false)} />
            </Suspense>
          ) : showMarketplace ? (
            <MarketplaceView />
          ) : showSchedule ? (
            <ScheduleView />
          ) : activeSessionId ? (
            <PanelErrorBoundary
              name="ChatView"
              resetKey={activeSessionId}
              fallback={<MainPanelFallback />}
            >
              <Suspense fallback={<MainPanelFallback />}>
                <ChatView />
              </Suspense>
            </PanelErrorBoundary>
          ) : (
            <WelcomeView />
          )}
          {/* Artifact floating panel */}
          {isArtifactPanelOpen && (
            <Suspense fallback={null}>
              <ArtifactPanel />
            </Suspense>
          )}
        </main>

        {/* Right Panel: File Browser or Browser */}
        <div
          className={`overflow-hidden flex-shrink-0 transition-[width] duration-300 ease-in-out ${!isFullScreenView && rightPanelMode !== null ? '' : 'w-0'}`}
          style={{ width: !isFullScreenView && rightPanelMode !== null ? `${contextPanelWidth}px` : 0 }}
        >
          {!isFullScreenView && rightPanelMode !== null && (
            <>
              <ResizeHandle
                onResize={(delta) =>
                  setContextPanelWidth(
                    Math.max(
                      rightPanelMode === "browser" ? 350 : 280,
                      rightPanelMode === "browser"
                        ? contextPanelWidth - delta
                        : Math.min(480, contextPanelWidth - delta),
                    ),
                  )
                }
                onDoubleClick={() => setContextPanelWidth(340)}
                position="left"
                className="hover:bg-border-active w-1 cursor-col-resize transition-colors"
              />
              {rightPanelMode === "browser" ? (
                <PanelErrorBoundary
                  name="BrowserPanel"
                  fallback={
                    <div className="flex-1 border-l border-border-subtle bg-background/60" />
                  }
                >
                  <Suspense
                    fallback={
                      <div className="flex-1 border-l border-border-subtle bg-background/60" />
                    }
                  >
                    <BrowserPanel width={contextPanelWidth} />
                  </Suspense>
                </PanelErrorBoundary>
              ) : (
                <PanelErrorBoundary
                  name="FileBrowser"
                  fallback={
                    <div className="flex-1 border-l border-border-subtle bg-background/60" />
                  }
                >
                  <Suspense
                    fallback={
                      <div className="flex-1 border-l border-border-subtle bg-background/60" />
                    }
                  >
                    <FileBrowser width={contextPanelWidth} />
                  </Suspense>
                </PanelErrorBoundary>
              )}
            </>
          )}
        </div>
      </div>
      )}

      {/* Permission Dialog */}
      {pendingPermission && <PermissionDialog permission={pendingPermission} />}

      {/* Sudo Password Dialog */}
      {pendingSudoPassword && (
        <SudoPasswordDialog request={pendingSudoPassword} />
      )}

      {/* Config Modal */}
      <PanelErrorBoundary name="ConfigModal" fallback={null}>
        <Suspense fallback={null}>
          <ConfigModal
            isOpen={showConfigModal}
            onClose={handleConfigClose}
            onSave={handleConfigSave}
            initialConfig={appConfig}
            isFirstRun={!isConfigured}
          />
        </Suspense>
      </PanelErrorBoundary>

      {/* Review Modal */}
      {isReviewOpen && (
        <Suspense fallback={null}>
          <ReviewPanel />
        </Suspense>
      )}

      {/* Sandbox Setup Dialog */}
      {showSandboxSetup && (
        <SandboxSetupDialog
          progress={sandboxSetupProgress}
          onComplete={handleSandboxSetupComplete}
        />
      )}

      {/* Sandbox Sync Toast */}
      <SandboxSyncToast status={sandboxSyncStatus} />

      <GlobalNoticeToast
        notice={globalNotice}
        onDismiss={clearGlobalNotice}
        onAction={handleGlobalNoticeAction}
      />
    </div>
  );
}

export default App;
