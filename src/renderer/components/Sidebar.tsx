import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../store";
import { ConfirmDialog } from "./ConfirmDialog";
import { OccludingDialog } from "./ui/occluding-dialog";
import { DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import { useIPC } from "../hooks/useIPC";
import { useOpenSession } from "../hooks/useOpenSession";
import {
  Trash2,
  Search as SearchIcon,
  Check,
  Undo2,
  Folder,
  Archive,
  ChevronDown,
  MoreHorizontal,
  SquarePen,
  Pin,
  PinOff,
  Mic,
  CircleHelp,
  FolderPlus,
  FolderOpen,
} from "lucide-react";
import { panelWidthTransitionClass } from "../utils/panel-width";
import {
  SidebarAnimatedSection,
  SidebarGroupIcon,
} from "./sidebar-disclosure-motion";
import type { Session } from "../types";
import {
  DEFAULT_WORKDIR_DIRNAME,
  toWorkspaceKey,
} from "../../shared/workspace-path";
import {
  buildSidebarSessionGroups,
  isSessionBusy,
  splitSunkSessions,
  type SidebarPins,
  type SidebarProjectGroup,
} from "../utils/sidebar-session-groups";
import { Tooltip, TooltipContent, TooltipTrigger } from "./app-tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Input } from "./ui/input";
import { Button } from "./app-button";

const DEFAULT_VISIBLE_SESSIONS = 5;
const DEFAULT_EXPANDED_PROJECTS = 3;
const ORDINARY_SESSION_GROUP_KEY = "__ordinary_sessions__";
/** 「项目」外层折叠行的持久化 key；内层各项目仍用各自 cwd 作 key。 */
const PROJECTS_GROUP_KEY = "__projects__";
const SIDEBAR_PINS_STORAGE_KEY = "deskwand.sidebarPins";
const SIDEBAR_GROUP_EXPANSION_STORAGE_KEY = "deskwand.sidebarGroupExpansion";
// 展开更多按所属列表设置左内边距；收起按钮保留原有左右留白。
const SESSION_OVERFLOW_BUTTON_CLASS =
  "rounded-lg bg-transparent pr-3 py-1.5 text-xs text-muted-foreground hover:bg-transparent hover:text-muted-foreground focus-visible:bg-transparent focus-visible:text-muted-foreground transition-colors";

export function Sidebar({
  width = 280,
  dragging = false,
}: {
  width?: number;
  /**
   * 拖动分隔条期间为 true。此时必须去掉宽度过渡，否则面板会滞后 300ms，
   * 松手后还要自己滑一段才停 —— 折叠/展开仍然要保留过渡。
   */
  dragging?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const sessions = useAppStore((s) => s.sessions);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const sessionStates = useAppStore((s) => s.sessionStates);
  const pendingAskUsers = useAppStore((s) => s.pendingAskUsers);
  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const workingDir = useAppStore((s) => s.workingDir);
  const setWorkingDir = useAppStore((s) => s.setWorkingDir);
  const startNewSession = useAppStore((s) => s.startNewSession);
  const openSessionSearch = useAppStore((s) => s.openSessionSearch);
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const setShowSettings = useAppStore((s) => s.setShowSettings);
  const setShowSchedule = useAppStore((s) => s.setShowSchedule);
  const setShowApps = useAppStore((s) => s.setShowApps);
  const setGlobalNotice = useAppStore((s) => s.setGlobalNotice);

  const {
    invoke,
    deleteSession,
    deleteProject,
    renameSession,
    archiveSession,
    setSessionCompleted,
    changeWorkingDir,
    createProject,
    isElectron,
  } = useIPC();
  const openSessionById = useOpenSession();

  const [projectExpansionOverrides, setProjectExpansionOverrides] = useState(
    () => loadGroupExpansion(),
  );
  const [sessionVisibleCountOverrides, setSessionVisibleCountOverrides] =
    useState(() => new Map<string, number>());
  const [sectionMotionVersions, setSectionMotionVersions] = useState(
    () => new Map<string, number>(),
  );
  const [sidebarPins, setSidebarPins] = useState<SidebarPins>(loadSidebarPins);
  const [showProjectActions, setShowProjectActions] = useState(false);
  const [sessionMenu, setSessionMenu] = useState<string | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingSessionTitle, setEditingSessionTitle] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);

  useEffect(() => {
    saveSidebarPins(sidebarPins);
  }, [sidebarPins]);

  useEffect(() => {
    saveGroupExpansion(projectExpansionOverrides);
  }, [projectExpansionOverrides]);

  // ⚠️ 同一个坑 ✓：原实现在 `showProjectActions` 打开时挂 document 的 click 监听来自关 ✗
  // —— 迁到 Radix 后由 `DropdownMenuContent` 负责 ✓（否则菜单刚打开就被那次 click 关掉 ✗✗，
  // 会话菜单那边正是如此，定位花了六轮 ✓）。

  // ⚠️ 原实现在 `sessionMenu` 打开时挂 document 上的 click/Escape/resize 监听来关自己 ✗
  // —— 迁到 Radix 后这些**全部由 `DropdownMenuContent` 负责** ✓（点外部、Esc、滚动/resize，
  // 而且还会把焦点还给触发器 ✓）。保留它会让菜单**刚打开就被那次 click 关掉** ✗✗
  //（实测：`stored=null`、`aria-expanded=false` ✓ —— 定位这个 bug 花了六轮 ✓）。

  const [hoveredSessionId, setHoveredSessionId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{
    message: string;
    detail?: string;
    onConfirm: () => void;
  } | null>(null);
  const [createProjectModalOpen, setCreateProjectModalOpen] = useState(false);
  // occluding 由弹窗各自取用：删除确认走 ConfirmDialog（内部 OccludingAlertDialog），
  // 新建项目走 OccludingDialog。迁移前这里是一句
  // `useBrowserOcclusion(Boolean(deleteConfirm) || createProjectModalOpen)` ——
  // 那种把两个弹窗的可见性 OR 起来喂给一个 hook 的写法，正是设计文档说
  // 「引用计数会溶解它」的地方。
  const [projectName, setProjectName] = useState("");
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const scrollListRef = useRef<HTMLDivElement>(null);

  // Exclude archived sessions from normal display
  const activeSessions = useMemo(
    () => sessions.filter((s) => !s.archived),
    [sessions],
  );
  const sessionGroups = useMemo(
    () => buildSidebarSessionGroups(sessions, "", sidebarPins),
    [sessions, sidebarPins],
  );
  const sessionHasPendingAskUser = useCallback(
    (sessionId: string) =>
      Object.values(pendingAskUsers).some((r) => r.sessionId === sessionId),
    [pendingAskUsers],
  );
  const runningGroupKeys = useMemo(() => {
    const keys = new Set<string>();
    if (
      sessionGroups.unscopedSessions.some((s) =>
        isSessionBusy(
          s,
          sessionStates[s.id]?.backgroundAgents,
          sessionHasPendingAskUser(s.id),
        ),
      )
    ) {
      keys.add(ORDINARY_SESSION_GROUP_KEY);
    }
    for (const group of sessionGroups.projectGroups) {
      if (
        group.sessions.some((s) =>
          isSessionBusy(
            s,
            sessionStates[s.id]?.backgroundAgents,
            sessionHasPendingAskUser(s.id),
          ),
        )
      ) {
        keys.add(group.key);
      }
    }
    return keys;
  }, [sessionGroups, sessionStates, sessionHasPendingAskUser]);

  // 组内有待答提问 → 该组角标走 asking。只读 pending 这个事实，
  // 不动 runningGroupKeys 的算法。
  const askingGroupKeys = useMemo(() => {
    const keys = new Set<string>();
    if (
      sessionGroups.unscopedSessions.some((s) => sessionHasPendingAskUser(s.id))
    ) {
      keys.add(ORDINARY_SESSION_GROUP_KEY);
    }
    for (const group of sessionGroups.projectGroups) {
      if (group.sessions.some((s) => sessionHasPendingAskUser(s.id))) {
        keys.add(group.key);
      }
    }
    return keys;
  }, [sessionGroups, sessionHasPendingAskUser]);

  // 角标种类：组内有一条在等回答就 asking，否则才轮到 running。
  // 与下面的 resolveProjectExpanded 一样是 render 期普通函数，不包 useCallback。
  const badgeKindFor = (key: string): "asking" | "running" | null =>
    askingGroupKeys.has(key)
      ? "asking"
      : runningGroupKeys.has(key)
        ? "running"
        : null;

  // 「项目」根行：任一项目在等回答就 asking，否则任一项目在跑就 running
  let projectsRootBadgeKind: "asking" | "running" | null = null;
  for (const group of sessionGroups.projectGroups) {
    const groupKind = badgeKindFor(group.key);
    if (groupKind === "asking") {
      projectsRootBadgeKind = "asking";
      break;
    }
    if (groupKind === "running") projectsRootBadgeKind = "running";
  }

  const pinnedSessionIds = useMemo(
    () => new Set(sidebarPins.sessionIds),
    [sidebarPins.sessionIds],
  );
  const pinnedProjectKeys = useMemo(
    () => new Set(sidebarPins.projectKeys),
    [sidebarPins.projectKeys],
  );

  useEffect(() => {
    if (!activeSessionId) return;
    const raf = requestAnimationFrame(() => {
      scrollListRef.current
        ?.querySelector(`[data-session-id="${activeSessionId}"]`)
        ?.scrollIntoView({ block: "nearest" });
    });
    return () => cancelAnimationFrame(raf);
  }, [activeSessionId]);

  const resolveProjectExpanded = (
    groupKey: string,
    projectIndex: number,
    projectSessions: Session[],
  ): boolean => {
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
    // 「最近」默认展开：它是会话列表的主入口
    return projectExpansionOverrides.get(ORDINARY_SESSION_GROUP_KEY) ?? true;
  };

  const resolveProjectsExpanded = (): boolean => {
    const override = projectExpansionOverrides.get(PROJECTS_GROUP_KEY);
    if (override !== undefined) return override;
    // 默认收起；但当前会话落在某个项目里时必须展开，
    // 否则高亮会话在侧栏里根本不可见。
    if (!activeSessionId) return false;
    return sessionGroups.projectGroups.some((group) =>
      group.sessions.some((session) => session.id === activeSessionId),
    );
  };

  const ordinarySessionsExpanded = resolveOrdinarySessionsExpanded();
  const projectsExpanded = resolveProjectsExpanded();

  const resolveSessionVisibleCount = (
    groupKey: string,
    groupSessions: Session[],
  ): number => {
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
      setShowApps(false);
      if (activeSessionId === sessionId) return;

      // 预载失败时不切换（见 useOpenSession）；这里得说一声，
      // 否则「点了没反应」且日志里也没有痕迹。
      const opened = await openSessionById(sessionId);
      if (!opened) {
        setGlobalNotice({
          id: `notice-session-open-failed-${Date.now()}`,
          type: "error",
          message: t("sidebar.openSessionFailed"),
        });
      }
    },
    [
      activeSessionId,
      openSessionById,
      setGlobalNotice,
      setShowApps,
      setShowSettings,
      setShowSchedule,
      t,
    ],
  );

  const handleNewSession = useCallback(() => {
    setActiveSession(null);
    setShowSettings(false);
    setShowSchedule(false);
    setShowApps(false);
  }, [setActiveSession, setShowSettings, setShowSchedule, setShowApps]);

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

  const beginRenameSession = useCallback((session: Session) => {
    setSessionMenu(null);
    setEditingSessionId(session.id);
    setEditingSessionTitle(session.title);
  }, []);

  const cancelRenameSession = useCallback(() => {
    setEditingSessionId(null);
    setEditingSessionTitle("");
  }, []);

  const commitRenameSession = useCallback(
    async (session: Session) => {
      if (isRenaming || editingSessionId !== session.id) return;
      const nextTitle = editingSessionTitle.trim();
      if (!nextTitle) {
        cancelRenameSession();
        return;
      }

      setIsRenaming(true);
      try {
        const result = await renameSession(session.id, nextTitle);
        if (!result.success) {
          cancelRenameSession();
          setGlobalNotice({
            id: `notice-session-rename-${Date.now()}`,
            type: "error",
            message: t("sidebar.renameFailed"),
          });
          return;
        }
        cancelRenameSession();
      } catch {
        cancelRenameSession();
        setGlobalNotice({
          id: `notice-session-rename-${Date.now()}`,
          type: "error",
          message: t("sidebar.renameFailed"),
        });
      } finally {
        setIsRenaming(false);
      }
    },
    [
      cancelRenameSession,
      editingSessionId,
      editingSessionTitle,
      isRenaming,
      renameSession,
      setGlobalNotice,
      t,
    ],
  );

  useEffect(() => {
    if (
      editingSessionId &&
      !sessions.some((session) => session.id === editingSessionId)
    ) {
      cancelRenameSession();
    }
  }, [cancelRenameSession, editingSessionId, sessions]);

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

  const handleDeleteProject = useCallback(
    (group: SidebarProjectGroup) => {
      // 计数口径必须与「实际会被停掉的会话」一致：遍历 activeSessions
      // 而不是渲染出来的 group.sessions —— 后者只是分组快照，别把它当成事实来源。
      // 判定用 isSessionBusy（运行中 / 有后台子代理 / 在等 ask_user），
      // 这三类在删除时都会被 stopSession 打断。
      const activeCount = activeSessions.filter((s) => {
        const sessionCwd = s.cwd;
        if (!sessionCwd) return false;
        return (
          toWorkspaceKey(sessionCwd) === group.key &&
          isSessionBusy(
            s,
            sessionStates[s.id]?.backgroundAgents,
            sessionHasPendingAskUser(s.id),
          )
        );
      }).length;

      // 「是否回欢迎页」在点击这一刻就定下来：确认后 removeSessions 已把活跃会话
      // 清空，那时再去问 store 永远得不到答案。
      const previousActiveSessionId = activeSessionId;

      setDeleteConfirm({
        message: t("sidebar.deleteProjectConfirmWithName", {
          name: group.name,
        }),
        detail:
          activeCount > 0
            ? t("sidebar.deleteProjectRunningHint", { count: activeCount })
            : undefined,
        onConfirm: async () => {
          try {
            const result = await deleteProject(group.cwd);
            if (!result.success) {
              setGlobalNotice({
                id: `notice-project-delete-failed-${Date.now()}`,
                type: "error",
                message: result.error || t("sidebar.deleteProjectFailed"),
              });
              return;
            }

            if (
              previousActiveSessionId &&
              result.deletedSessionIds.includes(previousActiveSessionId)
            ) {
              handleNewSession();
            }

            setSidebarPins((current) => ({
              ...current,
              projectKeys: current.projectKeys.filter((k) => k !== group.key),
            }));
            setProjectExpansionOverrides((current) => {
              const next = new Map(current);
              next.delete(group.key);
              return next;
            });
            setSessionVisibleCountOverrides((current) => {
              const next = new Map(current);
              next.delete(group.key);
              return next;
            });
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
    [
      activeSessionId,
      activeSessions,
      deleteProject,
      handleNewSession,
      sessionHasPendingAskUser,
      sessionStates,
      setGlobalNotice,
      t,
    ],
  );

  const renderSessionItem = (
    session: Session,
    showRelativeTime: boolean,
    isProjectSession = false,
    showCompletedMark = true,
  ) => {
    const isActive = activeSessionId === session.id;
    const hasPendingAskUser = sessionHasPendingAskUser(session.id);
    const hasStatusIndicator = isSessionBusy(
      session,
      sessionStates[session.id]?.backgroundAgents,
      hasPendingAskUser,
    );
    const isPinned = pinnedSessionIds.has(session.id);
    const isHovered = hoveredSessionId === session.id;
    const isMenuOpen = sessionMenu === session.id;
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
        }}
        className={`group relative min-h-8 rounded-lg pr-2.5 py-1.5 transition-colors ${
          isProjectSession ? "pl-9" : "pl-3"
        } ${isActive ? "bg-accent" : "hover:bg-accent/60"}`}
      >
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1 flex items-center gap-2">
            {session.kind === "voice" ? (
              <Mic
                className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                aria-label={t("voiceMode.sessionLabel")}
              />
            ) : null}
            {editingSessionId === session.id ? (
              <Input
                autoFocus
                maxLength={50}
                value={editingSessionTitle}
                disabled={isRenaming}
                onChange={(event) => setEditingSessionTitle(event.target.value)}
                onClick={(event) => event.stopPropagation()}
                onFocus={(event) => event.currentTarget.select()}
                onBlur={() => void commitRenameSession(session)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    cancelRenameSession();
                  } else if (event.key === "Enter") {
                    event.preventDefault();
                    event.currentTarget.blur();
                  }
                }}
                className="min-w-0 flex-1 rounded-md border border-border/60 bg-background px-1.5 py-0.5 text-sm text-foreground outline-none focus:border-primary"
                aria-label={t("sidebar.rename")}
              />
            ) : (
              <div
                className={`text-sm font-normal leading-5 truncate flex-1 ${
                  isActive
                    ? "text-foreground"
                    : session.completedAt && showCompletedMark
                      ? "text-muted-foreground/60"
                      : "text-muted-foreground"
                }`}
              >
                {session.title}
              </div>
            )}
            {/* 置顶不再有看得见的标记（和项目行一致），但状态不能只剩「排在最前面」
                这一条线索 ⇒ 给读屏留一句（`sr-only` 不占位，视觉上依旧什么都没有）✓。 */}
            {isPinned && <span className="sr-only">{t("sidebar.pinned")}</span>}
            {showRelativeTime && (
              <div className="ml-auto h-6 w-[4.5rem] flex-shrink-0 relative">
                {/* 尾槽只有一条基准线：相对时间文字的右缘（= 行右缘内缩 10px）✓。
                    标记格是 16px 宽的盒子，若把 10px 状态点 **居中**，它的墨迹会自己
                    内缩 3px ⇒ 和上下行的时间错开 ✗（2026-10-11 报障图里那列点比时间
                    靠左就是这么来的 ✓）⇒ `justify-end` 把盒子的右缘交回那条线 ✓。
                    置顶不再占这一格（和项目行一致）：置顶的会话照常显示相对时间 ✓。
                    「已完成」占这一格（它没有别的落点）；它和运行中一样用 `justify-end`
                    把墨迹交回那条线，颜色走中性的 `text-muted-foreground`（不是成功色）。 */}
                <div
                  className={`absolute inset-0 flex items-center justify-end transition-opacity ${
                    showSessionActions
                      ? "opacity-0 pointer-events-none"
                      : "opacity-100"
                  }`}
                >
                  {hasStatusIndicator ? (
                    <span
                      className="h-4 w-4 flex items-center justify-end"
                      role="status"
                      aria-label={t(
                        hasPendingAskUser
                          ? "sidebar.asking"
                          : "sidebar.running",
                      )}
                    >
                      {hasPendingAskUser ? (
                        <CircleHelp
                          aria-hidden="true"
                          className="h-3.5 w-3.5 text-primary-text"
                        />
                      ) : (
                        <span className="h-2.5 w-2.5 rounded-full bg-primary animate-pulse" />
                      )}
                    </span>
                  ) : session.completedAt && showCompletedMark ? (
                    <span
                      className="h-4 w-4 flex items-center justify-end text-muted-foreground"
                      role="img"
                      aria-label={t("sidebar.completed")}
                    >
                      <Check aria-hidden="true" className="h-3.5 w-3.5" />
                    </span>
                  ) : (
                    <span className="text-sm leading-5 text-muted-foreground whitespace-nowrap">
                      {formatRelativeTime(
                        session.updatedAt || session.createdAt,
                        t,
                        i18n.language,
                      )}
                    </span>
                  )}
                </div>

                {/* 动作键是 24px 槽（`size="iconXs"`）里装 16px 图标 ⇒ 图标左右各有 4px
                    内缩 ✗，直接右对齐会让悬停时那颗「更多」落在基准线左边 4px 处 ✓
                    ⇒ 整行右移同样的 4px（`-mr-1`），图标格的右缘才回到上面那条线上 ✓。
                    越出去的是行的右内边距（10px），没越过行的边界，也不会撑出横向滚动 ✓。 */}
                <div
                  className={`absolute inset-0 -mr-1 flex items-center justify-end transition-opacity ${
                    showSessionActions
                      ? "opacity-100"
                      : "opacity-0 pointer-events-none"
                  }`}
                >
                  <Button
                    variant="ghost"
                    type="button"
                    size="iconXs"
                    aria-pressed={Boolean(session.completedAt)}
                    onClick={(event) => {
                      event.stopPropagation();
                      setSessionCompleted(session.id, !session.completedAt);
                    }}
                    className="rounded-lg flex items-center justify-center text-muted-foreground hover:text-primary-text hover:bg-accent transition-colors"
                    title={
                      session.completedAt
                        ? t("sidebar.markIncomplete")
                        : t("sidebar.markComplete")
                    }
                    aria-label={
                      session.completedAt
                        ? t("sidebar.markIncomplete")
                        : t("sidebar.markComplete")
                    }
                  >
                    {session.completedAt ? (
                      <Undo2 className="h-3 w-3" />
                    ) : (
                      <Check className="h-3 w-3" />
                    )}
                  </Button>
                  <DropdownMenu
                    open={sessionMenu === session.id}
                    onOpenChange={(next: boolean) => {
                      setSessionMenu(next ? session.id : null);
                    }}
                  >
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            type="button"
                            size="iconXs"
                            className="rounded-lg flex items-center justify-center text-muted-foreground hover:text-primary-text hover:bg-accent transition-colors"
                            aria-label={t("sidebar.moreActions")}
                          >
                            <MoreHorizontal className="h-3 w-3" />
                          </Button>
                        </DropdownMenuTrigger>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">
                        {t("sidebar.moreActions")}
                      </TooltipContent>
                    </Tooltip>
                    <DropdownMenuContent
                      align="end"
                      className="w-36"
                      // ⚠️ 同一个坑 ✓：菜单项里有「删除」→ 它打开 `ConfirmDialog` ✓，
                      // 而 Radix 在菜单关闭时会把焦点**归还给触发器** ✗ → 抢走对话框的焦点 ✓。
                      //（项目菜单那边实测过 ✓：`activeElement` 是那颗 chevron ✗。）
                      onCloseAutoFocus={(event) => event.preventDefault()}
                    >
                      <DropdownMenuItem
                        className="h-7 gap-2"
                        onClick={(event) => {
                          handleToggleSessionPin(event, session.id);
                          setSessionMenu(null);
                        }}
                      >
                        {pinnedSessionIds.has(session.id) ? (
                          <PinOff className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <Pin className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span>
                          {t(
                            pinnedSessionIds.has(session.id)
                              ? "sidebar.unpin"
                              : "sidebar.pin",
                          )}
                        </span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="h-7 gap-2"
                        onClick={() => {
                          setSessionMenu(null);
                          setSessionCompleted(session.id, !session.completedAt);
                        }}
                      >
                        {session.completedAt ? (
                          <Undo2 className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <Check className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span>
                          {t(
                            session.completedAt
                              ? "sidebar.markIncomplete"
                              : "sidebar.markComplete",
                          )}
                        </span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="h-7 gap-2"
                        onClick={() => beginRenameSession(session)}
                      >
                        <SquarePen className="h-4 w-4 text-muted-foreground" />
                        <span>{t("sidebar.rename")}</span>
                      </DropdownMenuItem>
                      {session.status !== "running" && (
                        <>
                          <DropdownMenuSeparator />
                          {!hasStatusIndicator && (
                            <DropdownMenuItem
                              className="h-7 gap-2"
                              onClick={() => {
                                setSessionMenu(null);
                                archiveSession(session.id);
                              }}
                            >
                              <Archive className="h-4 w-4 text-muted-foreground" />
                              <span>{t("sidebar.archive")}</span>
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            className="h-7 gap-2 text-destructive hover:bg-destructive/10"
                            onClick={(event) => {
                              setSessionMenu(null);
                              handleDeleteSession(event, session);
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                            <span>{t("common.delete")}</span>
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // 会话行的渲染。主排与「已完成」组各走一遍 —— 名字从 renderSessionList 让出来，
  // 内容一字不改（含置顶拆分、5 条上限、「展开更多 / 收起」）。
  const renderSessionRows = (
    groupKey: string,
    groupSessions: Session[],
    isProjectList = false,
  ) => {
    const visibleCount = resolveSessionVisibleCount(groupKey, groupSessions);
    const pinnedSessions = groupSessions.filter((session) =>
      pinnedSessionIds.has(session.id),
    );
    const unpinnedSessions = groupSessions.filter(
      (session) => !pinnedSessionIds.has(session.id),
    );
    const visibleUnpinnedCount = Math.max(
      visibleCount - pinnedSessions.length,
      0,
    );
    const visibleSessions = [
      ...pinnedSessions,
      ...unpinnedSessions.slice(0, visibleUnpinnedCount),
    ];
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
        {visibleSessions.map((session) =>
          renderSessionItem(session, true, isProjectList),
        )}
        {(hiddenCount > 0 || canShowLess) && (
          <div className="flex items-center">
            {hiddenCount > 0 && (
              <Button
                variant="ghost"
                type="button"
                onClick={() => {
                  requestSectionMotion(groupKey);
                  setSessionVisibleCount(
                    groupKey,
                    Math.max(visibleCount, pinnedSessions.length) +
                      nextBatchCount,
                  );
                }}
                className={`${SESSION_OVERFLOW_BUTTON_CLASS} flex-1 text-left ${
                  isProjectList ? "pl-9" : "pl-3"
                }`}
              >
                {t("sidebar.showMoreSessions", { count: nextBatchCount })}
              </Button>
            )}
            {/* 「收起」和上一条一样用 `pr-3` 右内边距 ⇒ 比会话行的时间（`pr-2.5`）多缩 2px ✗：
                右拉回 2px 落到同一条基准线上 ✓（「展开更多」是左对齐，不在这条线上，不动 ✓）。 */}
            {canShowLess && (
              <Button
                variant="ghost"
                type="button"
                onClick={() => {
                  requestSectionMotion(groupKey);
                  setSessionVisibleCount(groupKey, DEFAULT_VISIBLE_SESSIONS);
                }}
                className={`${SESSION_OVERFLOW_BUTTON_CLASS} pl-3 ml-auto -mr-0.5 flex-shrink-0 text-right`}
              >
                {t("sidebar.showLessSessions")}
              </Button>
            )}
          </div>
        )}
      </>
    );
  };

  const renderSessionList = (
    groupKey: string,
    groupSessions: Session[],
    isProjectList = false,
  ) => {
    // 切分只做一次、在渲染之前：主排那 5 条上限、「展开更多」的计数、
    // active 的自动展开都只看得见主排 ✓。
    const { active: runSessions, completed: completedSessions } =
      splitSunkSessions(groupSessions, {
        isBusy: (session) =>
          isSessionBusy(
            session,
            sessionStates[session.id]?.backgroundAgents,
            sessionHasPendingAskUser(session.id),
          ),
      });

    // 组头沿用折叠机制的既有 key 空间（`projectExpansionOverrides` + 那份持久化）
    const completedKey = `${groupKey}::completed`;
    // 优先级照 `resolveProjectExpanded` 抄：用户的显式开合 → 组里装着当前打开的
    // 会话就展开。
    //
    // 最后那一档是「打勾后行不能从眼前消失」的正解：把**容器**打开，而不是把行搬走。
    // 曾把这条兼进谓词（`session.id === activeSessionId ⇒ 不沉`），结果是
    // 从组里点开一条会话它就会被弹回主排 ✗ —— 成员资格不能取决于谁开着。
    // 用户显式的开合仍然优先：他真要收起一个装着活跃会话的组，就由他 ✓。
    const completedExpanded =
      projectExpansionOverrides.get(completedKey) ??
      completedSessions.some((session) => session.id === activeSessionId);

    return (
      <>
        {renderSessionRows(groupKey, runSessions, isProjectList)}
        {completedSessions.length > 0 && (
          <>
            {/* 组头 = 「展开更多」那一行的同款：纯文字、左对齐、无图标、无配套「收起」
                （再点一次就是收起）。左内边距必须自己给 —— `SESSION_OVERFLOW_BUTTON_CLASS`
                自 45d09601 起只剩 `pr-3`，已经没有左内边距可继承 ✗ */}
            <Button
              variant="ghost"
              type="button"
              aria-expanded={completedExpanded}
              onClick={() => {
                requestSectionMotion(completedKey);
                setProjectExpanded(completedKey, !completedExpanded);
              }}
              className={`${SESSION_OVERFLOW_BUTTON_CLASS} flex-1 text-left ${
                isProjectList ? "pl-9" : "pl-3"
              }`}
            >
              {t("sidebar.completedGroup", { count: completedSessions.length })}
            </Button>
            <SidebarAnimatedSection
              expanded={completedExpanded}
              motionVersion={sectionMotionVersions.get(completedKey) ?? 0}
            >
              {/* 组内全量展示，不再套一层折叠（决策 6）；`showCompletedMark=false`
                  把灰标题和尾槽勾号一起撤掉，相对时间还给这一列 ✓。
                  顺序由 `splitSunkSessions` 保持（置顶次序随原数组带走）✓。 */}
              {completedSessions.map((session) =>
                renderSessionItem(session, true, isProjectList, false),
              )}
            </SidebarAnimatedSection>
          </>
        )}
      </>
    );
  };

  return (
    <>
      <aside
        className={`group bg-muted rounded-tl-lg flex flex-col overflow-hidden flex-shrink-0 ${panelWidthTransitionClass(
          dragging,
        )} ${sidebarCollapsed ? "w-0" : ""}`}
        style={{ width: sidebarCollapsed ? 0 : `${width}px` }}
      >
        {!sidebarCollapsed && (
          <>
            {/* 顶部一行：整行「新聊天」+ 行尾 hover 才浮出的 ▾（项目下拉）+ 常驻放大镜。
                ▾ 绝对定位在整行右缘：平常用不到的三个入口不该占一行的地方，
                但 hover / 行内聚焦时必须出现，否则它们就成了隐藏功能。 */}
            <div className="px-3 pt-3 pb-1">
              <div className="flex items-center gap-1">
                <div className="group/newchat relative min-w-0 flex-1">
                  <Button
                    variant="ghost"
                    type="button"
                    onClick={() => startNewSession()}
                    className="h-8 w-full justify-start gap-2 rounded-lg px-3 text-sm font-normal text-foreground hover:bg-accent"
                  >
                    <SquarePen className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{t("sidebar.newChat")}</span>
                  </Button>
                  <DropdownMenu
                    open={showProjectActions}
                    onOpenChange={setShowProjectActions}
                  >
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        type="button"
                        aria-label={t("sidebar.projectActions")}
                        className="absolute right-0 top-0 h-8 w-6 rounded-md px-0 text-muted-foreground opacity-0 pointer-events-none transition-opacity group-hover/newchat:opacity-100 group-hover/newchat:pointer-events-auto group-focus-within/newchat:opacity-100 group-focus-within/newchat:pointer-events-auto hover:bg-primary/10 hover:text-primary-text"
                      >
                        <ChevronDown className="h-3 w-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    {/* ⚠️ 根必须同时包住触发器与内容 ✗（计划 8 ✓）。这里**没有** Tooltip ✓。
                        宽度压回原值 `w-44` ✓（Radix 默认 `w-72` ✗）。 */}
                    <DropdownMenuContent
                      align="end"
                      className="w-44"
                      // ⚠️ **实测**（探针）：点菜单项打开对话框时 ✗，Radix 在关闭时会把焦点
                      // **归还给触发器** ✓ —— 于是它**抢走了对话框输入框的焦点** ✗✗
                      //（`activeElement` 是那颗触发器 ✓）。
                      // 阻止它 ✓，对话框自己的 `autoFocus` 才能生效 ✓。
                      onCloseAutoFocus={(event) => event.preventDefault()}
                    >
                      {projectEntries.length > 0 && (
                        <>
                          <DropdownMenuLabel className="px-2.5 py-1 text-xs text-muted-foreground">
                            {t("sidebar.newSessionInProject")}
                          </DropdownMenuLabel>
                          {projectEntries.map(({ name, cwd }) => (
                            <DropdownMenuItem
                              key={cwd}
                              className="h-7 gap-2"
                              onClick={() => {
                                setShowProjectActions(false);
                                void handleNewSessionInProject(cwd);
                              }}
                            >
                              <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                              <span className="truncate">{name}</span>
                            </DropdownMenuItem>
                          ))}
                          <DropdownMenuSeparator />
                        </>
                      )}
                      <DropdownMenuItem
                        className="h-7 gap-2"
                        onClick={() => void handleNewProject()}
                      >
                        {t("sidebar.newProject")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="h-7 gap-2"
                        onClick={() => void handleOpenProject()}
                      >
                        {t("sidebar.openProject")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <Button
                  variant="ghost"
                  type="button"
                  onClick={() => openSessionSearch()}
                  aria-label={t("sidebar.searchChat")}
                  className="h-8 w-8 shrink-0 rounded-lg px-0 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <SearchIcon className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div
              ref={scrollListRef}
              onScroll={() => setSessionMenu(null)}
              className="flex-1 overflow-y-auto px-3 pt-2 pb-4 sidebar-scroll"
            >
              <div>
                <section>
                  <Button
                    variant="ghost"
                    type="button"
                    aria-expanded={ordinarySessionsExpanded}
                    aria-label={t(
                      ordinarySessionsExpanded
                        ? "sidebar.collapseSessions"
                        : "sidebar.expandSessions",
                    )}
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
                    className="w-full rounded-lg px-3 py-1 flex items-center gap-2 text-[0.8125rem] font-normal leading-5 text-muted-foreground hover:bg-accent transition-colors h-auto"
                  >
                    <SidebarGroupIcon
                      kind="sessions"
                      expanded={ordinarySessionsExpanded}
                      motionVersion={
                        sectionMotionVersions.get(ORDINARY_SESSION_GROUP_KEY) ??
                        0
                      }
                      badgeKind={badgeKindFor(ORDINARY_SESSION_GROUP_KEY)}
                    />
                    <span>{t("sidebar.recents")}</span>
                  </Button>
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

                {sessionGroups.projectGroups.length > 0 && (
                  <section className="pt-1.5">
                    {/* pr-0.5 与内层项目行同一个基准：会话行尾部那个 16px 图标格的中心距行右缘 18px，
                        这里的尾槽跟它对齐（详见下面两颗按钮的 -mr-1），hover / 聚焦时浮出的
                        按钮才和会话行的时间 / 状态点落在同一条竖线上。 */}
                    <div className="group/projects flex items-center justify-between pr-0.5">
                      <Button
                        variant="ghost"
                        type="button"
                        aria-expanded={projectsExpanded}
                        aria-label={t(
                          projectsExpanded
                            ? "sidebar.collapseProjects"
                            : "sidebar.expandProjects",
                        )}
                        onClick={() => {
                          requestSectionMotion(PROJECTS_GROUP_KEY);
                          setProjectExpanded(
                            PROJECTS_GROUP_KEY,
                            !projectsExpanded,
                          );
                        }}
                        className="min-w-0 flex-1 rounded-lg px-3 py-1 flex items-center gap-2 text-[0.8125rem] font-normal leading-5 text-muted-foreground hover:bg-accent transition-colors h-auto"
                      >
                        <SidebarGroupIcon
                          kind="project"
                          expanded={projectsExpanded}
                          motionVersion={
                            sectionMotionVersions.get(PROJECTS_GROUP_KEY) ?? 0
                          }
                          badgeKind={projectsRootBadgeKind}
                        />
                        <span className="truncate">
                          {t("sidebar.projects")}
                        </span>
                      </Button>
                      {/* 两颗都藏着（`opacity-0` 会把焦点环一起吃成透明 ⇒ 补一条
                          `group-focus-within`，键盘 Tab 进来时才看得见）。
                          内层项目行的三个动作按钮就是这个模式，这里照抄。
                          尺寸用 24² 尾槽（`iconXs`）而不是内层那 32²：这一行的折叠开关自己
                          只有 28px（`py-1` + `leading-5`），塞 32px 按钮会把分组头顶到 32px，
                          比并肩的「最近」那行高 4px。24² 盒里的图标中心比 32² 少 4px，
                          靠 `mr-1` 把那 4px 补回来，图标中心仍在行右缘内缩 18px 那条线上。 */}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            type="button"
                            size="iconXs"
                            onClick={(event) => {
                              event.stopPropagation();
                              handleNewProject();
                            }}
                            className="mr-1 flex-shrink-0 rounded-lg text-muted-foreground hover:bg-primary/10 hover:text-primary-text transition-colors flex items-center justify-center opacity-0 pointer-events-none group-hover/projects:opacity-100 group-hover/projects:pointer-events-auto group-focus-within/projects:opacity-100"
                            aria-label={t("sidebar.newProject")}
                          >
                            <FolderPlus className="h-3.5 w-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">
                          {t("sidebar.newProject")}
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            type="button"
                            size="iconXs"
                            onClick={(event) => {
                              event.stopPropagation();
                              void handleOpenProject();
                            }}
                            className="mr-1 flex-shrink-0 rounded-lg text-muted-foreground hover:bg-primary/10 hover:text-primary-text transition-colors flex items-center justify-center opacity-0 pointer-events-none group-hover/projects:opacity-100 group-hover/projects:pointer-events-auto group-focus-within/projects:opacity-100"
                            aria-label={t("sidebar.openProject")}
                          >
                            <FolderOpen className="h-3.5 w-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">
                          {t("sidebar.openProject")}
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <SidebarAnimatedSection
                      expanded={projectsExpanded}
                      motionVersion={
                        sectionMotionVersions.get(PROJECTS_GROUP_KEY) ?? 0
                      }
                    >
                      {sessionGroups.projectGroups.map(
                        (group, projectIndex) => {
                          const isProjectExpanded = resolveProjectExpanded(
                            group.key,
                            projectIndex,
                            group.sessions,
                          );
                          const isProjectPinned = pinnedProjectKeys.has(
                            group.key,
                          );

                          return (
                            <section key={group.key} className="pt-1.5">
                              {/* pr-0.5：会话行尾部那个 16px 图标格的中心距行右缘 18px，
                                  而 32px 按钮的图标中心距右缘 16px；尾部动作整体内缩 2px，
                                  hover / 聚焦时浮出的 pin 才和会话行的时间 / 状态点落在同一条竖线上。 */}
                              <div
                                className="group/project flex items-center justify-between pr-0.5"
                                title={group.cwd}
                              >
                                <Button
                                  variant="ghost"
                                  type="button"
                                  aria-expanded={isProjectExpanded}
                                  aria-label={t(
                                    isProjectExpanded
                                      ? "sidebar.collapseProject"
                                      : "sidebar.expandProject",
                                    { projectName: group.name },
                                  )}
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
                                  className="min-w-0 flex-1 rounded-lg px-3 py-1.5 flex items-center gap-2 text-sm font-normal leading-5 text-foreground hover:bg-accent transition-colors h-auto"
                                >
                                  <SidebarGroupIcon
                                    kind="project"
                                    expanded={isProjectExpanded}
                                    motionVersion={
                                      sectionMotionVersions.get(group.key) ?? 0
                                    }
                                    badgeKind={badgeKindFor(group.key)}
                                  />
                                  <span className="truncate">{group.name}</span>
                                </Button>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      type="button"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        void handleNewSessionInProject(
                                          group.cwd,
                                        );
                                      }}
                                      className="h-8 w-8 flex-shrink-0 rounded-lg text-muted-foreground hover:bg-primary/10 hover:text-primary-text transition-colors flex items-center justify-center opacity-0 pointer-events-none group-hover/project:opacity-100 group-hover/project:pointer-events-auto"
                                      aria-label={t(
                                        "sidebar.newSessionForProject",
                                      )}
                                    >
                                      <SquarePen className="h-3.5 w-3.5" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent side="bottom">
                                    {t("sidebar.newSessionForProject")}
                                  </TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      type="button"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        handleDeleteProject(group);
                                      }}
                                      className="h-8 w-8 flex-shrink-0 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors flex items-center justify-center opacity-0 pointer-events-none group-hover/project:opacity-100 group-hover/project:pointer-events-auto"
                                      aria-label={t("common.delete")}
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent side="bottom">
                                    {t("common.delete")}
                                  </TooltipContent>
                                </Tooltip>
                                {/* pin 放最后一个、静止时和「新建 / 删除」一样藏着：hover
                                    浮出，另外多一条 focus-within，键盘 Tab 进来时才看得见它
                                    （`opacity-0` 会把焦点环一起吃成透明）。图标中心与会话行的
                                    状态点/时间同一条右边线，新建/删除从它左边展开，pin 自己
                                    不会挪位。置顶不再常显 —— 排在置顶区首位本身就是标记。 */}
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      type="button"
                                      onClick={(event) =>
                                        handleToggleProjectPin(event, group.key)
                                      }
                                      className={`h-8 w-8 flex-shrink-0 rounded-lg transition-[opacity,color,background-color] flex items-center justify-center opacity-0 pointer-events-none group-hover/project:opacity-100 group-hover/project:pointer-events-auto group-focus-within/project:opacity-100 hover:bg-primary/10 ${
                                        isProjectPinned
                                          ? "text-primary-text"
                                          : "text-muted-foreground hover:text-primary-text"
                                      }`}
                                      aria-label={t(
                                        isProjectPinned
                                          ? "sidebar.unpin"
                                          : "sidebar.pin",
                                      )}
                                    >
                                      <Pin
                                        className={`h-3.5 w-3.5 ${isProjectPinned ? "fill-current" : ""}`}
                                      />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent side="bottom">
                                    {t(
                                      isProjectPinned
                                        ? "sidebar.unpin"
                                        : "sidebar.pin",
                                    )}
                                  </TooltipContent>
                                </Tooltip>
                              </div>
                              <SidebarAnimatedSection
                                expanded={isProjectExpanded}
                                motionVersion={
                                  sectionMotionVersions.get(group.key) ?? 0
                                }
                              >
                                {renderSessionList(
                                  group.key,
                                  group.sessions,
                                  true,
                                )}
                              </SidebarAnimatedSection>
                            </section>
                          );
                        },
                      )}
                    </SidebarAnimatedSection>
                  </section>
                )}

                {sessionGroups.unscopedSessions.length === 0 &&
                  sessionGroups.projectGroups.length === 0 && (
                    <div className="px-3 py-6 text-center">
                      <p className="text-sm text-muted-foreground">
                        {t("sidebar.emptyTitle")}
                      </p>
                      {activeSessions.length === 0 && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {t("sidebar.emptyHint")}
                        </p>
                      )}
                    </div>
                  )}
              </div>
            </div>

            {/* 外壳走已迁移的 ConfirmDialog（计划 4 Task 1 给它加了 description
                槽位）—— 里圈那段内联 modal-overlay 本来就是这个原语的重复实现，
                只多一行 detail。注意 onConfirm **不要**在这里 setDeleteConfirm(null)：
                两个设置点的 onConfirm 各自已经关了自己。 */}
            <ConfirmDialog
              isOpen={deleteConfirm !== null}
              title={deleteConfirm?.message ?? ""}
              description={deleteConfirm?.detail}
              // 「还有 N 个会话在跑」是告警，不是说明 —— 原实现用的就是 text-destructive
              descriptionTone="error"
              confirmLabel={t("sidebar.confirmDelete")}
              onConfirm={() => deleteConfirm?.onConfirm()}
              onCancel={() => setDeleteConfirm(null)}
            />

            <OccludingDialog
              open={createProjectModalOpen}
              onOpenChange={(next) => {
                // busy 时忽略一切关闭请求。
                // 原实现只挡了遮罩点击（onClick 里 `if (isCreatingProject) return`）；
                // Radix 又引入 Esc 与 DialogContent 内置的关闭键两条路径，
                // 所以守卫放在这里统一挡。
                if (!next && !isCreatingProject)
                  setCreateProjectModalOpen(false);
              }}
            >
              <DialogContent className="max-w-sm">
                <DialogTitle className="text-sm font-medium text-foreground">
                  {t("sidebar.createProjectTitle")}
                </DialogTitle>
                {/* 用已有的占位提示当描述 —— 不要复述标题，那会让读屏经
                    aria-labelledby 与 aria-describedby 把同一句念两遍。 */}
                <DialogDescription className="sr-only">
                  {t("sidebar.projectNamePlaceholder")}
                </DialogDescription>
                <Input
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
                  className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-border h-auto shadow-none"
                />
                <div className="flex items-center justify-end gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => setCreateProjectModalOpen(false)}
                    disabled={isCreatingProject}
                    className="rounded-xl px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed h-auto"
                  >
                    {t("sidebar.cancel")}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => void handleCreateProject()}
                    disabled={isCreatingProject}
                    className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed h-auto"
                  >
                    {isCreatingProject
                      ? t("common.loading")
                      : t("sidebar.newProject")}
                  </Button>
                </div>
              </DialogContent>
            </OccludingDialog>
          </>
        )}
      </aside>
      {/* ⚠️ 共享面板已删 ✗ —— 已改为**每行一个菜单** ✓（见上面那条 `DropdownMenu`）。 */}
    </>
  );
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

function loadGroupExpansion(): Map<string, boolean> {
  try {
    const raw = localStorage.getItem(SIDEBAR_GROUP_EXPANSION_STORAGE_KEY);
    if (!raw) return new Map();
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return new Map();
    }
    const entries = Object.entries(parsed as Record<string, unknown>).filter(
      ([, v]) => typeof v === "boolean",
    ) as [string, boolean][];
    return new Map(entries);
  } catch {
    return new Map();
  }
}

function saveGroupExpansion(state: Map<string, boolean>): void {
  try {
    const obj: Record<string, boolean> = {};
    state.forEach((v, k) => {
      obj[k] = v;
    });
    localStorage.setItem(
      SIDEBAR_GROUP_EXPANSION_STORAGE_KEY,
      JSON.stringify(obj),
    );
  } catch {
    // Keep the in-memory state when storage is unavailable.
  }
}

/** 新置顶的插进数组头：排序侧按下标升序（`buildRankMap`），头就是置顶区首位。 */
function toggleOrderedId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((item) => item !== id) : [id, ...ids];
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
