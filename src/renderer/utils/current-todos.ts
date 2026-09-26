/**
 * @module renderer/utils/current-todos
 *
 * 「当前生效的任务清单」的唯一纯函数实现：从消息列表**倒着**找最后一条
 * `todo_write`，被工具拒绝的清单跳过：这里复用 `src/shared/todos.ts` 的
 * `rejectTodoList`，所以语义级拒绝（空内容 / 多条 in_progress）两侧判定一致。
 * 注意 schema 级限制（`MAX_TODOS`、`content` 长度）不在该函数覆盖范围内，
 * 与 `TodoWriteBlock` 现状一致，这里刻意不做额外校验。
 *
 * 两个调用方都用它：
 *  - 累积：每追加一条助手消息时传 `[message]`，可得"这条消息是否带来新清单"；
 *  - 重建：应用重启后 hydrate 时传整个已加载窗口。
 */
import { rejectTodoList } from "../../shared/todos";
import type { ContentBlock, Message } from "../types";
import type { TodoItem } from "../components/message/types";

export type CurrentTodos = TodoItem[];

const STATUSES = ["pending", "in_progress", "completed", "cancelled"] as const;

/** 结构不合格一律返回 null（模型输出不可信，宁可当没有，也不要渲染半截）。 */
function readTodos(block: ContentBlock): CurrentTodos | null {
  if (block.type !== "tool_use" || block.name !== "todo_write") return null;
  const raw = (block.input as Record<string, unknown> | undefined)?.todos;
  if (!Array.isArray(raw)) return null;

  const items: CurrentTodos = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) return null;
    const { content, status, activeForm } = entry as Record<string, unknown>;
    if (typeof content !== "string" || typeof status !== "string") return null;
    if (!STATUSES.includes(status as (typeof STATUSES)[number])) return null;
    items.push({
      content,
      status: status as TodoItem["status"],
      ...(typeof activeForm === "string" ? { activeForm } : {}),
    });
  }
  return items;
}

/**
 * @returns 最后一次生效的完整清单；`[]` 表示清单被显式清空；
 *          `null` 表示窗口里没有生效的清单（调用方应保持不变 / 隐藏）。
 */
export function collectCurrentTodos(
  messages: readonly Message[] | undefined,
): CurrentTodos | null {
  if (!messages) return null;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const content = messages[i].content;
    for (let j = content.length - 1; j >= 0; j -= 1) {
      const items = readTodos(content[j]);
      if (!items) continue;
      // 被拒的清单没有生效，继续往前找上一条有效的
      if (rejectTodoList(items)) continue;
      return items;
    }
  }
  return null;
}
