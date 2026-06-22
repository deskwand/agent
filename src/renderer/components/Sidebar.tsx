import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../store";
import { useIPC } from "../hooks/useIPC";
import {
  ChevronRight,
  ChevronDown,
  Trash2,
  Settings,
  Clock3,
  Store,
  Search as SearchIcon,
  Plus,
  ListChecks,
  Check,
  Folder,
  SquarePen,
  Archive,
  Globe,
} from "lucide-react";
import type { Session } from "../types";
import { DEFAULT_WORKDIR_DIRNAME } from "../../shared/workspace-path";

const DEFAULT_MAX_VISIBLE = 10;

type ProjectWorkspaceGroup = {
  key: string;
  cwd: string;
  workspaceName: string;
  sessions: Session[];
};

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
  const conversationsCollapsed = useAppStore((s) => s.conversationsCollapsed);
  const projectsCollapsed = useAppStore((s) => s.projectsCollapsed);
  const workspaceCollapsedMap = useAppStore((s) => s.workspaceCollapsedMap);
  const conversationsMaxVisible = useAppStore((s) => s.conversationsMaxVisible);
  const workspaceMaxVisibleMap = useAppStore((s) => s.workspaceMaxVisibleMap);
  const toggleConversations = useAppStore((s) => s.toggleConversations);
  const toggleProjects = useAppStore((s) => s.toggleProjects);
  const toggleWorkspaceCollapsed = useAppStore(
    (s) => s.toggleWorkspaceCollapsed,
  );
  const setConversationsMaxVisible = useAppStore(
    (s) => s.setConversationsMaxVisible,
  );
  const setWorkspaceMaxVisible = useAppStore(
    (s) => s.setWorkspaceMaxVisible,
  );
  const setShowSettings = useAppStore((s) => s.setShowSettings);
  const showSchedule = useAppStore((s) => s.showSchedule);
  const setShowSchedule = useAppStore((s) => s.setShowSchedule);
  const showMarketplace = useAppStore((s) => s.showMarketplace);
  const setShowMarketplace = useAppStore((s) => s.setShowMarketplace);
  const setGlobalNotice = useAppStore((s) => s.setGlobalNotice);
  const toggleBrowserPanel = useAppStore((s) => s.toggleBrowserPanel);

  const {
    invoke,
    deleteSession,
    batchDeleteSessions,
    archiveSession,
    batchArchiveSessions,
    getSessionMessages,
    getSessionTraceSteps,
    changeWorkingDir,
    createProject,
    deleteProject,
    isElectron,
  } = useIPC();

  const [searchQuery, setSearchQuery] = useState("");
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showProjectActions, setShowProjectActions] = useState(false);
  const [pendingArchiveId, setPendingArchiveId] = useState<string | null>(null);

  useEffect(() => {
    if (!showProjectActions) return;
    const handler = () => setShowProjectActions(false);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [showProjectActions]);
  const [hoveredTimeSessionId, setHoveredTimeSessionId] = useState<
    string | null
  >(null);
  const [openedProjectCwds, setOpenedProjectCwds] = useState<string[]>([]);
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
  const filteredSessions = useMemo(() => {
    return normalizedQuery
      ? activeSessions.filter((session) =>
          session.title.toLowerCase().includes(normalizedQuery),
        )
      : activeSessions;
  }, [activeSessions, normalizedQuery]);

  const { conversationSessions, projectSessions } = useMemo(() => {
    const conversation: Session[] = [];
    const project: Session[] = [];

    for (const session of filteredSessions) {
      if (session.isProjectMode) {
        project.push(session);
      } else {
        conversation.push(session);
      }
    }

    return { conversationSessions: conversation, projectSessions: project };
  }, [filteredSessions]);

  const sortedConversationSessions = useMemo(
    () =>
      [...conversationSessions].sort(
        (a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt),
      ),
    [conversationSessions],
  );

  const groupedProjectWorkspaces = useMemo(
    () => groupProjectSessionsByWorkspace(projectSessions, openedProjectCwds),
    [projectSessions, openedProjectCwds],
  );

  useEffect(() => {
    if (sidebarCollapsed && isSelectMode) {
      setIsSelectMode(false);
      setSelectedIds(new Set());
    }
  }, [sidebarCollapsed, isSelectMode]);

  useEffect(() => {
    if (!isSelectMode) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsSelectMode(false);
        setSelectedIds(new Set());
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isSelectMode]);

  useEffect(() => {
    if (isSelectMode) {
      setSelectedIds(new Set());
    }
  }, [searchQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const cwd = normalizeWorkspacePath(workingDir);
    if (!cwd || isDefaultWorkspacePath(cwd)) return;
    setOpenedProjectCwds((prev) =>
      prev.includes(cwd) ? prev : [cwd, ...prev],
    );
  }, [workingDir]);

  const exitSelectMode = useCallback(() => {
    setIsSelectMode(false);
    setSelectedIds(new Set());
  }, []);

  const toggleSelectSession = useCallback((sessionId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        next.add(sessionId);
      }
      return next;
    });
  }, []);

  const visibleSessionIds = useMemo(
    () => filteredSessions.map((s) => s.id),
    [filteredSessions],
  );

  const allVisibleSelected =
    visibleSessionIds.length > 0 &&
    visibleSessionIds.every((id) => selectedIds.has(id));

  const toggleSelectAll = useCallback(() => {
    if (allVisibleSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of visibleSessionIds) {
          next.delete(id);
        }
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of visibleSessionIds) {
          next.add(id);
        }
        return next;
      });
    }
  }, [allVisibleSelected, visibleSessionIds]);

  const handleBatchDelete = useCallback(() => {
    const visibleSet = new Set(visibleSessionIds);
    const ids = Array.from(selectedIds).filter((id) => visibleSet.has(id));
    if (ids.length === 0) return;
    setDeleteConfirm({
      message: t("sidebar.batchDeleteConfirm", { count: ids.length }),
      onConfirm: () => {
        batchDeleteSessions(ids);
        exitSelectMode();
        setDeleteConfirm(null);
      },
    });
  }, [selectedIds, visibleSessionIds, batchDeleteSessions, exitSelectMode, t]);

  const handleBatchArchive = useCallback(() => {
    const visibleSet = new Set(visibleSessionIds);
    const ids = Array.from(selectedIds).filter((id) => visibleSet.has(id));
    if (ids.length === 0) return;
    setDeleteConfirm({
      message: t("sidebar.batchArchiveConfirm", { count: ids.length }),
      onConfirm: () => {
        batchArchiveSessions(ids);
        exitSelectMode();
        setDeleteConfirm(null);
      },
    });
  }, [selectedIds, visibleSessionIds, batchArchiveSessions, exitSelectMode, t]);

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

  const rememberProjectPath = useCallback((rawPath: string) => {
    const cwd = normalizeWorkspacePath(rawPath);
    if (!cwd || isDefaultWorkspacePath(cwd)) return;
    setOpenedProjectCwds((prev) =>
      prev.includes(cwd) ? prev : [cwd, ...prev],
    );
  }, []);

  const forgetProjectPath = useCallback((rawPath: string) => {
    const cwd = normalizeWorkspacePath(rawPath);
    if (!cwd) return;
    setOpenedProjectCwds((prev) => prev.filter((item) => item !== cwd));
  }, []);

  const handleSelectProjectDir = useCallback(
    async (currentPath?: string) => {
      const result = await changeWorkingDir(
        undefined,
        currentPath || workingDir || undefined,
      );
      if (!result?.success) return;
      rememberProjectPath(result.path);
    },
    [changeWorkingDir, rememberProjectPath, workingDir],
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

      rememberProjectPath(result.path);
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
    rememberProjectPath,
    setGlobalNotice,
    t,
  ]);

  const handleDeleteProject = useCallback(
    (cwd: string) => {
      const normalizedCwd = normalizeWorkspacePath(cwd);
      if (!normalizedCwd) return;
      setDeleteConfirm({
        message: t("sidebar.deleteProjectConfirmWithName", {
          name: getWorkspaceName(normalizedCwd),
        }),
        onConfirm: async () => {
          try {
            const result = await deleteProject(normalizedCwd);
            if (!result.success) {
              setGlobalNotice({
                id: `notice-project-delete-failed-${Date.now()}`,
                type: "error",
                message: result.error || t("sidebar.deleteProjectFailed"),
              });
              return;
            }
            forgetProjectPath(normalizedCwd);
            setDeleteConfirm(null);
          } catch (error) {
            console.error("[Sidebar] Failed to delete project:", error);
            setGlobalNotice({
              id: `notice-project-delete-failed-${Date.now()}`,
              type: "error",
              message: t("sidebar.deleteProjectFailed"),
            });
          }
        },
      });
    },
    [deleteProject, forgetProjectPath, setGlobalNotice, t],
  );

  const handleNewSessionInProject = useCallback(
    async (cwd: string) => {
      if (isElectron) {
        await invoke<{ success: boolean; path: string; error?: string }>({
          type: "workdir.set",
          payload: { path: cwd },
        });
      }
      rememberProjectPath(cwd);
      handleNewSession();
    },
    [handleNewSession, invoke, isElectron, rememberProjectPath],
  );

  const renderSessionItem = (
    session: Session,
    showRelativeTime: boolean,
    indent = false,
  ) => {
    const isActive = activeSessionId === session.id;
    const isSelected = selectedIds.has(session.id);

    return (
      <div
        key={session.id}
        onClick={() => {
          if (isSelectMode) {
            toggleSelectSession(session.id);
          } else {
            void handleSessionClick(session.id);
          }
        }}
        className={`group relative cursor-pointer rounded-lg px-2.5 py-1.5 transition-colors border-l-[3px] border-l-transparent ${
          isSelectMode && isSelected
            ? "bg-accent-muted/20"
            : isActive && !isSelectMode
              ? "bg-surface-active border-l-accent"
              : "hover:bg-surface-hover/60"
        }`}
      >
        <div className="flex items-center gap-2">
          {indent && <div className="w-3.5 flex-shrink-0" />}
          {isSelectMode && (
            <div
              className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 transition-colors ${
                isSelected
                  ? "bg-accent text-accent-foreground"
                  : "border border-border-muted bg-background"
              }`}
            >
              {isSelected && <Check className="w-2.5 h-2.5" />}
            </div>
          )}

          <div className="min-w-0 flex-1 flex items-center gap-2">
            <div className="text-sm font-medium leading-5 text-text-primary truncate flex-1">
              {session.title}
            </div>

            {showRelativeTime && !isSelectMode && (
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

  if (sidebarCollapsed) {
    return <aside className="w-0 overflow-hidden flex-shrink-0" />;
  }

  return (
    <aside
      className="bg-surface/96 flex flex-col overflow-hidden"
      style={{ width: `${width}px` }}
    >
      <div className="px-4 pt-3 pb-4">
        {sessions.length > 0 && (
          <div className="mt-3 flex items-center gap-2 group/manage-bar">
            <div className="relative flex-1 min-w-0">
              <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t("sidebar.search")}
                className="w-full rounded-xl border border-transparent bg-surface-muted pl-9 pr-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border focus:bg-background transition-colors"
              />
            </div>
            <button
              onClick={() => {
                if (isSelectMode) {
                  exitSelectMode();
                } else {
                  setIsSelectMode(true);
                }
              }}
              className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors ${
                isSelectMode
                  ? "bg-accent text-accent-foreground"
                  : "text-text-secondary hover:text-text-primary hover:bg-surface-hover opacity-0 pointer-events-none group-hover/manage-bar:opacity-100 group-hover/manage-bar:pointer-events-auto transition-opacity duration-150"
              }`}
              title={t("sidebar.manage")}
            >
              <ListChecks className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Marketplace & Automation shortcuts */}
      <div className="px-3 pb-1 space-y-0.5">
        <button
          onClick={() => {
            setShowSettings(false);
            setShowSchedule(false);
            setShowMarketplace(true);
          }}
          className={`w-full flex items-center gap-2 rounded-xl px-3 py-1.5 text-left transition-colors ${
            showMarketplace
              ? "bg-accent/10 text-accent"
              : "text-text-secondary hover:text-text-primary hover:bg-surface-hover"
          }`}
        >
          <Store className="w-4 h-4 flex-shrink-0" />
          <span className="text-sm font-medium leading-5 truncate">
            {t("sidebar.marketplace")}
          </span>
        </button>
        <button
          onClick={() => {
            setShowSettings(false);
            setShowMarketplace(false);
            setShowSchedule(true);
          }}
          className={`w-full flex items-center gap-2 rounded-xl px-3 py-1.5 text-left transition-colors ${
            showSchedule
              ? "bg-accent/10 text-accent"
              : "text-text-secondary hover:text-text-primary hover:bg-surface-hover"
          }`}
        >
          <Clock3 className="w-4 h-4 flex-shrink-0" />
          <span className="text-sm font-medium leading-5 truncate">
            {t("sidebar.automation")}
          </span>
        </button>
      </div>

      {/* Browser toggle */}
      <div className="px-3 pb-1">
        <button
          onClick={() => {
            setShowSettings(false);
            setShowSchedule(false);
            setShowMarketplace(false);
            toggleBrowserPanel();
          }}
          className="w-full flex items-center gap-2 rounded-xl px-3 py-1.5 text-left text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors"
        >
          <Globe className="w-4 h-4 flex-shrink-0" />
          <span className="text-sm font-medium leading-5 truncate">
            {t("sidebar.browser")}
          </span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4">
        <div className="space-y-4">
          {/* Chats section */}
          <section className="group/chat-section">
            <div className="px-3 pb-2 flex items-center justify-between gap-2">
              <div className="text-sm font-medium leading-5 text-text-secondary">
                {t("sidebar.conversations")}
              </div>
              <div className="flex items-center gap-1 opacity-0 pointer-events-none group-hover/chat-section:opacity-100 group-hover/chat-section:pointer-events-auto transition-opacity duration-150">
                <button
                  onClick={() => toggleConversations()}
                  className="w-6 h-6 rounded-md flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors"
                  title={
                    conversationsCollapsed
                      ? t("sidebar.expandConversations")
                      : t("sidebar.collapseConversations")
                  }
                >
                  {conversationsCollapsed ? (
                    <ChevronRight className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                </button>
                <button
                  onClick={() => { setWorkingDir(null); handleNewSession(); }}
                  className="w-6 h-6 rounded-md flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors"
                  title={t("sidebar.newTask")}
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            {!conversationsCollapsed &&
              (sortedConversationSessions.length > 0 ? (
                <>
                  <div className="space-y-0.5">
                    {sortedConversationSessions
                      .slice(0, conversationsMaxVisible)
                      .map((session) => renderSessionItem(session, true))}
                  </div>
                  {sortedConversationSessions.length > DEFAULT_MAX_VISIBLE &&
                    (conversationsMaxVisible <
                    sortedConversationSessions.length ? (
                      <button
                        onClick={() =>
                          setConversationsMaxVisible(Infinity)
                        }
                        className="w-full text-sm text-text-muted hover:text-text-primary cursor-pointer px-3 py-1.5 transition-colors text-left"
                      >
                        {t("sidebar.expandConversationsList", {
                          count:
                            sortedConversationSessions.length -
                            conversationsMaxVisible,
                        })}
                      </button>
                    ) : (
                      <button
                        onClick={() =>
                          setConversationsMaxVisible(DEFAULT_MAX_VISIBLE)
                        }
                        className="w-full text-sm text-text-muted hover:text-text-primary cursor-pointer px-3 py-1.5 transition-colors text-left"
                      >
                        {t("sidebar.collapseList")}
                      </button>
                    ))}
                </>
              ) : (
                <p className="px-3 text-sm leading-5 text-text-muted">
                  {t("sidebar.noConversationsHint")}
                </p>
              ))}
          </section>

          {/* Projects section */}
          <section className="group/project-section">
            <div className="px-3 pb-2 flex items-center justify-between gap-2 relative">
              <div className="text-sm font-medium leading-5 text-text-secondary">
                {t("sidebar.projects")}
              </div>
              <div className="flex items-center gap-1 opacity-0 pointer-events-none group-hover/project-section:opacity-100 group-hover/project-section:pointer-events-auto transition-opacity duration-150">
                <button
                  onClick={() => toggleProjects()}
                  className="w-6 h-6 rounded-md flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors"
                  title={
                    projectsCollapsed
                      ? t("sidebar.expandProjects")
                      : t("sidebar.collapseProjects")
                  }
                >
                  {projectsCollapsed ? (
                    <ChevronRight className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowProjectActions((prev) => !prev);
                  }}
                  className="w-6 h-6 rounded-md flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors"
                  title={t("sidebar.projects")}
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
              {showProjectActions && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="absolute right-0 top-7 z-20 w-40 rounded-lg border border-border-muted bg-background shadow-lg p-1"
                >
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

            {!projectsCollapsed &&
              (groupedProjectWorkspaces.length > 0 ? (
                <div className="space-y-3">
                  {groupedProjectWorkspaces.map((workspace) => (
                    <section key={workspace.key}>
                      <div
                        className="group/project relative px-3 py-1.5 rounded-lg hover:bg-surface-hover/60 transition-colors cursor-pointer"
                        onClick={() => toggleWorkspaceCollapsed(workspace.cwd)}
                      >
                        <div className="flex items-center gap-2 pr-20">
                          <Folder className="w-3.5 h-3.5 flex-shrink-0 text-text-muted" />
                          <span
                            className="text-sm font-medium text-text-primary truncate"
                            title={workspace.cwd}
                          >
                            {workspace.workspaceName}
                          </span>
                          {workspaceCollapsedMap[workspace.cwd] ? (
                            <ChevronRight className="w-3 h-3 flex-shrink-0 text-text-muted" />
                          ) : (
                            <ChevronDown className="w-3 h-3 flex-shrink-0 text-text-muted" />
                          )}
                        </div>

                        <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-0 pointer-events-none transition-opacity group-hover/project:opacity-100 group-hover/project:pointer-events-auto">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleNewSessionInProject(workspace.cwd);
                            }}
                            className="w-6 h-6 rounded-md flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-active transition-colors"
                            title={t("sidebar.newTask")}
                          >
                            <SquarePen className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteProject(workspace.cwd);
                            }}
                            className="w-6 h-6 rounded-md flex items-center justify-center text-text-muted hover:text-error hover:bg-surface-active transition-colors"
                            title={t("common.delete")}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {!workspaceCollapsedMap[workspace.cwd] &&
                        (workspace.sessions.length > 0 ? (
                          <>
                            <div className="space-y-0.5 mt-1">
                              {workspace.sessions
                                .slice(
                                  0,
                                  workspaceMaxVisibleMap[workspace.cwd] ?? 10,
                                )
                                .map((session) =>
                                  renderSessionItem(session, true, true),
                                )}
                            </div>
                            {workspace.sessions.length > DEFAULT_MAX_VISIBLE &&
                              ((workspaceMaxVisibleMap[workspace.cwd] ??
                                DEFAULT_MAX_VISIBLE) <
                              workspace.sessions.length ? (
                                <button
                                  onClick={() =>
                                    setWorkspaceMaxVisible(
                                      workspace.cwd,
                                      Infinity,
                                    )
                                  }
                                  className="w-full text-sm text-text-muted hover:text-text-primary cursor-pointer px-3 py-1.5 transition-colors text-left"
                                >
                                  {t("sidebar.expandWorkspaceSessions", {
                                    count:
                                      workspace.sessions.length -
                                      (workspaceMaxVisibleMap[workspace.cwd] ??
                                        DEFAULT_MAX_VISIBLE),
                                  })}
                                </button>
                              ) : (
                                <button
                                  onClick={() =>
                                    setWorkspaceMaxVisible(
                                      workspace.cwd,
                                      DEFAULT_MAX_VISIBLE,
                                    )
                                  }
                                  className="w-full text-sm text-text-muted hover:text-text-primary cursor-pointer px-3 py-1.5 transition-colors text-left"
                                >
                                  {t("sidebar.collapseList")}
                                </button>
                              ))}
                          </>
                        ) : (
                          <div className="mt-1 px-3 py-1 text-sm leading-5 text-text-muted">
                            {t("sidebar.noConversations")}
                          </div>
                        ))}
                    </section>
                  ))}
                </div>
              ) : (
                <p className="px-3 text-sm leading-5 text-text-muted">
                  {t("sidebar.noProjectsHint")}
                </p>
              ))}
          </section>
        </div>
      </div>

      {isSelectMode ? (
        <div className="px-3 py-3">
          <div className="space-y-2">
            <div className="flex items-center justify-between px-1">
              <button
                onClick={toggleSelectAll}
                className="text-sm font-medium text-accent hover:text-accent/80 transition-colors"
              >
                {allVisibleSelected
                  ? t("sidebar.deselectAll")
                  : t("sidebar.selectAll")}
              </button>
              <span className="text-sm text-text-muted">
                {t("sidebar.nSelected", { count: selectedIds.size })}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={exitSelectMode}
                className="flex-1 px-3 py-2 rounded-xl text-sm font-medium text-text-secondary hover:bg-surface-hover transition-colors"
              >
                {t("sidebar.cancel")}
              </button>
              <button
                onClick={handleBatchArchive}
                disabled={selectedIds.size === 0}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium bg-accent/90 text-accent-foreground hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Archive className="w-3.5 h-3.5" />
                {t("sidebar.archive")}
              </button>
              <button
                onClick={handleBatchDelete}
                disabled={selectedIds.size === 0}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium bg-error text-white hover:bg-error/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {t("common.delete")}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="px-3 py-3">
          <div className="flex items-center gap-2 rounded-2xl bg-background/50 px-3 py-2.5">
            <button
              onClick={() => {
                setShowMarketplace(false);
                setShowSchedule(false);
                setShowSettings(true);
              }}
              className="flex-1 min-w-0 flex items-center gap-2 text-left text-text-secondary hover:text-text-primary transition-colors"
            >
              <Settings className="w-4 h-4 flex-shrink-0" />
              <div className="min-w-0">
                <div className="text-sm font-medium text-text-primary">
                  {t("sidebar.settings")}
                </div>
              </div>
            </button>
          </div>
        </div>
      )}

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
    </aside>
  );
}

function groupProjectSessionsByWorkspace(
  sessions: Session[],
  openedProjectCwds: string[],
): ProjectWorkspaceGroup[] {
  const grouped = new Map<string, Session[]>();

  for (const session of sessions) {
    const cwd = normalizeWorkspacePath(session.cwd);
    if (!cwd || isDefaultWorkspacePath(cwd)) continue;
    const existing = grouped.get(cwd) || [];
    existing.push(session);
    grouped.set(cwd, existing);
  }

  for (const cwd of openedProjectCwds) {
    const normalized = normalizeWorkspacePath(cwd);
    if (!normalized || grouped.has(normalized)) continue;
    grouped.set(normalized, []);
  }

  const workspaces = Array.from(grouped.entries()).map(
    ([cwd, workspaceSessions]) => ({
      key: cwd,
      cwd,
      workspaceName: getWorkspaceName(cwd),
      sessions: workspaceSessions.sort(
        (a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt),
      ),
    }),
  );

  return workspaces.sort((a, b) => {
    const aLatest = a.sessions[0]?.updatedAt || a.sessions[0]?.createdAt || 0;
    const bLatest = b.sessions[0]?.updatedAt || b.sessions[0]?.createdAt || 0;
    return bLatest - aLatest;
  });
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
