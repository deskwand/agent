import { DEFAULT_WORKDIR_DIRNAME } from "../../shared/workspace-path";
import type { Session } from "../types";

export interface SidebarProjectGroup {
  key: string;
  cwd: string;
  name: string;
  sessions: Session[];
  latestAt: number;
}

export interface SidebarSessionGroups {
  unscopedSessions: Session[];
  projectGroups: SidebarProjectGroup[];
}

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

function sortByActivity(sessions: Session[]): Session[] {
  return [...sessions].sort((a, b) => sessionTime(b) - sessionTime(a));
}

export function buildSidebarSessionGroups(
  sessions: Session[],
  query: string,
): SidebarSessionGroups {
  const normalizedQuery = query.trim().toLowerCase();
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
        sessions: sortByActivity(visibleSessions),
        latestAt: Math.max(...projectSessions.map(sessionTime)),
      };
    },
  )
    .filter(({ sessions }) => sessions.length > 0)
    .sort((a, b) => b.latestAt - a.latestAt);

  return {
    unscopedSessions: sortByActivity(unscoped),
    projectGroups,
  };
}
