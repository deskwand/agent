import {
  DEFAULT_WORKDIR_DIRNAME,
  toWorkspaceKey,
} from "../../shared/workspace-path";
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
    const key = toWorkspaceKey(cwd);
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
 * 主轮次运行中、后台子代理运行中，或有待答 ask_user 提问。
 * 注意：不能用 length > 0 —— 完成事件后代理以 done 状态保留 1 秒才移除。
 */
export function isSessionBusy(
  session: Session,
  backgroundAgents?: SidebarBackgroundAgent[],
  hasPendingAskUser?: boolean,
): boolean {
  return (
    session.status === "running" ||
    Boolean(hasPendingAskUser) ||
    (backgroundAgents?.some((agent) => agent.status === "running") ?? false)
  );
}

/** 「已完成」沉底所需的上下文。由调用方算好 —— 这个函数自己不查 store。 */
export interface SunkSessionContext {
  /** 这一条此刻还在干活吗（运行中 / 待答 ask_user / 后台子代理在跑）。 */
  isBusy: boolean;
}

/**
 * 这条会话该不该沉进「已完成」组。**两条**：有标记、现在没在干活。
 *
 * **成员资格故意不看「谁开着」。** 曾经在这里加过一条
 * `session.id === activeSessionId ⇒ 不沉`，想把「给当前会话打勾时行不能从眼前消失」
 * 兼下来 —— 结果是把两个场景当成了一个：那样一来，**从组里点开一条会话，
 * 它就会当场失去资格、被搬回主排**（用户报障）。那个需求是另一件事，
 * 由渲染侧把容器打开来兑现（`Sidebar` 的 `completedExpanded`，与本文件外面
 * `resolveProjectExpanded` / `resolveSessionVisibleCount` 同一条优先级）。
 *
 * **也不再比较时间戳。** 曾经还有一条 `sessionTime(session) <= completedAt`
 * （「标记之后又被唤起就爬回主排」）。它的洞是 `updateSessionStatus` **无条件**写
 * `updated_at`（`session-manager.ts:2292`，running 与 idle 两个转换都写），
 * 所以给**正在跑**的会话打勾时，本轮结束时必然 `updatedAt > completedAt`
 * ⇒ 那条永远沉不下去 —— 而「并行时最想收的往往就是还在跑的那个」
 * 正是这个功能的主用途。而且时间戳分不开「打勾时那一轮还在飞」与
 * 「打勾之后它才被唤醒」，两者数值上完全一样。
 *
 * 「不能让它躲在折叠堆里干活」由 `isBusy` **直接**兑现（它是当下状态，不是代理）；
 * 「你正在看的那条别消失」由组头自动展开兑现。两条代理都不需要。
 *
 * 已知取舍：旧决策 5 的「重新活跃就浮回上面」现在只剩**排序**含义 ——
 * 被唤醒过的会按 `updatedAt` 排在组内首位，而不是爬出组。
 */
export function isSunkSession(
  session: Session,
  context: SunkSessionContext,
): boolean {
  if (!session.completedAt) return false;
  return !context.isBusy;
}

/**
 * 按 `isSunkSession` 把一组会话切成「留在主排」与「收进完成组」两份。
 * 两边都保持传入顺序 —— `sortByActivity` 排好的置顶次序随原数组带走 ✓。
 */
export function splitSunkSessions(
  sessions: Session[],
  context: { isBusy: (session: Session) => boolean },
): { active: Session[]; completed: Session[] } {
  const active: Session[] = [];
  const completed: Session[] = [];
  for (const session of sessions) {
    if (isSunkSession(session, { isBusy: context.isBusy(session) })) {
      completed.push(session);
    } else {
      active.push(session);
    }
  }
  return { active, completed };
}

export interface WorkspaceProject {
  name: string;
  cwd: string;
}

/**
 * 把会话记录折成「有哪些项目」—— 供灵感页「交给 AI」的项目入口使用。
 *
 * 判定与分组共用 `isProjectSession()`：项目模式 + 有 cwd + 目录名不是默认工作目录。
 * 已归档会话在这里排除（调用方传原始 `sessions`，不必各记一套前提）。
 * 同名目录只留先出现的那条：与侧边栏项目菜单的既有口径一致（见设计文档 §8.2）。
 */
export function listWorkspaceProjects(sessions: Session[]): WorkspaceProject[] {
  const byName = new Map<string, string>();
  for (const session of sessions) {
    if (session.archived) continue;
    if (!isProjectSession(session)) continue;
    const cwd = normalizeWorkspacePath(session.cwd);
    const name = workspaceName(cwd);
    if (!byName.has(name)) byName.set(name, cwd);
  }
  return Array.from(byName, ([name, cwd]) => ({ name, cwd })).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}
