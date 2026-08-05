import { DEFAULT_WORKDIR_DIRNAME } from "../../shared/workspace-path";
import type { Session } from "../types";

export interface SidebarProjectGroup {
  key: string;
  cwd: string;
  name: string;
  sessions: Session[];
  earliestCreatedAt: number;
}

export interface SidebarSessionGroups {
  unscopedSessions: Session[];
  projectGroups: SidebarProjectGroup[];
}

export interface SidebarPins {
  sessionIds: string[];
  projectKeys: string[];
}

const EMPTY_SIDEBAR_PINS: SidebarPins = {
  sessionIds: [],
  projectKeys: [],
};

function sessionTime(session: Session): number {
  return session.updatedAt || session.createdAt;
}

function normalizeWorkspacePath(cwd: string): string {
  return cwd.trim().replace(/[\\/]+$/, "");
}

function workspaceKey(cwd: string): string {
  const normalized = normalizeWorkspacePath(cwd);
  const isWindowsPath =
    /^[A-Za-z]:([\\/]|$)/.test(normalized) ||
    normalized.startsWith("\\\\") ||
    normalized.startsWith("//");
  return isWindowsPath
    ? normalized.replace(/\\/g, "/").toLowerCase()
    : normalized;
}

function workspaceName(cwd: string): string {
  const segments = cwd.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] || cwd;
}

function isProjectSession(
  session: Session,
): session is Session & { cwd: string } {
  if (!session.isProjectMode || !session.cwd) return false;
  const cwd = normalizeWorkspacePath(session.cwd);
  return Boolean(cwd) && workspaceName(cwd) !== DEFAULT_WORKDIR_DIRNAME;
}

function buildRankMap(ids: readonly string[]): Map<string, number> {
  return new Map(ids.map((id, index) => [id, index]));
}

function comparePinned(
  leftKey: string,
  rightKey: string,
  ranks: ReadonlyMap<string, number>,
): number | null {
  const leftRank = ranks.get(leftKey);
  const rightRank = ranks.get(rightKey);
  if (leftRank === undefined && rightRank === undefined) return null;
  if (leftRank === undefined) return 1;
  if (rightRank === undefined) return -1;
  return leftRank - rightRank;
}

function sortByActivity(
  sessions: Session[],
  pinnedSessionRanks: ReadonlyMap<string, number>,
): Session[] {
  return [...sessions].sort((a, b) => {
    const pinnedOrder = comparePinned(a.id, b.id, pinnedSessionRanks);
    return pinnedOrder ?? sessionTime(b) - sessionTime(a);
  });
}

export function buildSidebarSessionGroups(
  sessions: Session[],
  query: string,
  pins: SidebarPins = EMPTY_SIDEBAR_PINS,
): SidebarSessionGroups {
  const normalizedQuery = query.trim().toLowerCase();
  const pinnedSessionRanks = buildRankMap(pins.sessionIds);
  const pinnedProjectRanks = buildRankMap(pins.projectKeys);
  const unscoped: Session[] = [];
  const projects = new Map<string, { cwd: string; sessions: Session[] }>();

  for (const session of sessions) {
    if (session.archived) continue;
    if (!isProjectSession(session)) {
      if (
        !normalizedQuery ||
        session.title.toLowerCase().includes(normalizedQuery)
      ) {
        unscoped.push(session);
      }
      continue;
    }

    const cwd = normalizeWorkspacePath(session.cwd);
    const key = workspaceKey(cwd);
    const group = projects.get(key) ?? { cwd, sessions: [] };
    group.sessions.push(session);
    projects.set(key, group);
  }

  const projectGroups = Array.from(
    projects.entries(),
    ([key, { cwd, sessions: projectSessions }]) => {
      const name = workspaceName(cwd);
      const projectMatches = name.toLowerCase().includes(normalizedQuery);
      const visibleSessions = projectMatches
        ? projectSessions
        : projectSessions.filter(
            (session) =>
              !normalizedQuery ||
              session.title.toLowerCase().includes(normalizedQuery),
          );
      return {
        key,
        cwd,
        name,
        sessions: sortByActivity(visibleSessions, pinnedSessionRanks),
        earliestCreatedAt: Math.min(...projectSessions.map((s) => s.createdAt)),
      };
    },
  )
    .filter(({ sessions }) => sessions.length > 0)
    .sort((a, b) => {
      const pinnedOrder = comparePinned(a.key, b.key, pinnedProjectRanks);
      return pinnedOrder ?? b.earliestCreatedAt - a.earliestCreatedAt;
    });

  return {
    unscopedSessions: sortByActivity(unscoped, pinnedSessionRanks),
    projectGroups,
  };
}

/** 后台子代理最小结构（与 store SessionState.backgroundAgents 对齐） */
export interface SidebarBackgroundAgent {
  id: string;
  type: string;
  description: string;
  status: "running" | "done";
}

/**
 * 会话是否有活跃工作需要侧栏显示"运行中"指示：
 * 主轮次运行中，或有后台子代理仍处于 running。
 * 注意：不能用 length > 0 —— 完成事件后代理以 done 状态保留 1 秒才移除。
 */
export function isSessionBusy(
  session: Session,
  backgroundAgents?: SidebarBackgroundAgent[],
): boolean {
  return (
    session.status === "running" ||
    (backgroundAgents?.some((agent) => agent.status === "running") ?? false)
  );
}
