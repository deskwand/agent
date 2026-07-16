import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../store";
import { DESKWAND_API_URL } from "../../shared/oauth-config";
import { useIPC } from "../hooks/useIPC";
import { useBrowserOcclusion } from "../hooks/useBrowserOcclusion";
import {
  Trash2,
  Settings,
  Search as SearchIcon,
  Check,
  Folder,
  Archive,
  ChevronDown,
  SquarePen,
  Download,
} from "lucide-react";
import { AccountMenu } from "./AccountMenu";
import { LoginModal } from "./LoginModal";
import { ConfirmDialog } from "./ConfirmDialog";
import { UpdateConfirmDialog } from "./UpdateConfirmDialog";
import { CloudApiClient } from "../services/cloud-api";
import type { Session } from "../types";
import { DEFAULT_WORKDIR_DIRNAME } from "../../shared/workspace-path";
import { buildSidebarSessionGroups } from "../utils/sidebar-session-groups";

export function Sidebar({ width = 280 }: { width?: number }) {
  const { t, i18n } = useTranslation();
  const sessions = useAppStore((s) => s.sessions);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const sessionStates = useAppStore((s) => s.sessionStates);
  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const setMessages = useAppStore((s) => s.setMessages);
  const setTraceSteps = useAppStore((s) => s.setTraceSteps);
  const workingDir = useAppStore((s) => s.workingDir);
  const setWorkingDir = useAppStore((s) => s.setWorkingDir);
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const setShowSettings = useAppStore((s) => s.setShowSettings);
  const setShowSchedule = useAppStore((s) => s.setShowSchedule);
  const showMarketplace = useAppStore((s) => s.showMarketplace);
  const setShowMarketplace = useAppStore((s) => s.setShowMarketplace);
  const cloudConfig = useAppStore((s) => s.cloudConfig);
  const showLoginModal = useAppStore((s) => s.showLoginModal);
  const setShowLoginModal = useAppStore((s) => s.setShowLoginModal);
  const setCloudConfig = useAppStore((s) => s.setCloudConfig);
  const setGlobalNotice = useAppStore((s) => s.setGlobalNotice);

  const updateReady = useAppStore((s) => s.updateReady);
  const updateVersion = useAppStore((s) => s.updateVersion);

  const {
    invoke,
    deleteSession,
    archiveSession,
    getSessionMessages,
    getSessionTraceSteps,
    changeWorkingDir,
    createProject,
    isElectron,
  } = useIPC();

  const [searchQuery, setSearchQuery] = useState("");
  const [showProjectActions, setShowProjectActions] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [confirmLogoutOpen, setConfirmLogoutOpen] = useState(false);
  const [cloudRestoring, setCloudRestoring] = useState(false);
  const [pendingArchiveId, setPendingArchiveId] = useState<string | null>(null);
  const [showUpdateDialog, setShowUpdateDialog] = useState(false);
  const [currentAppVersion, setCurrentAppVersion] = useState("");

  useEffect(() => {
    if (!showProjectActions) return;
    const handler = () => setShowProjectActions(false);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [showProjectActions]);

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

  // 启动时恢复云端登录状态
  useEffect(() => {
    try {
      const raw = localStorage.getItem("deskwand.cloud");
      if (!raw) return;
      const c = JSON.parse(raw);
      if (!c?.token) return;
      setCloudRestoring(true);
      (async () => {
        try {
          const me = await new CloudApiClient(c.token).getMe();
          let modes: Array<{ id: string; name: string; model: string }> = [];
          try {
            const res = await new CloudApiClient(c.token).getModes();
            modes = res;
          } catch {
            /* modes optional, keep empty */
          }
          setCloudConfig({
            serverUrl: DESKWAND_API_URL,
            token: c.token,
            isLoggedIn: true,
            email: me.email,
            level: me.level,
            creditsBalance: me.credits_balance,
            modes,
          });
        } catch (e: any) {
          if (e?.status === 401) {
            localStorage.removeItem("deskwand.cloud");
          }
          // 网络错误时保留 localStorage，下次启动再试
        } finally {
          setCloudRestoring(false);
        }
      })();
    } catch {
      /* ignore */
    }
  }, []);

  const [hoveredTimeSessionId, setHoveredTimeSessionId] = useState<
    string | null
  >(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{
    message: string;
    onConfirm: () => void;
  } | null>(null);
  const [createProjectModalOpen, setCreateProjectModalOpen] = useState(false);
  useBrowserOcclusion(Boolean(deleteConfirm) || createProjectModalOpen);
  const [projectName, setProjectName] = useState("");
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const sessionLoadSeqRef = useRef(0);

  const normalizedQuery = useMemo(
    () => searchQuery.trim().toLowerCase(),
    [searchQuery],
  );
  // Exclude archived sessions from normal display
  const activeSessions = useMemo(
    () => sessions.filter((s) => !s.archived),
    [sessions],
  );
  const sessionGroups = useMemo(
    () => buildSidebarSessionGroups(sessions, normalizedQuery),
    [sessions, normalizedQuery],
  );
  // Unique project names with their cwds for the ▾ menu
  const projectEntries = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of activeSessions) {
      if (!s.isProjectMode || !s.cwd || isDefaultWorkspacePath(s.cwd)) continue;
      const name = getWorkspaceName(s.cwd);
      if (!map.has(name)) map.set(name, s.cwd);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, cwd]) => ({ name, cwd }));
  }, [activeSessions]);

  const handleSessionClick = useCallback(
    async (sessionId: string) => {
      setShowSettings(false);
      setShowSchedule(false);
      setShowMarketplace(false);
      if (activeSessionId === sessionId) return;

      const existingMessages = sessionStates[sessionId]?.messages;
      const existingSteps = sessionStates[sessionId]?.traceSteps;
      const needsMessages =
        isElectron && (!existingMessages || existingMessages.length === 0);
      const needsTraceSteps =
        isElectron && (!existingSteps || existingSteps.length === 0);

      if (!needsMessages && !needsTraceSteps) {
        setActiveSession(sessionId);
        return;
      }

      const loadSeq = sessionLoadSeqRef.current + 1;
      sessionLoadSeqRef.current = loadSeq;
      console.log("[Sidebar] Session switch start", {
        sessionId,
        needsMessages,
        needsTraceSteps,
      });

      try {
        let loadedMessages = existingMessages ?? [];
        let loadedSteps = existingSteps ?? [];

        if (needsMessages) {
          loadedMessages = (await getSessionMessages(sessionId)) || [];
          if (sessionLoadSeqRef.current !== loadSeq) return;
          setMessages(sessionId, loadedMessages);
        }

        if (needsTraceSteps) {
          loadedSteps = (await getSessionTraceSteps(sessionId)) || [];
          if (sessionLoadSeqRef.current !== loadSeq) return;
          setTraceSteps(sessionId, loadedSteps);
        }

        if (sessionLoadSeqRef.current !== loadSeq) return;
        setActiveSession(sessionId);
        console.log("[Sidebar] Session switch ready", {
          sessionId,
          messageCount: loadedMessages.length,
          traceStepCount: loadedSteps.length,
        });
      } catch (error) {
        if (sessionLoadSeqRef.current !== loadSeq) return;
        console.error("[Sidebar] Failed to load session before switch:", {
          sessionId,
          error,
        });
      }
    },
    [
      activeSessionId,
      getSessionMessages,
      getSessionTraceSteps,
      isElectron,
      sessionStates,
      setActiveSession,
      setMessages,
      setShowSettings,
      setTraceSteps,
    ],
  );

  const handleNewSession = useCallback(() => {
    setActiveSession(null);
    setShowSettings(false);
    setShowSchedule(false);
    setShowMarketplace(false);
  }, [setActiveSession, setShowSettings, setShowSchedule, setShowMarketplace]);

  const handleDeleteSession = useCallback(
    (e: React.MouseEvent, session: Session) => {
      e.stopPropagation();
      const confirmKey = session.isProjectMode
        ? "sidebar.deleteProjectConfirm"
        : "sidebar.deleteConversationConfirm";
      setDeleteConfirm({
        message: t(confirmKey, { title: session.title }),
        onConfirm: () => {
          deleteSession(session.id);
          setDeleteConfirm(null);
        },
      });
    },
    [deleteSession, t],
  );

  const handleSelectProjectDir = useCallback(
    async (currentPath?: string) => {
      const result = await changeWorkingDir(
        undefined,
        currentPath || workingDir || undefined,
      );
      if (!result?.success) return;
      setWorkingDir(result.path);
      handleNewSession();
    },
    [changeWorkingDir, handleNewSession, setWorkingDir, workingDir],
  );

  const handleOpenProject = useCallback(async () => {
    setShowProjectActions(false);
    await handleSelectProjectDir();
  }, [handleSelectProjectDir]);

  const handleNewProject = useCallback(() => {
    setShowProjectActions(false);
    setProjectName("");
    setCreateProjectModalOpen(true);
  }, []);

  const handleCreateProject = useCallback(async () => {
    const trimmedName = projectName.trim();
    if (!trimmedName) {
      setGlobalNotice({
        id: `notice-project-name-required-${Date.now()}`,
        type: "error",
        message: t("sidebar.projectNameRequired"),
      });
      return;
    }

    if (/[\\/:*?"<>|]/.test(trimmedName)) {
      setGlobalNotice({
        id: `notice-project-name-invalid-${Date.now()}`,
        type: "error",
        message: t("sidebar.projectNameInvalid"),
      });
      return;
    }

    setIsCreatingProject(true);
    try {
      const result = await createProject(trimmedName);
      if (!result.success) {
        setGlobalNotice({
          id: `notice-project-create-failed-${Date.now()}`,
          type: "error",
          message: result.error || t("sidebar.createProjectFailed"),
        });
        return;
      }

      if (isElectron) {
        await invoke<{ success: boolean; path: string; error?: string }>({
          type: "workdir.set",
          payload: { path: result.path },
        });
      }
      setCreateProjectModalOpen(false);
      setProjectName("");
      handleNewSession();
    } finally {
      setIsCreatingProject(false);
    }
  }, [
    createProject,
    handleNewSession,
    invoke,
    isElectron,
    projectName,
    setGlobalNotice,
    t,
  ]);

  const handleNewSessionInProject = useCallback(
    async (cwd: string) => {
      const showFailureNotice = () => {
        setGlobalNotice({
          id: `notice-project-session-create-failed-${Date.now()}`,
          type: "error",
          message: t("sidebar.newSessionForProjectFailed"),
        });
      };

      try {
        let nextPath = cwd;
        if (isElectron) {
          const result = await invoke<{
            success: boolean;
            path: string;
            error?: string;
          }>({
            type: "workdir.set",
            payload: { path: cwd },
          });
          if (!result.success) {
            showFailureNotice();
            return;
          }
          nextPath = result.path;
        }
        setWorkingDir(nextPath);
        handleNewSession();
      } catch {
        showFailureNotice();
      }
    },
    [handleNewSession, invoke, isElectron, setGlobalNotice, setWorkingDir, t],
  );

  const highlightTitle = (title: string, query: string) => {
    if (!query) return title;
    const idx = title.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return title;
    return (
      <>
        {title.slice(0, idx)}
        <mark className="bg-accent/40 text-accent-foreground rounded-sm px-0.5">
          {title.slice(idx, idx + query.length)}
        </mark>
        {title.slice(idx + query.length)}
      </>
    );
  };

  const renderSessionItem = (session: Session, showRelativeTime: boolean) => {
    const isActive = activeSessionId === session.id && !showMarketplace;
    const hasStatusIndicator = session.status === "running";

    return (
      <div
        key={session.id}
        onClick={() => void handleSessionClick(session.id)}
        className={`group relative cursor-pointer rounded-lg px-2.5 py-1.5 transition-colors border-l-[3px] border-l-transparent ${
          isActive
            ? "bg-surface-active border-l-accent"
            : "hover:bg-surface-hover/60"
        }`}
      >
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1 flex items-center gap-2">
            <div
              className={`text-sm font-medium leading-5 truncate flex-1 ${isActive ? "text-text-primary" : "text-text-secondary"}`}
            >
              {highlightTitle(session.title, normalizedQuery)}
            </div>
            {showRelativeTime && (
              <div
                className="ml-auto min-w-[3.5rem] h-6 flex-shrink-0 relative"
                onMouseEnter={() => setHoveredTimeSessionId(session.id)}
                onMouseLeave={() => {
                  setHoveredTimeSessionId((prev) =>
                    prev === session.id ? null : prev,
                  );
                  setPendingArchiveId((prev) =>
                    prev === session.id ? null : prev,
                  );
                }}
              >
                {hasStatusIndicator && (
                  <span
                    className="absolute right-0 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center"
                    role="status"
                    aria-label={t("sidebar.running")}
                  >
                    <span className="w-2.5 h-2.5 rounded-full bg-accent animate-pulse" />
                  </span>
                )}

                <span
                  className={`absolute inset-0 flex items-center justify-end text-sm leading-5 text-text-muted text-right whitespace-nowrap transition-opacity ${
                    hasStatusIndicator || hoveredTimeSessionId === session.id
                      ? "opacity-0 pointer-events-none"
                      : "opacity-100"
                  }`}
                >
                  {formatRelativeTime(
                    session.updatedAt || session.createdAt,
                    t,
                    i18n.language,
                  )}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (pendingArchiveId === session.id) {
                      archiveSession(session.id);
                      setPendingArchiveId(null);
                    } else {
                      setPendingArchiveId(session.id);
                    }
                  }}
                  className={`absolute right-6 top-0 w-6 h-6 rounded-lg flex items-center justify-center transition-[opacity,color,background-color] ${
                    pendingArchiveId === session.id && !hasStatusIndicator
                      ? "text-accent bg-accent-muted/20 border border-accent/30"
                      : "text-text-muted hover:text-accent hover:bg-surface-active"
                  } ${
                    (pendingArchiveId === session.id ||
                      hoveredTimeSessionId === session.id) &&
                    !hasStatusIndicator
                      ? "opacity-100 pointer-events-auto"
                      : "opacity-0 pointer-events-none"
                  }`}
                  title={
                    pendingArchiveId === session.id
                      ? t("common.confirm")
                      : t("sidebar.archive")
                  }
                >
                  {pendingArchiveId === session.id ? (
                    <Check className="w-3 h-3" />
                  ) : (
                    <Archive className="w-3 h-3" />
                  )}
                </button>
                <button
                  onClick={(e) => handleDeleteSession(e, session)}
                  className={`absolute right-0 top-0 w-6 h-6 rounded-lg flex items-center justify-center text-text-muted hover:text-error hover:bg-surface-active transition-[opacity,color,background-color] ${
                    hasStatusIndicator || hoveredTimeSessionId !== session.id
                      ? "opacity-0 pointer-events-none"
                      : "opacity-100 pointer-events-auto"
                  }`}
                  title={t("common.delete")}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      <aside
        className={`group bg-background-secondary shadow-[inset_-6px_0_8px_-6px_var(--shadow-sidebar-sep)] flex flex-col overflow-hidden flex-shrink-0 transition-[width] duration-300 ease-in-out ${sidebarCollapsed ? "w-0" : ""}`}
        style={{ width: sidebarCollapsed ? 0 : `${width}px` }}
      >
        {!sidebarCollapsed && (
          <>
            <div className="px-4 pt-3 pb-2">
              <div className="flex items-center gap-2">
                <div className="relative flex-1 min-w-0">
                  <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={t("sidebar.searchPlaceholder")}
                    className="w-full rounded-xl border border-transparent bg-surface-muted pl-9 pr-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border focus:bg-background transition-colors"
                  />
                </div>
                <div className="relative flex flex-shrink-0">
                  <button
                    onClick={() => {
                      setWorkingDir(null);
                      handleNewSession();
                    }}
                    className="h-8 w-8 rounded-l-xl text-text-secondary hover:bg-accent/10 hover:text-accent transition-colors flex items-center justify-center"
                    title={t("sidebar.newChat")}
                  >
                    <SquarePen className="w-4 h-4" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowProjectActions((prev) => !prev);
                    }}
                    className="w-5 h-8 rounded-r-xl text-text-secondary hover:bg-accent/10 hover:text-accent transition-colors flex items-center justify-center"
                  >
                    <ChevronDown className="w-3 h-3" />
                  </button>
                  {showProjectActions && (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className="absolute right-0 top-full mt-1 z-20 w-44 rounded-lg border border-border-muted bg-background shadow-lg p-1"
                    >
                      {projectEntries.length > 0 && (
                        <>
                          <div className="px-2.5 py-1.5 text-[10px] text-text-muted uppercase tracking-wide">
                            {t("sidebar.newSessionInProject")}
                          </div>
                          {projectEntries.map(({ name, cwd }) => (
                            <button
                              key={cwd}
                              onClick={() => {
                                setShowProjectActions(false);
                                void handleNewSessionInProject(cwd);
                              }}
                              className="w-full text-left rounded-md px-2.5 py-2 text-sm text-text-primary hover:bg-surface-hover transition-colors flex items-center gap-2"
                            >
                              <Folder className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
                              <span className="truncate">{name}</span>
                            </button>
                          ))}
                          <div className="mx-1 my-1 border-t border-border-muted" />
                        </>
                      )}
                      <button
                        onClick={() => void handleNewProject()}
                        className="w-full text-left rounded-md px-2.5 py-2 text-sm text-text-primary hover:bg-surface-hover transition-colors"
                      >
                        {t("sidebar.newProject")}
                      </button>
                      <button
                        onClick={() => void handleOpenProject()}
                        className="w-full text-left rounded-md px-2.5 py-2 text-sm text-text-primary hover:bg-surface-hover transition-colors"
                      >
                        {t("sidebar.openProject")}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-3 py-4 sidebar-scroll">
              <div className="space-y-0.5">
                <div className="px-3 pb-1.5 flex items-center justify-between">
                  <span className="text-sm font-medium leading-5 text-text-muted">
                    {t("sidebar.allSessions")}
                  </span>
                </div>

                {sessionGroups.unscopedSessions.map((session) =>
                  renderSessionItem(session, true),
                )}

                {sessionGroups.projectGroups.map((group) => (
                  <section key={group.cwd} className="pt-3">
                    <div
                      className="px-3 pb-1.5 flex items-center justify-between"
                      title={group.cwd}
                    >
                      <span className="min-w-0 truncate text-sm font-medium leading-5 text-text-muted">
                        {group.name}
                      </span>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleNewSessionInProject(group.cwd);
                        }}
                        className="h-6 w-6 flex-shrink-0 rounded-lg text-text-muted hover:bg-accent/10 hover:text-accent transition-colors flex items-center justify-center"
                        title={t("sidebar.newSessionForProject")}
                        aria-label={t("sidebar.newSessionForProject")}
                      >
                        <SquarePen className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="space-y-0.5">
                      {group.sessions.map((session) =>
                        renderSessionItem(session, true),
                      )}
                    </div>
                  </section>
                ))}

                {sessionGroups.unscopedSessions.length === 0 &&
                  sessionGroups.projectGroups.length === 0 && (
                    <div className="px-3 py-6 text-center">
                      <p className="text-sm text-text-muted">
                        {t("sidebar.emptyTitle")}
                      </p>
                      {activeSessions.length === 0 && (
                        <p className="text-xs text-text-muted mt-1">
                          {t("sidebar.emptyHint")}
                        </p>
                      )}
                    </div>
                  )}
              </div>
            </div>

            <div className="px-3 py-3 relative">
              <div className="flex items-center gap-2 rounded-2xl bg-background/50 px-3 py-2.5">
                <button
                  onClick={() => setAccountMenuOpen((v) => !v)}
                  className="flex-1 min-w-0 flex items-center gap-2 text-left text-text-secondary hover:text-text-primary transition-colors"
                >
                  <Settings className="w-4 h-4 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-text-primary">
                      {t("sidebar.settings")}
                    </div>
                  </div>
                </button>
                {updateReady && updateVersion && (
                  <button
                    onClick={() => setShowUpdateDialog(true)}
                    className="flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg bg-accent/15 hover:bg-accent/25 text-accent text-xs font-semibold transition-colors"
                  >
                    <Download className="w-3 h-3" />
                    <span>v{updateVersion}</span>
                  </button>
                )}
              </div>
              <AccountMenu
                isOpen={accountMenuOpen}
                cloudConfig={cloudConfig}
                cloudRestoring={cloudRestoring}
                onOpenLogin={() => setShowLoginModal(true)}
                onOpenSettings={() => {
                  setShowMarketplace(false);
                  setShowSchedule(false);
                  setShowSettings(true);
                }}
                onOpenMarketplace={() => {
                  setShowSettings(false);
                  setShowSchedule(false);
                  setShowMarketplace(true);
                }}
                onOpenAutomation={() => {
                  setShowSettings(false);
                  setShowMarketplace(false);
                  setShowSchedule(true);
                }}
                onLogout={() => {
                  setAccountMenuOpen(false);
                  setConfirmLogoutOpen(true);
                }}
                onClose={() => setAccountMenuOpen(false)}
              />
            </div>

            {deleteConfirm && (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center modal-overlay px-4"
                onClick={() => setDeleteConfirm(null)}
              >
                <div
                  className="w-full max-w-sm rounded-2xl border border-border-muted bg-background shadow-xl"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="px-5 py-4">
                    <p className="text-sm leading-6 text-text-primary">
                      {deleteConfirm.message}
                    </p>
                  </div>
                  <div className="flex items-center justify-end gap-2 border-t border-border-muted px-4 py-3">
                    <button
                      onClick={() => setDeleteConfirm(null)}
                      className="rounded-xl px-4 py-2 text-sm font-medium text-text-secondary hover:bg-surface-hover transition-colors"
                    >
                      {t("sidebar.cancel")}
                    </button>
                    <button
                      onClick={deleteConfirm.onConfirm}
                      className="rounded-xl bg-error px-4 py-2 text-sm font-medium text-white hover:bg-error/90 transition-colors"
                    >
                      {t("sidebar.confirmDelete")}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {createProjectModalOpen && (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center modal-overlay px-4"
                onClick={() => {
                  if (isCreatingProject) return;
                  setCreateProjectModalOpen(false);
                }}
              >
                <div
                  className="w-full max-w-sm rounded-2xl border border-border-muted bg-background shadow-xl"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="px-5 py-4 space-y-3">
                    <div>
                      <h3 className="text-sm font-medium text-text-primary">
                        {t("sidebar.createProjectTitle")}
                      </h3>
                    </div>
                    <input
                      autoFocus
                      type="text"
                      value={projectName}
                      onChange={(e) => setProjectName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !isCreatingProject) {
                          void handleCreateProject();
                        }
                      }}
                      placeholder={t("sidebar.projectNamePlaceholder")}
                      className="w-full rounded-xl border border-border-muted bg-background px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border"
                    />
                  </div>
                  <div className="flex items-center justify-end gap-2 border-t border-border-muted px-4 py-3">
                    <button
                      onClick={() => setCreateProjectModalOpen(false)}
                      disabled={isCreatingProject}
                      className="rounded-xl px-4 py-2 text-sm font-medium text-text-secondary hover:bg-surface-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {t("sidebar.cancel")}
                    </button>
                    <button
                      onClick={() => void handleCreateProject()}
                      disabled={isCreatingProject}
                      className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:bg-accent/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {isCreatingProject
                        ? t("common.loading")
                        : t("sidebar.newProject")}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </aside>
      <LoginModal
        isOpen={showLoginModal}
        onClose={() => setShowLoginModal(false)}
        onLoginSuccess={(config) => setCloudConfig(config)}
      />
      <ConfirmDialog
        isOpen={confirmLogoutOpen}
        title={t("auth.logoutConfirm")}
        confirmLabel={t("auth.logoutConfirmBtn")}
        onConfirm={async () => {
          setConfirmLogoutOpen(false);
          if (cloudConfig?.token) {
            try {
              await new CloudApiClient(cloudConfig.token).logout();
            } catch {
              /* ignore */
            }
            setCloudConfig(null);
          } else {
            setCloudConfig(null);
          }
        }}
        onCancel={() => setConfirmLogoutOpen(false)}
      />
      <UpdateConfirmDialog
        isOpen={showUpdateDialog}
        currentVersion={currentAppVersion}
        newVersion={updateVersion}
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
    </>
  );
}

function getWorkspaceName(cwd: string): string {
  const trimmed = cwd.trim();
  if (!trimmed) return cwd;
  const normalized = trimmed.replace(/[\\/]+$/, "");
  const segments = normalized.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] || cwd;
}

function normalizeWorkspacePath(cwd: string | null | undefined): string {
  if (!cwd) return "";
  return cwd.trim().replace(/[\\/]+$/, "");
}

function isDefaultWorkspacePath(cwd: string): boolean {
  const normalized = normalizeWorkspacePath(cwd);
  if (!normalized) return false;
  return normalized.endsWith(DEFAULT_WORKDIR_DIRNAME);
}

function formatRelativeTime(
  timestamp: number,
  t: (key: string, options?: Record<string, unknown>) => string,
  language: string,
): string {
  const elapsedMs = Math.max(0, Date.now() - timestamp);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;

  if (elapsedMs < hour) {
    const count = Math.max(1, Math.floor(elapsedMs / minute));
    return t("sidebar.relativeTime.minute", { count, lng: language });
  }
  if (elapsedMs < day) {
    const count = Math.max(1, Math.floor(elapsedMs / hour));
    return t("sidebar.relativeTime.hour", { count, lng: language });
  }
  if (elapsedMs < week) {
    const count = Math.max(1, Math.floor(elapsedMs / day));
    return t("sidebar.relativeTime.day", { count, lng: language });
  }

  const count = Math.max(1, Math.floor(elapsedMs / week));
  return t("sidebar.relativeTime.week", { count, lng: language });
}
