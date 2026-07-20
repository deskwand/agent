import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
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
  MoreHorizontal,
  SquarePen,
  Download,
  Pin,
  PinOff,
} from "lucide-react";
import { AccountMenu } from "./AccountMenu";
import { LoginModal } from "./LoginModal";
import { ConfirmDialog } from "./ConfirmDialog";
import { UpdateConfirmDialog } from "./UpdateConfirmDialog";
import {
  SidebarAnimatedSection,
  SidebarGroupIcon,
} from "./sidebar-disclosure-motion";
import { CloudApiClient } from "../services/cloud-api";
import type { Session } from "../types";
import { DEFAULT_WORKDIR_DIRNAME } from "../../shared/workspace-path";
import {
  buildSidebarSessionGroups,
  type SidebarPins,
} from "../utils/sidebar-session-groups";

const DEFAULT_VISIBLE_SESSIONS = 5;
const DEFAULT_EXPANDED_PROJECTS = 3;
const ORDINARY_SESSION_GROUP_KEY = "__ordinary_sessions__";
const SIDEBAR_PINS_STORAGE_KEY = "deskwand.sidebarPins";
const SESSION_OVERFLOW_BUTTON_CLASS =
  "rounded-lg bg-transparent px-3 py-1.5 text-xs text-text-muted hover:bg-transparent hover:text-text-secondary focus-visible:bg-transparent focus-visible:text-text-secondary transition-colors";

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
  const [projectExpansionOverrides, setProjectExpansionOverrides] = useState(
    () => new Map<string, boolean>(),
  );
  const [sessionVisibleCountOverrides, setSessionVisibleCountOverrides] =
    useState(() => new Map<string, number>());
  const [sectionMotionVersions, setSectionMotionVersions] = useState(
    () => new Map<string, number>(),
  );
  const [sidebarPins, setSidebarPins] = useState<SidebarPins>(loadSidebarPins);
  const [showProjectActions, setShowProjectActions] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [confirmLogoutOpen, setConfirmLogoutOpen] = useState(false);
  const [cloudRestoring, setCloudRestoring] = useState(false);
  const [pendingArchiveId, setPendingArchiveId] = useState<string | null>(null);
  const [sessionMenu, setSessionMenu] = useState<SessionMenuState | null>(null);
  const [showUpdateDialog, setShowUpdateDialog] = useState(false);
  const [currentAppVersion, setCurrentAppVersion] = useState("");

  useEffect(() => {
    saveSidebarPins(sidebarPins);
  }, [sidebarPins]);

  useEffect(() => {
    if (!showProjectActions) return;
    const handler = () => setShowProjectActions(false);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [showProjectActions]);

  useEffect(() => {
    if (!sessionMenu) return;

    const closeMenu = () => setSessionMenu(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };

    document.addEventListener("click", closeMenu);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", closeMenu);
    return () => {
      document.removeEventListener("click", closeMenu);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", closeMenu);
    };
  }, [sessionMenu]);

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

  const [hoveredSessionId, setHoveredSessionId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{
    message: string;
    onConfirm: () => void;
  } | null>(null);
  const [createProjectModalOpen, setCreateProjectModalOpen] = useState(false);
  useBrowserOcclusion(Boolean(deleteConfirm) || createProjectModalOpen);
  const [projectName, setProjectName] = useState("");
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const sessionLoadSeqRef = useRef(0);
  const scrollListRef = useRef<HTMLDivElement>(null);

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
    () => buildSidebarSessionGroups(sessions, normalizedQuery, sidebarPins),
    [sessions, normalizedQuery, sidebarPins],
  );
  const runningGroupKeys = useMemo(() => {
    const keys = new Set<string>();
    if (sessionGroups.unscopedSessions.some((s) => s.status === "running")) {
      keys.add(ORDINARY_SESSION_GROUP_KEY);
    }
    for (const group of sessionGroups.projectGroups) {
      if (group.sessions.some((s) => s.status === "running")) {
        keys.add(group.key);
      }
    }
    return keys;
  }, [sessionGroups]);
  const pinnedSessionIds = useMemo(
    () => new Set(sidebarPins.sessionIds),
    [sidebarPins.sessionIds],
  );
  const pinnedProjectKeys = useMemo(
    () => new Set(sidebarPins.projectKeys),
    [sidebarPins.projectKeys],
  );
  const sessionMenuSession = sessionMenu
    ? activeSessions.find((session) => session.id === sessionMenu.sessionId)
    : undefined;

  useEffect(() => {
    if (!activeSessionId || normalizedQuery) return;
    const raf = requestAnimationFrame(() => {
      scrollListRef.current
        ?.querySelector(`[data-session-id="${activeSessionId}"]`)
        ?.scrollIntoView({ block: "nearest" });
    });
    return () => cancelAnimationFrame(raf);
  }, [activeSessionId, normalizedQuery]);

  const resolveProjectExpanded = (
    groupKey: string,
    projectIndex: number,
    projectSessions: Session[],
  ): boolean => {
    if (normalizedQuery) return true;
    const override = projectExpansionOverrides.get(groupKey);
    if (override !== undefined) return override;
    if (
      activeSessionId &&
      projectSessions.some((s) => s.id === activeSessionId)
    )
      return true;
    return projectIndex < DEFAULT_EXPANDED_PROJECTS;
  };

  const resolveOrdinarySessionsExpanded = (): boolean => {
    if (normalizedQuery) return true;
    const override = projectExpansionOverrides.get(ORDINARY_SESSION_GROUP_KEY);
    if (override !== undefined) return override;
    if (
      activeSessionId &&
      sessionGroups.unscopedSessions.some(
        (session) => session.id === activeSessionId,
      )
    ) {
      return true;
    }
    return false;
  };

  const ordinarySessionsExpanded = resolveOrdinarySessionsExpanded();

  const resolveSessionVisibleCount = (
    groupKey: string,
    groupSessions: Session[],
  ): number => {
    if (normalizedQuery) return groupSessions.length;
    const override = sessionVisibleCountOverrides.get(groupKey);
    let visibleCount = Math.min(
      override ?? DEFAULT_VISIBLE_SESSIONS,
      groupSessions.length,
    );
    if (activeSessionId) {
      const activeIndex = groupSessions.findIndex(
        (s) => s.id === activeSessionId,
      );
      if (activeIndex >= 0 && activeIndex >= visibleCount) {
        visibleCount = activeIndex + 1;
      }
    }
    return visibleCount;
  };

  const setProjectExpanded = (groupKey: string, expanded: boolean) => {
    setProjectExpansionOverrides((current) => {
      const next = new Map(current);
      next.set(groupKey, expanded);
      return next;
    });
  };

  const setSessionVisibleCount = (groupKey: string, visibleCount: number) => {
    setSessionVisibleCountOverrides((current) => {
      const next = new Map(current);
      next.set(groupKey, visibleCount);
      return next;
    });
  };

  const requestSectionMotion = (groupKey: string) => {
    setSectionMotionVersions((current) => {
      const next = new Map(current);
      next.set(groupKey, (next.get(groupKey) ?? 0) + 1);
      return next;
    });
  };

  const handleToggleSessionPin = useCallback(
    (event: React.MouseEvent, sessionId: string) => {
      event.stopPropagation();
      setSidebarPins((current) => ({
        ...current,
        sessionIds: toggleOrderedId(current.sessionIds, sessionId),
      }));
    },
    [],
  );

  const handleToggleProjectPin = useCallback(
    (event: React.MouseEvent, projectKey: string) => {
      event.stopPropagation();
      setSidebarPins((current) => ({
        ...current,
        projectKeys: toggleOrderedId(current.projectKeys, projectKey),
      }));
    },
    [],
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
      setSessionMenu(null);
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
    const isPinned = pinnedSessionIds.has(session.id);
    const isHovered = hoveredSessionId === session.id;
    const isMenuOpen = sessionMenu?.sessionId === session.id;
    const showSessionActions = isHovered || isMenuOpen;

    return (
      <div
        key={session.id}
        data-session-id={session.id}
        onClick={() => void handleSessionClick(session.id)}
        onMouseEnter={() => setHoveredSessionId(session.id)}
        onMouseLeave={() => {
          setHoveredSessionId((current) =>
            current === session.id ? null : current,
          );
          setPendingArchiveId((current) =>
            current === session.id ? null : current,
          );
        }}
        className={`group relative cursor-pointer rounded-lg px-2.5 py-1 transition-colors border-l-[3px] border-l-transparent ${
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
              <div className="ml-auto h-6 w-[4.5rem] flex-shrink-0 relative">
                <div
                  className={`absolute inset-0 flex items-center justify-end gap-1 transition-opacity ${
                    showSessionActions
                      ? "opacity-0 pointer-events-none"
                      : "opacity-100"
                  }`}
                >
                  {isPinned && (
                    <Pin
                      aria-hidden="true"
                      className="mr-auto h-3 w-3 fill-current text-accent"
                    />
                  )}
                  {hasStatusIndicator ? (
                    <span
                      className="h-4 w-4 flex items-center justify-center"
                      role="status"
                      aria-label={t("sidebar.running")}
                    >
                      <span className="h-2.5 w-2.5 rounded-full bg-accent animate-pulse" />
                    </span>
                  ) : (
                    <span className="text-sm leading-5 text-text-muted whitespace-nowrap">
                      {formatRelativeTime(
                        session.updatedAt || session.createdAt,
                        t,
                        i18n.language,
                      )}
                    </span>
                  )}
                </div>

                <div
                  className={`absolute inset-0 flex items-center justify-end transition-opacity ${
                    showSessionActions
                      ? "opacity-100"
                      : "opacity-0 pointer-events-none"
                  }`}
                >
                  {!hasStatusIndicator && (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        if (pendingArchiveId === session.id) {
                          archiveSession(session.id);
                          setPendingArchiveId(null);
                        } else {
                          setPendingArchiveId(session.id);
                        }
                      }}
                      className={`h-6 w-6 rounded-lg flex items-center justify-center transition-colors ${
                        pendingArchiveId === session.id
                          ? "text-accent bg-accent-muted/20 border border-accent/30"
                          : "text-text-muted hover:text-accent hover:bg-surface-active"
                      }`}
                      title={
                        pendingArchiveId === session.id
                          ? t("common.confirm")
                          : t("sidebar.archive")
                      }
                    >
                      {pendingArchiveId === session.id ? (
                        <Check className="h-3 w-3" />
                      ) : (
                        <Archive className="h-3 w-3" />
                      )}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setPendingArchiveId(null);
                      if (isMenuOpen) {
                        setSessionMenu(null);
                        return;
                      }
                      const rect = event.currentTarget.getBoundingClientRect();
                      setSessionMenu({
                        sessionId: session.id,
                        anchor: {
                          top: rect.top,
                          bottom: rect.bottom,
                          right: rect.right,
                        },
                      });
                    }}
                    className="h-6 w-6 rounded-lg flex items-center justify-center text-text-muted hover:text-accent hover:bg-surface-active transition-colors"
                    title={t("sidebar.moreActions")}
                    aria-label={t("sidebar.moreActions")}
                    aria-haspopup="menu"
                    aria-expanded={isMenuOpen}
                  >
                    <MoreHorizontal className="h-3 w-3" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderSessionList = (groupKey: string, groupSessions: Session[]) => {
    const visibleCount = resolveSessionVisibleCount(groupKey, groupSessions);
    const pinnedSessions = groupSessions.filter((session) =>
      pinnedSessionIds.has(session.id),
    );
    const unpinnedSessions = groupSessions.filter(
      (session) => !pinnedSessionIds.has(session.id),
    );
    const visibleUnpinnedCount = normalizedQuery
      ? unpinnedSessions.length
      : Math.max(visibleCount - pinnedSessions.length, 0);
    const visibleSessions = normalizedQuery
      ? groupSessions
      : [...pinnedSessions, ...unpinnedSessions.slice(0, visibleUnpinnedCount)];
    const hiddenCount = Math.max(
      0,
      unpinnedSessions.length - visibleUnpinnedCount,
    );
    const nextBatchCount = Math.min(DEFAULT_VISIBLE_SESSIONS, hiddenCount);
    const defaultUnpinnedCount = Math.max(
      DEFAULT_VISIBLE_SESSIONS - pinnedSessions.length,
      0,
    );
    const canShowLess = visibleUnpinnedCount > defaultUnpinnedCount;

    return (
      <>
        {visibleSessions.map((session) => renderSessionItem(session, true))}
        {!normalizedQuery && (hiddenCount > 0 || canShowLess) && (
          <div className="flex items-center">
            {hiddenCount > 0 && (
              <button
                type="button"
                onClick={() => {
                  requestSectionMotion(groupKey);
                  setSessionVisibleCount(
                    groupKey,
                    Math.max(visibleCount, pinnedSessions.length) +
                      nextBatchCount,
                  );
                }}
                className={`${SESSION_OVERFLOW_BUTTON_CLASS} flex-1 text-left`}
              >
                {t("sidebar.showMoreSessions", { count: nextBatchCount })}
              </button>
            )}
            {canShowLess && (
              <button
                type="button"
                onClick={() => {
                  requestSectionMotion(groupKey);
                  setSessionVisibleCount(groupKey, DEFAULT_VISIBLE_SESSIONS);
                }}
                className={`${SESSION_OVERFLOW_BUTTON_CLASS} ml-auto flex-shrink-0 text-right`}
              >
                {t("sidebar.showLessSessions")}
              </button>
            )}
          </div>
        )}
      </>
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

            <div
              ref={scrollListRef}
              onScroll={() => setSessionMenu(null)}
              className="flex-1 overflow-y-auto px-3 py-4 sidebar-scroll"
            >
              <div>
                <section>
                  <button
                    type="button"
                    aria-expanded={ordinarySessionsExpanded}
                    aria-label={t(
                      ordinarySessionsExpanded
                        ? "sidebar.collapseSessions"
                        : "sidebar.expandSessions",
                    )}
                    disabled={Boolean(normalizedQuery)}
                    onClick={() => {
                      requestSectionMotion(ORDINARY_SESSION_GROUP_KEY);
                      const nextExpanded = !ordinarySessionsExpanded;
                      setProjectExpanded(
                        ORDINARY_SESSION_GROUP_KEY,
                        nextExpanded,
                      );
                      if (!nextExpanded) {
                        setSessionVisibleCount(
                          ORDINARY_SESSION_GROUP_KEY,
                          DEFAULT_VISIBLE_SESSIONS,
                        );
                      }
                    }}
                    className="w-full rounded-lg px-3 py-1 flex items-center gap-1.5 text-sm font-medium leading-5 text-text-primary hover:bg-surface-hover transition-colors disabled:cursor-default disabled:hover:bg-transparent"
                  >
                    <SidebarGroupIcon
                      kind="sessions"
                      expanded={ordinarySessionsExpanded}
                      motionVersion={
                        sectionMotionVersions.get(ORDINARY_SESSION_GROUP_KEY) ??
                        0
                      }
                      showRunningBadge={runningGroupKeys.has(
                        ORDINARY_SESSION_GROUP_KEY,
                      )}
                    />
                    <span>{t("sidebar.allSessions")}</span>
                  </button>
                  <SidebarAnimatedSection
                    expanded={ordinarySessionsExpanded}
                    motionVersion={
                      sectionMotionVersions.get(ORDINARY_SESSION_GROUP_KEY) ?? 0
                    }
                  >
                    {renderSessionList(
                      ORDINARY_SESSION_GROUP_KEY,
                      sessionGroups.unscopedSessions,
                    )}
                  </SidebarAnimatedSection>
                </section>

                {sessionGroups.projectGroups.map((group, projectIndex) => {
                  const isProjectExpanded = resolveProjectExpanded(
                    group.key,
                    projectIndex,
                    group.sessions,
                  );
                  const isProjectPinned = pinnedProjectKeys.has(group.key);

                  return (
                    <section key={group.key} className="pt-1.5">
                      <div
                        className="group/project flex items-center justify-between"
                        title={group.cwd}
                      >
                        <button
                          type="button"
                          aria-expanded={isProjectExpanded}
                          aria-label={t(
                            isProjectExpanded
                              ? "sidebar.collapseProject"
                              : "sidebar.expandProject",
                            { projectName: group.name },
                          )}
                          disabled={Boolean(normalizedQuery)}
                          onClick={() => {
                            requestSectionMotion(group.key);
                            const nextExpanded = !isProjectExpanded;
                            setProjectExpanded(group.key, nextExpanded);
                            if (!nextExpanded) {
                              setSessionVisibleCount(
                                group.key,
                                DEFAULT_VISIBLE_SESSIONS,
                              );
                            }
                          }}
                          className="min-w-0 flex-1 rounded-lg px-3 py-1.5 flex items-center gap-1.5 text-sm font-medium leading-5 text-text-primary hover:bg-surface-hover transition-colors disabled:cursor-default disabled:hover:bg-transparent"
                        >
                          <SidebarGroupIcon
                            kind="project"
                            expanded={isProjectExpanded}
                            motionVersion={
                              sectionMotionVersions.get(group.key) ?? 0
                            }
                            showRunningBadge={runningGroupKeys.has(group.key)}
                          />
                          <span className="truncate">{group.name}</span>
                          <span className="ml-auto text-xs font-normal text-text-muted opacity-0 transition-opacity group-hover/project:opacity-100">
                            {group.sessions.length}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleNewSessionInProject(group.cwd);
                          }}
                          className="h-8 w-8 flex-shrink-0 rounded-lg text-text-muted hover:bg-accent/10 hover:text-accent transition-colors flex items-center justify-center opacity-0 pointer-events-none group-hover/project:opacity-100 group-hover/project:pointer-events-auto"
                          title={t("sidebar.newSessionForProject")}
                          aria-label={t("sidebar.newSessionForProject")}
                        >
                          <SquarePen className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={(event) =>
                            handleToggleProjectPin(event, group.key)
                          }
                          className={`h-8 w-8 flex-shrink-0 rounded-lg transition-[opacity,color,background-color] flex items-center justify-center ${
                            isProjectPinned
                              ? "opacity-100 text-accent hover:bg-accent/10"
                              : "opacity-0 pointer-events-none text-text-muted hover:bg-accent/10 hover:text-accent group-hover/project:opacity-100 group-hover/project:pointer-events-auto"
                          }`}
                          title={t(
                            isProjectPinned ? "sidebar.unpin" : "sidebar.pin",
                          )}
                          aria-label={t(
                            isProjectPinned ? "sidebar.unpin" : "sidebar.pin",
                          )}
                        >
                          <Pin
                            className={`h-3.5 w-3.5 ${isProjectPinned ? "fill-current" : ""}`}
                          />
                        </button>
                      </div>
                      <SidebarAnimatedSection
                        expanded={isProjectExpanded}
                        motionVersion={
                          sectionMotionVersions.get(group.key) ?? 0
                        }
                      >
                        {renderSessionList(group.key, group.sessions)}
                      </SidebarAnimatedSection>
                    </section>
                  );
                })}

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
      {sessionMenu &&
        sessionMenuSession &&
        createPortal(
          <div
            role="menu"
            onClick={(event) => event.stopPropagation()}
            className="fixed z-50 w-36 rounded-lg border border-border-muted bg-background p-1 shadow-lg"
            style={{
              left: Math.max(8, sessionMenu.anchor.right - 144),
              ...(window.innerHeight - sessionMenu.anchor.bottom >= 88
                ? { top: sessionMenu.anchor.bottom + 4 }
                : { bottom: window.innerHeight - sessionMenu.anchor.top + 4 }),
            }}
          >
            <button
              type="button"
              role="menuitem"
              onClick={(event) => {
                handleToggleSessionPin(event, sessionMenuSession.id);
                setSessionMenu(null);
              }}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-text-primary transition-colors hover:bg-surface-hover"
            >
              {pinnedSessionIds.has(sessionMenuSession.id) ? (
                <PinOff className="h-3.5 w-3.5 text-text-muted" />
              ) : (
                <Pin className="h-3.5 w-3.5 text-text-muted" />
              )}
              <span>
                {t(
                  pinnedSessionIds.has(sessionMenuSession.id)
                    ? "sidebar.unpin"
                    : "sidebar.pin",
                )}
              </span>
            </button>
            {sessionMenuSession.status !== "running" && (
              <>
                <div className="mx-1 my-1 border-t border-border-muted" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={(event) => {
                    setSessionMenu(null);
                    handleDeleteSession(event, sessionMenuSession);
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-error transition-colors hover:bg-surface-hover"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>{t("common.delete")}</span>
                </button>
              </>
            )}
          </div>,
          document.body,
        )}
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

interface SessionMenuState {
  sessionId: string;
  anchor: {
    top: number;
    bottom: number;
    right: number;
  };
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function loadSidebarPins(): SidebarPins {
  try {
    const raw = localStorage.getItem(SIDEBAR_PINS_STORAGE_KEY);
    if (!raw) return { sessionIds: [], projectKeys: [] };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return { sessionIds: [], projectKeys: [] };
    }
    const record = parsed as Record<string, unknown>;
    return {
      sessionIds: stringArray(record.sessionIds),
      projectKeys: stringArray(record.projectKeys),
    };
  } catch {
    return { sessionIds: [], projectKeys: [] };
  }
}

function saveSidebarPins(pins: SidebarPins): void {
  try {
    localStorage.setItem(SIDEBAR_PINS_STORAGE_KEY, JSON.stringify(pins));
  } catch {
    // Keep the in-memory pin state when storage is unavailable.
  }
}

function toggleOrderedId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id];
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
