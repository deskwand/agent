// TodoWrite 的**未生效**警告。
//
// 生效的清单不在这里渲染：它由消息区底部的任务坞承载（ChatTaskDock，2026-11-06），
// 转录里那对 tool_use / tool_result 被 buildToolDisplayBlocks 整对丢弃。留下这一条
// 是因为工具拒掉清单时状态并没有生效，而工具结果对用户不可见 —— 不在这里如实说一声，
// 「工具拒了」在界面上就是完全静默的。
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";
import { normalizePlanDone, rejectTodoList } from "../../../shared/todos";
import type { ToolUseContent } from "../../types";
import type { TodoItem } from "./types";

interface TodoWriteBlockProps {
  block: ToolUseContent;
  /** 配对的 tool_result 是否报错。schema 级拒绝（参数形状、条数/长度上限、
   *  非法 status）在渲染层的软规则里看不出来，只有这个信号是权威的。 */
  rejectedByTool?: boolean;
}

/** 只收结构完整的条目：畸形条目不能进 `rejectTodoList`（它会直接读 `.content.trim()`）。 */
function isTodoItem(entry: unknown): entry is TodoItem {
  if (!entry || typeof entry !== "object") return false;
  const { content, status } = entry as Record<string, unknown>;
  return typeof content === "string" && typeof status === "string";
}

export const TodoWriteBlock = memo(function TodoWriteBlock({
  block,
  rejectedByTool = false,
}: TodoWriteBlockProps) {
  const { t } = useTranslation();
  const input = block.input as Record<string, unknown> | undefined;
  const raw = input?.todos;
  const todos: TodoItem[] = Array.isArray(raw) ? raw.filter(isTodoItem) : [];
  // 有条目读不出来 = 形状不对（todos 不是数组、条目缺字段、input 是 JSON 字符串…）
  const malformed = !Array.isArray(raw) || todos.length !== raw.length;

  // 空的合法清单是模型主动丢弃，什么都不用说。
  if (!malformed && todos.length === 0) return null;

  const rejection = malformed
    ? null
    : rejectTodoList(todos, normalizePlanDone(todos, input?.done));
  if (!malformed && !rejection && !rejectedByTool) return null;

  return (
    <div className="rounded-xl border border-warning/40 bg-warning/5 px-4 py-3 flex items-center gap-3">
      <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
      <span className="text-sm text-foreground">
        {rejection?.reason === "emptyContent" &&
          t("messageCard.todoRejectedEmptyContent", {
            index: rejection.index + 1,
          })}
        {rejection?.reason === "unsettledItems" &&
          t("messageCard.todoRejectedUnsettledItems")}
        {rejection?.reason === "multipleInProgress" &&
          t("messageCard.todoRejectedMultipleInProgress")}
        {/* 软规则没意见、也没有可读条目 ⇒ 只可能是工具按 schema 拒的 */}
        {!rejection && t("messageCard.todoRejectedInvalidShape")}
      </span>
    </div>
  );
});
