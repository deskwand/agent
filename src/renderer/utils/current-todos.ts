/**
 * @module renderer/utils/current-todos
 *
 * 「当前生效的任务清单」的唯一纯函数实现：从消息列表**倒着**找最后一条
 * `todo_write`，被工具拒绝的清单跳过：这里复用 `src/shared/todos.ts` 的
 * `rejectTodoList(todos, done)`，所以语义级拒绝（空内容 / 多条 in_progress /
 * 声明结束却没结算）两侧判定一致。
 * schema 级限制（`MAX_TODOS`、`content` 长度）也在这里镜像（工具侧由 TypeBox 强制），
 * 理由见 `readPlan` 里的注释。历史卡片 `TodoWriteBlock` 不镜像这两条 —— 属既有差异。
 *
 * 两个调用方都用它：
 *  - 累积：每追加一条助手消息时传 `[message]`，可得"这条消息是否带来新清单"；
 *  - 重建：应用重启后 hydrate 时传整个已加载窗口。
 */
import {
  MAX_TODOS,
  MAX_TODO_CONTENT_LENGTH,
  normalizePlanDone,
  rejectTodoList,
} from "../../shared/todos";
import type { ContentBlock, Message } from "../types";
import type { TodoItem } from "../components/message/types";

export type CurrentTodos = TodoItem[];

export interface CurrentPlan {
  todos: CurrentTodos;
  /** 这次调用是否声明了「结束」。空数组上的 done 一律归一化为 false（设计 §4.1）。 */
  done: boolean;
}

const STATUSES = ["pending", "in_progress", "completed", "cancelled"] as const;

/** 结构不合格一律返回 null（模型输出不可信，宁可当没有，也不要渲染半截）。 */
function readPlan(block: ContentBlock): CurrentPlan | null {
  if (block.type !== "tool_use" || block.name !== "todo_write") return null;
  const input = block.input as Record<string, unknown> | undefined;
  const raw = input?.todos;
  if (!Array.isArray(raw)) return null;

  // schema 级限制也镜像一份：模型若发出超限清单，工具侧会被 TypeBox 拒掉，
  // UI 就不能把它当成已生效的清单 —— 否则会出现"工具拒了、界面却显示 ✓ 已完成"。
  if (raw.length > MAX_TODOS) return null;

  const items: CurrentTodos = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) return null;
    const { content, status, activeForm } = entry as Record<string, unknown>;
    if (typeof content !== "string" || typeof status !== "string") return null;
    if (content.length > MAX_TODO_CONTENT_LENGTH) return null;
    if (!STATUSES.includes(status as (typeof STATUSES)[number])) return null;
    items.push({
      content,
      status: status as TodoItem["status"],
      ...(typeof activeForm === "string" ? { activeForm } : {}),
    });
  }
  // done 只在它与清单同时出现时有含义 —— 与工具侧共用同一条归一化规则
  return { todos: items, done: normalizePlanDone(items, input?.done) };
}

/**
 * @returns 最后一次生效的清单与它的 `done` 声明；`todos: []` 表示被显式清空；
 *          `null` 表示窗口里没有生效的清单（调用方应保持不变 / 隐藏）。
 */
export function collectCurrentPlan(
  messages: readonly Message[] | undefined,
): CurrentPlan | null {
  if (!messages) return null;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const content = messages[i].content;
    for (let j = content.length - 1; j >= 0; j -= 1) {
      const plan = readPlan(content[j]);
      if (!plan) continue;
      // 被拒的清单没有生效（含"声明结束却没结算"），继续往前找上一条有效的
      if (rejectTodoList(plan.todos, plan.done)) continue;
      return plan;
    }
  }
  return null;
}
