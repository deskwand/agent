// TodoWrite tool block — renders AI task list with progress indicator
import { useState, memo } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ListTodo,
  Loader2,
  XCircle,
  Square,
  CheckSquare,
} from "lucide-react";
import { normalizePlanDone, rejectTodoList } from "../../../shared/todos";
import type { ToolUseContent } from "../../types";
import type { TodoItem } from "./types";

interface TodoWriteBlockProps {
  block: ToolUseContent;
}

export const TodoWriteBlock = memo(function TodoWriteBlock({
  block,
}: TodoWriteBlockProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);
  const todos: TodoItem[] =
    ((block.input as Record<string, unknown>)?.todos as TodoItem[]) || [];

  const completedCount = todos.filter(
    (item) => item.status === "completed",
  ).length;
  const totalCount = todos.length;
  const progress = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;
  const inProgressItem = todos.find((item) => item.status === "in_progress");

  // 工具侧拒绝了这份清单时，状态并没有生效。工具结果对用户不可见（未分组工具的
  // result 块会被消费掉），所以必须在这里如实展示，否则卡片会冒充成已生效的清单。
  // 规则与工具共用同一份实现：src/shared/todos.ts —— 包括"声明结束却没结算"那条，
  // 所以这里也要把 done 归一化后一起传进去。
  const rejection = rejectTodoList(
    todos,
    normalizePlanDone(todos, (block.input as Record<string, unknown>)?.done),
  );

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed":
        return <CheckSquare className="w-4 h-4 text-success" />;
      case "in_progress":
        return <Loader2 className="w-4 h-4 text-accent animate-spin" />;
      case "cancelled":
        return <XCircle className="w-4 h-4 text-text-muted" />;
      default: // pending
        return <Square className="w-4 h-4 text-text-muted" />;
    }
  };

  const getStatusStyle = (status: string) => {
    switch (status) {
      case "completed":
        return "text-text-muted line-through";
      case "in_progress":
        return "text-accent font-medium";
      case "cancelled":
        return "text-text-muted line-through opacity-60";
      default:
        return "text-text-primary";
    }
  };

  if (todos.length === 0) {
    return null;
  }

  if (rejection) {
    return (
      <div className="rounded-xl border border-warning/40 bg-warning/5 px-4 py-3 flex items-center gap-3">
        <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
        <span className="text-sm text-text-primary">
          {rejection.reason === "emptyContent"
            ? t("messageCard.todoRejectedEmptyContent", {
                index: rejection.index + 1,
              })
            : rejection.reason === "unsettledItems"
              ? t("messageCard.todoRejectedUnsettledItems")
              : t("messageCard.todoRejectedMultipleInProgress")}
        </span>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border overflow-hidden bg-surface">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center gap-3 bg-surface-muted hover:bg-surface-active transition-colors"
      >
        <div className="w-6 h-6 rounded-lg bg-accent/10 flex items-center justify-center">
          <ListTodo className="w-3.5 h-3.5 text-accent" />
        </div>
        <div className="flex-1 text-left">
          <span className="font-medium text-sm text-text-primary">
            {t("messageCard.taskProgress")}
          </span>
          {inProgressItem && (
            <span className="text-xs text-text-muted ml-2">
              — {inProgressItem.activeForm || inProgressItem.content}
            </span>
          )}
        </div>
        <span className="text-xs font-medium text-text-muted mr-2">
          {completedCount}/{totalCount}
        </span>
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-text-muted" />
        ) : (
          <ChevronRight className="w-4 h-4 text-text-muted" />
        )}
      </button>

      {/* Progress bar */}
      <div className="h-0.5 bg-surface-muted">
        <div
          className="h-full bg-gradient-to-r from-accent to-accent-hover transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Todo list */}
      {expanded && (
        <div className="p-3 space-y-1">
          {todos.map((todo, index) => (
            <div
              key={todo.id || index}
              className={`flex items-start gap-2.5 px-2 py-1.5 rounded-lg transition-colors ${
                todo.status === "in_progress" ? "bg-accent/5" : ""
              }`}
            >
              <div className="mt-0.5 flex-shrink-0">
                {getStatusIcon(todo.status)}
              </div>
              <span
                className={`text-sm leading-relaxed ${getStatusStyle(todo.status)}`}
              >
                {todo.content}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
