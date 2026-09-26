/**
 * @module main/agent/tools/todo-tools
 *
 * `todo_write` —— 会话级任务清单，全量替换语义（幂等、无 id、无需 todoread）。
 * 刻意做成无依赖的纯工具：不落库、不广播事件、不回调。清单的显示由渲染层
 * 直接从本次调用的入参渲染（见 ToolUseBlock 的 TodoWriteBlock 分支）。
 */
import {
  defineTool,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
  MAX_TODOS,
  MAX_TODO_CONTENT_LENGTH,
  rejectTodoList,
} from "../../../shared/todos";

/**
 * `details` 是必填的（`AgentToolResult` 要求），没有额外信息时传 undefined ——
 * 与 SDK 内建工具一致（dist/core/tools/ls.js:87、find.js:89）。
 * 手写 TodoItem 接口与 `as` 强转都不需要：defineTool 的推断已给出精确类型。
 */
function text(body: string) {
  return {
    content: [{ type: "text" as const, text: body }],
    details: undefined,
  };
}

export function createTodoTools(): ToolDefinition[] {
  const todoWrite = defineTool({
    name: "todo_write",
    label: "Update Task List",
    description:
      "Replace the session task list and show it to the user as a progress list. " +
      "Always send the COMPLETE list, not a delta. Use it for work with 3+ steps: " +
      "keep at most one item in_progress, mark items completed as you finish them, " +
      "and send an empty array once all work is done. " +
      'activeForm is the present-continuous form of content (content "write tests" -> ' +
      'activeForm "writing tests") and is what the user sees while that item runs. ' +
      "Use cancelled for items you decided not to do.",
    promptSnippet:
      "Track multi-step work with a visible task list; always send the complete list.",
    promptGuidelines: [
      "At most one item may be in_progress at any time.",
      "Send the full list on every call; entries omitted from the call are removed.",
      "Do not use it for a single trivial action.",
    ],
    parameters: Type.Object({
      todos: Type.Array(
        Type.Object({
          content: Type.String({ maxLength: MAX_TODO_CONTENT_LENGTH }),
          status: Type.Union([
            Type.Literal("pending"),
            Type.Literal("in_progress"),
            Type.Literal("completed"),
            Type.Literal("cancelled"),
          ]),
          activeForm: Type.Optional(
            Type.String({ maxLength: MAX_TODO_CONTENT_LENGTH }),
          ),
        }),
        { maxItems: MAX_TODOS },
      ),
    }),
    async execute(_toolCallId, params) {
      const todos = params.todos;

      // 校验规则与渲染层共用（src/shared/todos.ts）：被拒绝的清单在 UI 上会显示
      // "未生效"，不能只靠工具结果告知模型。
      const rejection = rejectTodoList(todos);
      if (rejection) {
        return text(
          rejection.reason === "emptyContent"
            ? `Rejected: item ${rejection.index + 1} has empty content.`
            : "Rejected: at most one item may be in_progress. Fix the list and call again.",
        );
      }

      if (todos.length === 0) return text("Task list cleared.");

      const done = todos.filter((item) => item.status === "completed").length;
      const active = todos.find((item) => item.status === "in_progress");
      return text(
        `Task list updated: ${done}/${todos.length} completed.` +
          (active
            ? ` Now working on: ${active.activeForm ?? active.content}`
            : ""),
      );
    },
  });

  return [todoWrite];
}
