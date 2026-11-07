// 后台型子代理在消息区只剩一行回执。
//
// 细节（实时步骤、当前动作、模型与统计）住在右侧会话概览的「后台任务」里 ——
// 那里本来就是这些代理的索引，一份数据只该有一处展开区。这里保留的是
// 「这一刻派出去过一个代理、它现在什么状态、花了多久」，点一下把面板打开并选中它。
//
// 与前台阻塞型子代理的区别：后者的结果就在这条消息里（等它跑完才有下一条），
// 所以它的卡片仍然可展开、仍然就地显示步骤（见 SubagentSteps 的默认调用方）。
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, ChevronRight, Loader2, XCircle } from "lucide-react";
import type { SubagentActivity } from "../../../shared/subagent-activity";
import { agentDisplayName } from "../../utils/subagent-card";
import { useAppStore } from "../../store";
import { Tooltip, TooltipContent, TooltipTrigger } from "../app-tooltip";
import { getToolIcon, getToolLabel } from "./toolHelpers";

interface BackgroundAgentRowProps {
  activity: SubagentActivity;
  toolCallId: string;
  /** 调用参数：名字与类型的兜底来源（与卡片头原来用的是同一份）。 */
  input?: Record<string, unknown>;
  showIcon?: boolean;
  /** 工具组里一行一个调用时用：不画卡片外壳。 */
  detailOnly?: boolean;
}

/** 耗时的单位只在两档之间切换，不做三位小数那种噪声。 */
function durationText(ms: number): string | null {
  if (!ms || ms <= 0) return null;
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export const BackgroundAgentRow = memo(function BackgroundAgentRow({
  activity,
  toolCallId,
  input,
  showIcon = true,
  detailOnly = false,
}: BackgroundAgentRowProps) {
  const { t, i18n } = useTranslation();
  const focusOverviewTask = useAppStore((s) => s.focusOverviewTask);

  const label = getToolLabel("Agent", input ?? {}, t);
  // 名字 + 任务描述：卡片头原来那句摘要，去掉它之后这一行就是唯一的说明。
  const summary = [
    agentDisplayName(input, activity.name, i18n.language),
    activity.description,
  ]
    .filter(Boolean)
    .join(" · ");
  // 耗时取活动快照而不是 trace step：后台型的工具调用是立刻返回的，
  // trace 里那一步的 duration 只有几毫秒，代理解释不了"它跑了多久"。
  const duration = durationText(activity.stats.durationMs);
  const openLabel = t("tool.openInOverview");

  return (
    <div
      className={
        detailOnly
          ? ""
          : `overflow-hidden rounded-2xl transition-colors ${
              activity.status === "error"
                ? "bg-destructive/5"
                : "bg-background/40"
            }`
      }
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`${label} · ${summary || toolCallId} · ${openLabel}`}
            onClick={() => focusOverviewTask(toolCallId)}
            className="group flex w-full items-center gap-2.5 py-2 pr-3 text-left transition-colors hover:bg-hover-surface focus-visible:bg-hover-surface"
          >
            <span className="flex w-3.5 flex-shrink-0 justify-center text-muted-foreground">
              {activity.status === "error" ? (
                <XCircle className="h-3.5 w-3.5" />
              ) : activity.status === "running" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5" />
              )}
            </span>

            {showIcon ? (
              <span className="flex w-3.5 flex-shrink-0 justify-center text-muted-foreground">
                {getToolIcon("Agent")}
              </span>
            ) : null}

            <span className="flex min-w-0 flex-1 items-baseline gap-x-1">
              <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
                {label}
              </span>
              {summary && (
                <span className="min-w-0 truncate text-xs text-muted-foreground">
                  · {summary}
                </span>
              )}
            </span>

            {duration && (
              <span className="flex-shrink-0 text-[11px] tabular-nums text-muted-foreground">
                {duration}
              </span>
            )}

            {/* 悬停才出现的动作提示：静止时这行与其它工具行占同样的宽度。 */}
            <span className="flex flex-shrink-0 items-center gap-0.5 whitespace-nowrap text-[11px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
              {openLabel}
              <ChevronRight className="h-3 w-3" />
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">{openLabel}</TooltipContent>
      </Tooltip>
    </div>
  );
});
