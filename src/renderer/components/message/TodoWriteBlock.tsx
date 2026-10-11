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
import { Button } from "../app-button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";

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
      // 完成态**不上**成功色：绿在本仓标记的是「一次操作成功收尾 / 健康 / 新增」
      // （设置里的保存回执、`.dot-connected`、diff 的 +N），而清单里「这一项已完成」
      // 是持续状态，同一行已经有删除线 —— 再叠一层绿是重复编码，且在 zinc + orange
      // 这类非绿色强调色下，它会成为整张卡片最饱和的一笔。
      case "completed":
        return <CheckSquare className="w-4 h-4 text-muted-foreground" />;
      case "in_progress":
        return <Loader2 className="w-4 h-4 text-primary-text animate-spin" />;
      case "cancelled":
        return <XCircle className="w-4 h-4 text-muted-foreground" />;
      default: // pending
        return <Square className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const getStatusStyle = (status: string) => {
    switch (status) {
      case "completed":
        return "text-muted-foreground line-through";
      case "in_progress":
        return "text-primary-text font-medium";
      case "cancelled":
        return "text-muted-foreground line-through opacity-60";
      default:
        return "text-foreground";
    }
  };

  if (todos.length === 0) {
    return null;
  }

  if (rejection) {
    return (
      <div className="rounded-xl border border-warning/40 bg-warning/5 px-4 py-3 flex items-center gap-3">
        <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
        <span className="text-sm text-foreground">
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
    <Collapsible
      open={expanded}
      onOpenChange={setExpanded}
      className="rounded-xl border border-border overflow-hidden bg-card"
    >
      {/* Header：展开/折叠由 Radix Trigger 独占（aria-expanded/aria-controls 由原语提供）。 */}
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          className="w-full px-4 py-3 flex items-center gap-3 bg-muted hover:bg-accent transition-colors h-auto"
        >
          <div className="w-6 h-6 rounded-lg bg-primary/10 flex items-center justify-center">
            <ListTodo className="w-3.5 h-3.5 text-primary-text" />
          </div>
          <div className="flex-1 text-left">
            <span className="font-medium text-sm text-foreground">
              {t("messageCard.taskProgress")}
            </span>
            {inProgressItem && (
              <span className="text-xs text-muted-foreground ml-2">
                — {inProgressItem.activeForm || inProgressItem.content}
              </span>
            )}
          </div>
          <span className="text-xs font-medium text-muted-foreground mr-2">
            {completedCount}/{totalCount}
          </span>
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          )}
        </Button>
      </CollapsibleTrigger>

      {/* Progress bar */}
      <div className="h-0.5 bg-muted">
        <div
          className="h-full bg-gradient-to-r from-primary to-primary/90 transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Todo list */}
      {expanded && (
        <CollapsibleContent className="p-3 space-y-1">
          {todos.map((todo, index) => (
            <div
              key={todo.id || index}
              className={`flex items-start gap-2.5 px-2 py-1.5 rounded-lg transition-colors ${
                todo.status === "in_progress" ? "bg-primary/5" : ""
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
        </CollapsibleContent>
      )}
    </Collapsible>
  );
});
