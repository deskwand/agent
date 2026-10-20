import type { Session } from "../types";
import {
  buildSidebarSessionGroups,
  sessionTime,
} from "./sidebar-session-groups";

/**
 * 搜索弹窗一屏最多给几条结果。
 *
 * 这个数字同时是键盘契约的上限：行尾的 ⌘1–⌘9 提示**就是**真能按的键位，
 * 所以结果列表绝不越过 9 条 —— 多出来的喂给一个按不动的「⌘10」比截断更糟。
 */
export const SESSION_SEARCH_LIMIT = 9;

export interface SessionSearchMatch {
  session: Session;
  /** 会话所属项目名；非项目会话（默认 workspace）为 null，行内不显示标签。 */
  projectName: string | null;
}

/**
 * 按关键字挑会话：标题或项目名命中即算，归档会话不参与。
 *
 * 空关键字 = 「最近」：弹窗一打开就有东西可点。
 *
 * 匹配口径（标题子串 / 项目名整组命中）**不在这里重写**：直接借
 * `buildSidebarSessionGroups` 的查询参数，侧栏与弹窗对「命中」的定义就不会漂。
 * 它顺带做的分组与置顶排序用不上 —— 拍平后按活动时间重排，几百条会话可以忽略。
 */
export function searchSessions(
  sessions: readonly Session[],
  query: string,
): SessionSearchMatch[] {
  const groups = buildSidebarSessionGroups([...sessions], query);
  const matches: SessionSearchMatch[] = [
    ...groups.unscopedSessions.map((session) => ({
      session,
      projectName: null,
    })),
    ...groups.projectGroups.flatMap((group) =>
      group.sessions.map((session) => ({
        session,
        projectName: group.name,
      })),
    ),
  ];
  matches.sort(
    (left, right) => sessionTime(right.session) - sessionTime(left.session),
  );
  return matches.slice(0, SESSION_SEARCH_LIMIT);
}
