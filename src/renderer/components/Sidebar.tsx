import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../store";
import { DESKWAND_API_URL } from "../../shared/oauth-config";
import { useIPC } from "../hooks/useIPC";
import {
  Trash2,
  Settings,
  Search as SearchIcon,
  Check,
  Folder,
  Archive,
  ChevronDown,
  SquarePen,
} from "lucide-react";
import { AccountMenu } from "./AccountMenu";
import { LoginModal } from "./LoginModal";
import { ConfirmDialog } from "./ConfirmDialog";
import { CloudApiClient } from "../services/cloud-api";
import type { Session } from "../types";
import { DEFAULT_WORKDIR_DIRNAME } from "../../shared/workspace-path";

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
  const taskSlots = useAppStore((s) => s.taskSlots);
  const removeTaskSlot = useAppStore((s) => s.removeTaskSlot);
  const setTaskSlots = useAppStore((s) => s.setTaskSlots);

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
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const [projectExpandedMap, setProjectExpandedMap] = useState<
    Record<string, boolean>
  >({});
  const [showProjectActions, setShowProjectActions] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [confirmLogoutOpen, setConfirmLogoutOpen] = useState(false);
  const [cloudRestoring, setCloudRestoring] = useState(false);
  const [pendingArchiveId, setPendingArchiveId] = useState<string | null>(null);

  useEffect(() => {
    if (!showProjectActions) return;
    const handler = () => setShowProjectActions(false);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [showProjectActions]);

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
          } catch { /* modes optional, keep empty */ }
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
    } catch { /* ignore */ }
  }, []);

  const [hoveredTimeSessionId, setHoveredTimeSessionId] = useState<
    string | null
  >(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{
    message: string;
    onConfirm: () => void;
  } | null>(null);
  const [createProjectModalOpen, setCreateProjectModalOpen] = useState(false);
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

  useEffect(() => {
    if (!normalizedQuery) {
      setProjectFilter(null);
    }
  }, [normalizedQuery]);

  // Sync taskSlots with session running/completed status.
  // Guard: only trigger on sessions change; taskSlots updates from this effect
  // should not cause re-entry that clears slots before runningIds are checked.
  const prevSessionsRef = useRef(sessions);
  useEffect(() => {
    const sessionsChanged = prevSessionsRef.current !== sessions;
    prevSessionsRef.current = sessions;

    const runningIds = new Set(
      sessions.filter((s) => s.status === "running").map((s) => s.id),
    );
    const allIds = new Set(sessions.filter((s) => !s.archived).map((s) => s.id));
    const currentSlotMap = new Map(taskSlots.map((s) => [s.sessionId, s.completed]));

    let slots = [...taskSlots];
    let changed = false;

    // Remove slots for archived/deleted sessions (only when sessions actually changed
    // and sessions are loaded — guard against empty sessions on initial mount)
    if (sessionsChanged && allIds.size > 0) {
      const filtered = slots.filter((s) => allIds.has(s.sessionId));
      if (filtered.length !== slots.length) {
        slots = filtered;
        changed = true;
      }
    }

    // Add newly running sessions (only when sessions changed and there are runners)
    if (sessionsChanged && runningIds.size > 0) {
      for (const id of runningIds) {
        if (!currentSlotMap.has(id)) {
          slots = [{ sessionId: id, completed: false }, ...slots];
          changed = true;
        }
      }
    }

    // Transition completed ↔ running (only when sessions changed)
    if (sessionsChanged) {
      slots = slots.map((slot) => {
        const running = runningIds.has(slot.sessionId);
        if (running && slot.completed) {
          changed = true;
          return { ...slot, completed: false };
        }
        if (!running && !slot.completed) {
          changed = true;
          return { ...slot, completed: true };
        }
        return slot;
      });
    }

    if (changed) {
      setTaskSlots(slots);
    }
  }, [sessions, taskSlots, setTaskSlots]);

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
      if (isElectron) {
        await invoke<{ success: boolean; path: string; error?: string }>({
          type: "workdir.set",
          payload: { path: cwd },
        });
      }
      handleNewSession();
    },
    [handleNewSession, invoke, isElectron],
  );

  const renderSessionItem = (
    session: Session,
    showRelativeTime: boolean,
  ) => {
    const isActive = activeSessionId === session.id && !showMarketplace;

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
          {session.status === "running" && (
            <span
              className="w-2.5 h-2.5 rounded-full bg-accent eff-thinking eff-thinking--active flex-shrink-0"
              role="status"
              aria-label={t("sidebar.running")}
            />
          )}

          <div className="min-w-0 flex-1 flex items-center gap-2">
            <div className={`text-sm font-medium leading-5 truncate flex-1 ${isActive ? 'text-text-primary' : 'text-text-secondary'}`}>
              {session.title}
            </div>
            {session.isProjectMode &&
              session.cwd &&
              !isDefaultWorkspacePath(session.cwd) && (
                <span
                  className="text-[10px] bg-surface-muted text-text-muted px-1.5 py-0.5 rounded flex-shrink-0 truncate max-w-[80px]"
                  title={getWorkspaceName(session.cwd)}
                >
                  {getWorkspaceName(session.cwd)}
                </span>
              )}

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
                <span
                  className={`absolute inset-0 flex items-center justify-end text-sm leading-5 text-text-muted text-right whitespace-nowrap transition-opacity ${
                    hoveredTimeSessionId === session.id
                      ? "opacity-0"
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
                    pendingArchiveId === session.id
                      ? "text-accent bg-accent-muted/20 border border-accent/30 opacity-100 pointer-events-auto"
                      : "text-text-muted hover:text-accent hover:bg-surface-active"
                  } ${
                    hoveredTimeSessionId === session.id
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
                    hoveredTimeSessionId === session.id
                      ? "opacity-100 pointer-events-auto"
                      : "opacity-0 pointer-events-none"
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
      className={`group bg-surface/96 flex flex-col overflow-hidden flex-shrink-0 transition-[width] duration-300 ease-in-out ${sidebarCollapsed ? 'w-0' : ''}`}
      style={{ width: sidebarCollapsed ? 0 : `${width}px` }}
    >
      {!sidebarCollapsed && (<>
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
              className="h-8 w-8 rounded-l-xl bg-surface-muted text-text-secondary hover:bg-accent/10 hover:text-accent transition-colors flex items-center justify-center"
              title={t("sidebar.newChat")}
            >
              <SquarePen className="w-4 h-4" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowProjectActions((prev) => !prev);
              }}
              className="w-5 h-8 rounded-r-xl bg-surface-muted text-text-secondary hover:bg-accent/10 hover:text-accent transition-colors border-l border-surface-hover flex items-center justify-center"
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

      {/* Search-driven Chip filter */}
      {normalizedQuery &&
        (() => {
          const matchedProjects = getMatchedProjectNames(
            activeSessions,
            normalizedQuery,
          );
          if (matchedProjects.size === 0) return null;
          return (
            <div className="px-4 pt-2">
              <div className="text-[10px] text-text-muted mb-1 ml-0.5">
                {t("sidebar.filterByProject")}
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {Array.from(matchedProjects).map((name) => {
                  const isActive = projectFilter === name;
                  return (
                    <button
                      key={name}
                      onClick={() =>
                        setProjectFilter(isActive ? null : name)
                      }
                      className={`px-2 py-0.5 rounded-full text-[10px] transition-colors ${
                        isActive
                          ? "bg-accent text-accent-foreground"
                          : "bg-surface-muted text-text-secondary hover:bg-accent hover:text-accent-foreground"
                      }`}
                    >
                      <Folder className="w-3 h-3 inline mr-0.5 -mt-px" />
                      {name}
                      {isActive && (
                        <span className="ml-0.5 opacity-70">✕</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })()}

      <div className="flex-1 overflow-y-auto px-3 py-4 sidebar-scroll">
        {/* Task slot area */}
        {taskSlots.length > 0 && (
          <div className="mb-4">
            <div className="px-3 pb-1.5">
              <span className="text-sm font-medium leading-5 text-text-secondary">
                {t("sidebar.currentTasks")}
              </span>
            </div>
            <div className="space-y-0.5 max-h-40 overflow-y-auto sidebar-scroll">
            {[...taskSlots]
              .sort((a, b) => {
                const sessionA = sessions.find((s) => s.id === a.sessionId);
                const sessionB = sessions.find((s) => s.id === b.sessionId);
                if (a.completed !== b.completed) return a.completed ? 1 : -1;
                return (sessionB?.updatedAt || 0) - (sessionA?.updatedAt || 0);
              })
              .map((slot) => {
              const session = sessions.find((s) => s.id === slot.sessionId);
              if (!session) return null;
              return (
                <div
                  key={slot.sessionId}
                  onClick={() => void handleSessionClick(slot.sessionId)}
                  className={`group cursor-pointer rounded-lg px-2.5 py-1.5 transition-colors border-l-[3px] border-l-transparent ${
                    activeSessionId === slot.sessionId && !showMarketplace
                      ? "bg-surface-active border-l-accent"
                      : ""
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-sm font-medium leading-5 truncate flex-1 ${(activeSessionId === slot.sessionId && !showMarketplace) || !slot.completed ? 'text-text-primary' : 'text-text-secondary'}`}
                    >
                      {session.title}
                    </span>
                    {session.isProjectMode &&
                      session.cwd &&
                      !isDefaultWorkspacePath(session.cwd) && (
                        <span className="text-[10px] bg-surface-muted text-text-muted px-1.5 py-0.5 rounded flex-shrink-0">
                          {getWorkspaceName(session.cwd)}
                        </span>
                      )}
                    <div className="relative w-5 h-5 flex-shrink-0">
                      <span
                        className={`absolute inset-0 m-auto w-2 h-2 rounded-full bg-accent transition-all duration-300 ${slot.completed ? 'opacity-0 scale-0' : 'opacity-100 scale-100 animate-pulse'}`}
                        role="status"
                        aria-label={t("sidebar.running")}
                      />
                      <Check
                        className={`absolute inset-0 m-auto w-3.5 h-3.5 text-accent/50 hover:text-accent transition-all duration-300 ${slot.completed ? 'opacity-100 scale-100 cursor-pointer' : 'opacity-0 scale-0 pointer-events-none'}`}
                        role="button"
                        tabIndex={slot.completed ? 0 : -1}
                        aria-label={t("sidebar.taskCompleted")}
                        onClick={(e) => {
                          e.stopPropagation();
                          removeTaskSlot(slot.sessionId);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.stopPropagation();
                            e.preventDefault();
                            removeTaskSlot(slot.sessionId);
                          }
                        }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          </div>
        )}

        <div className="space-y-0.5">
          {/* Session list header */}
          <div className="px-3 pb-1.5 flex items-center justify-between">
            <span className="text-sm font-medium leading-5 text-text-secondary">
              {t("sidebar.allSessions")}
            </span>
          </div>

          {/* Session list */}
          {(() => {
            const taskSlotIds = new Set(taskSlots.map((s) => s.sessionId));
            const sorted = sortFlattenedSessions(
              activeSessions,
              taskSlotIds,
            );
            const filtered = (() => {
              if (!normalizedQuery && !projectFilter) return sorted;
              return sorted.filter((s) => {
                if (projectFilter && !sessionMatchesProject(s, projectFilter))
                  return false;
                if (normalizedQuery && !sessionMatchesQuery(s, normalizedQuery))
                  return false;
                return true;
              });
            })();

            if (filtered.length === 0) {
              return (
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
              );
            }

            // Build groups: project sessions grouped by cwd, chat sessions as one group
            const MAX_PROJECT_VISIBLE = 5;
            const isSearching = !!(normalizedQuery || projectFilter);

            const items: RenderItem[] = [];
            let lastProject = "";
            let hasRenderedGroup = false;
            let projectSeen = 0; // count of sessions seen for current project
            let projectTotal = 0; // total sessions in current project
            let sawExpandedProject = false;
            let chatSeen = 0;
            const CHAT_EXPAND_KEY = "__chats__";
            const chatsExpanded = projectExpandedMap[CHAT_EXPAND_KEY];

            // Total chat sessions for expand/collapse counting
            const chatTotal = filtered.filter(
              (s) => !s.isProjectMode || !s.cwd || isDefaultWorkspacePath(s.cwd),
            ).length;

            for (const session of filtered) {
              const pName =
                session.isProjectMode &&
                session.cwd &&
                !isDefaultWorkspacePath(session.cwd)
                  ? getWorkspaceName(session.cwd)
                  : "";

              if (pName && pName !== lastProject) {
                // Transition to a new project
                // Insert collapse button for previous expanded project if needed
                if (sawExpandedProject && projectSeen > MAX_PROJECT_VISIBLE) {
                  items.push({
                    type: "collapse",
                    key: `collapse-${lastProject}`,
                    projectName: lastProject,
                  });
                }
                sawExpandedProject = false;
                // If transitioning from chat to first project, insert chat collapse
                if (lastProject === "" && chatsExpanded && chatSeen > MAX_PROJECT_VISIBLE) {
                  items.push({
                    type: "collapse",
                    key: `collapse-${CHAT_EXPAND_KEY}`,
                    projectName: CHAT_EXPAND_KEY,
                  });
                }
                // Insert divider
                if (hasRenderedGroup) {
                  items.push({ type: "divider", key: `div-${pName}` });
                }
                projectSeen = 0;
                projectTotal = 0;
                lastProject = pName;
                // Count total sessions in this project
                projectTotal = filtered.filter((s) => {
                  if (!s.isProjectMode || !s.cwd || isDefaultWorkspacePath(s.cwd)) return false;
                  return getWorkspaceName(s.cwd) === pName;
                }).length;
              } else if (!pName && lastProject) {
                // Transition from project to chat sessions
                if (sawExpandedProject && projectSeen > MAX_PROJECT_VISIBLE) {
                  items.push({
                    type: "collapse",
                    key: `collapse-${lastProject}`,
                    projectName: lastProject,
                  });
                }
                sawExpandedProject = false;
                items.push({ type: "divider", key: `div-chat` });
                chatSeen = 0;
                lastProject = "";
              }

              // Truncation: for project sessions, only show first N unless expanded or searching
              let shouldSkip = false;
              let shouldExpand: number | null = null;
              if (pName && !isSearching) {
                projectSeen++;
                if (!projectExpandedMap[pName]) {
                  if (projectSeen > MAX_PROJECT_VISIBLE) shouldSkip = true;
                  else if (projectSeen === MAX_PROJECT_VISIBLE && projectTotal > MAX_PROJECT_VISIBLE) {
                    shouldExpand = projectTotal - MAX_PROJECT_VISIBLE;
                  }
                } else {
                  sawExpandedProject = true;
                }
              }

              // Truncation: for chat sessions, same rule
              if (!pName && !isSearching) {
                chatSeen++;
                if (!chatsExpanded) {
                  if (chatSeen > MAX_PROJECT_VISIBLE) shouldSkip = true;
                  else if (chatSeen === MAX_PROJECT_VISIBLE && chatTotal > MAX_PROJECT_VISIBLE) {
                    shouldExpand = chatTotal - MAX_PROJECT_VISIBLE;
                  }
                }
              }

              if (shouldSkip) continue;

              items.push({ type: "session", key: session.id, session });
              hasRenderedGroup = true;

              // Insert expand button AFTER the N-th session
              if (shouldExpand !== null) {
                const expandKey = pName || CHAT_EXPAND_KEY;
                items.push({
                  type: "expand",
                  key: `expand-${expandKey}`,
                  projectName: expandKey,
                  count: shouldExpand,
                });
              }
            }

            // Handle collapse for the last project group
            if (sawExpandedProject && projectSeen > MAX_PROJECT_VISIBLE) {
              items.push({
                type: "collapse",
                key: `collapse-${lastProject}`,
                projectName: lastProject,
              });
            }

            // Handle collapse for chat section (only if no projects followed chat)
            if (lastProject === "" && chatsExpanded && chatSeen > MAX_PROJECT_VISIBLE) {
              items.push({
                type: "collapse",
                key: `collapse-${CHAT_EXPAND_KEY}`,
                projectName: CHAT_EXPAND_KEY,
              });
            }

            return (
              <>
                {items.map((item) => {
                    switch (item.type) {
                      case "divider":
                        return (
                          <div
                            key={item.key}
                            className="mx-3 my-0.5 border-t border-dashed border-border-muted"
                          />
                        );
                      case "expand":
                        return (
                          <button
                            key={item.key}
                            onClick={() =>
                              setProjectExpandedMap((prev) => ({
                                ...prev,
                                [item.projectName!]: true,
                              }))
                            }
                            className="w-full text-center text-xs text-text-muted hover:text-text-secondary py-1 transition-colors"
                          >
                            {t("sidebar.expandProject", { count: item.count })}
                          </button>
                        );
                      case "collapse":
                        return (
                          <button
                            key={item.key}
                            onClick={() =>
                              setProjectExpandedMap((prev) => {
                                const next = { ...prev };
                                delete next[item.projectName!];
                                return next;
                              })
                            }
                            className="w-full text-center text-xs text-text-muted hover:text-text-secondary py-1 transition-colors"
                          >
                            {t("sidebar.collapseProject")}
                          </button>
                        );
                      case "session":
                        return (
                          <div key={item.key}>
                            {renderSessionItem(item.session!, true)}
                          </div>
                        );
                    }
                  })
                }
              </>
            );
          })()}
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
            <ChevronDown
              className={`w-3.5 h-3.5 flex-shrink-0 transition-transform ${
                accountMenuOpen ? "rotate-180" : ""
              }`}
            />
          </button>
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
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
      </>)}
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
            try { await new CloudApiClient(cloudConfig.token).logout(); } catch { /* ignore */ }
            setCloudConfig(null);
          } else {
            setCloudConfig(null);
          }
        }}
        onCancel={() => setConfirmLogoutOpen(false)}
      />
    </>
  );
}

interface RenderItem {
  type: "divider" | "session" | "expand" | "collapse";
  key: string;
  session?: Session;
  projectName?: string;
  count?: number;
}

function sortFlattenedSessions(
  sessions: Session[],
  taskSlotIds: Set<string>,
): Session[] {
  const available = sessions.filter((s) => !taskSlotIds.has(s.id));

  const projectSessions: Session[] = [];
  const chatSessions: Session[] = [];

  for (const s of available) {
    if (s.isProjectMode && s.cwd && !isDefaultWorkspacePath(s.cwd)) {
      projectSessions.push(s);
    } else {
      chatSessions.push(s);
    }
  }

  // Group project sessions by cwd, sort groups by latest session time
  const grouped = new Map<string, Session[]>();
  for (const s of projectSessions) {
    const cwd = normalizeWorkspacePath(s.cwd);
    if (!cwd) continue;
    const arr = grouped.get(cwd) || [];
    arr.push(s);
    grouped.set(cwd, arr);
  }

  // Sort each group internally by updatedAt desc
  for (const arr of grouped.values()) {
    arr.sort(
      (a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt),
    );
  }

  // Sort groups by their most recent session
  const sortedGroups = Array.from(grouped.entries()).sort(([, a], [, b]) => {
    const aLatest = a[0]?.updatedAt || a[0]?.createdAt || 0;
    const bLatest = b[0]?.updatedAt || b[0]?.createdAt || 0;
    return bLatest - aLatest;
  });

  // Chat sessions first, sorted by time
  chatSessions.sort(
    (a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt),
  );
  const result: Session[] = [...chatSessions];

  // Project sessions after, grouped by workspace
  for (let i = 0; i < sortedGroups.length; i++) {
    result.push(...sortedGroups[i][1]);
  }

  return result;
}

/** Returns Set of project names that match the search query (for Chip display). */
function getMatchedProjectNames(
  sessions: Session[],
  query: string,
): Set<string> {
  const names = new Set<string>();
  if (!query) return names;
  for (const s of sessions) {
    if (!s.isProjectMode || !s.cwd || isDefaultWorkspacePath(s.cwd)) continue;
    const name = getWorkspaceName(s.cwd).toLowerCase();
    if (name.includes(query)) {
      names.add(getWorkspaceName(s.cwd));
    }
  }
  return names;
}

/** Check if a session matches the search query (title OR project name). */
function sessionMatchesQuery(session: Session, query: string): boolean {
  const q = query.toLowerCase();
  if (session.title.toLowerCase().includes(q)) return true;
  if (session.cwd && !isDefaultWorkspacePath(session.cwd)) {
    if (getWorkspaceName(session.cwd).toLowerCase().includes(q)) return true;
  }
  return false;
}

/** Check if a session belongs to a given project (by workspace folder name). */
function sessionMatchesProject(session: Session, projectName: string): boolean {
  if (!session.cwd || isDefaultWorkspacePath(session.cwd)) return false;
  return getWorkspaceName(session.cwd) === projectName;
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
