/**
 * @module shared/todos
 *
 * 任务清单的校验规则只有一份：主进程的 `todo_write` 工具用它决定是否拒绝，
 * 渲染层的卡片用它决定是否展示"未生效"状态 —— 否则被拒绝的清单会在 UI 上
 * 冒充成已生效的清单（工具结果对用户不可见，见 tool-display-blocks 对未分组
 * 工具的处理）。
 */

const MAX_TODOS = 50;
const MAX_TODO_CONTENT_LENGTH = 200;

export { MAX_TODOS, MAX_TODO_CONTENT_LENGTH };

/** 结构足够宽松，两侧各自的 TodoItem 都能传进来，不必强行统一类型。 */
export interface TodoLike {
  content: string;
  status: string;
}

export const TODO_REJECTION_EMPTY_CONTENT = "emptyContent";
export const TODO_REJECTION_MULTIPLE_IN_PROGRESS = "multipleInProgress";

export type TodoRejection =
  | { reason: typeof TODO_REJECTION_EMPTY_CONTENT; index: number }
  | { reason: typeof TODO_REJECTION_MULTIPLE_IN_PROGRESS };

/**
 * @returns 拒绝原因，或 null 表示这份清单合法。
 */
export function rejectTodoList(
  todos: readonly TodoLike[],
): TodoRejection | null {
  const blankIndex = todos.findIndex((item) => !item.content.trim());
  if (blankIndex >= 0) {
    return { reason: TODO_REJECTION_EMPTY_CONTENT, index: blankIndex };
  }
  if (todos.filter((item) => item.status === "in_progress").length > 1) {
    return { reason: TODO_REJECTION_MULTIPLE_IN_PROGRESS };
  }
  return null;
}
