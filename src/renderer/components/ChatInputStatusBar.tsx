import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Target,
  CirclePause,
  BadgeCheck,
  Ban,
  CircleDollarSign,
  Loader2,
  SquareTerminal,
  XCircle,
} from "lucide-react";
import type { BackgroundAgentRow } from "../utils/subagent-card";
import type { ShellTask } from "../../shared/shell-task";
import { useAppStore } from "../store";
import type { SessionExecutionClock } from "../store";
import { Button } from "./app-button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./app-tooltip";

export type ChatInputStatus =
  | { type: "sending" }
  | { type: "thinking" }
  | { type: "responding" }
  | { type: "compacting" }
  | { type: "compaction-success" }
  | { type: "compaction-failed" }
  | { type: "compaction-aborted" }
  | {
      type: "goal-active";
      objective: string;
      iteration: number;
      tokensUsed?: number;
      tokenBudget?: number;
      timeUsedSeconds?: number;
      timeBudgetSeconds?: number;
      activePeriodStartedAt?: number;
    }
  | {
      type: "goal-paused";
      objective: string;
      iteration?: number;
      timeUsedSeconds?: number;
    }
  | {
      type: "goal-complete";
      objective: string;
      iteration?: number;
      timeUsedSeconds?: number;
    }
  | {
      type: "goal-blocked";
      objective: string;
      iteration?: number;
      timeUsedSeconds?: number;
    }
  | {
      type: "goal-budget-limited";
      objective: string;
      iteration: number;
      tokensUsed?: number;
      tokenBudget?: number;
      timeUsedSeconds?: number;
      timeBudgetSeconds?: number;
      activePeriodStartedAt?: number;
    }
  | {
      type: "background-agent";
      count: number;
      detail?: string;
      done?: boolean;
      /** 全部结束、但其中有失败（error/stopped/aborted）时不为"已完成"说谎。 */
      hasError?: boolean;
    }
  | null;

interface ChatInputStatusBarProps {
  status: ChatInputStatus;
  onGoalCommand?: (action: string) => void;
  /** 后台任务行（只用来算计数与失败态）；列表本身在右侧概览面板里。 */
  backgroundAgentRows?: BackgroundAgentRow[];
  /** 后台终端任务（只算「还有几条在跑」）。 */
  shellTaskRows?: ShellTask[];
}

// Inline keyframes for gradient text animation (currentColor-based, auto-adapts to theme).
export const gradientStyles = `
@keyframes gradient-flow {
  0%   { background-position: 200% 50%; }
  100% { background-position: -200% 50%; }
}
.gradient-text {
  background: linear-gradient(90deg, transparent, currentColor, transparent);
  background-size: 200% 100%;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  animation: gradient-flow 3s linear infinite;
}
`;

export function ChatInputStatusBar({
  status,
  onGoalCommand,
  backgroundAgentRows,
  shellTaskRows,
}: ChatInputStatusBarProps) {
  const { t } = useTranslation();
  const rows = backgroundAgentRows ?? [];
  const shellDetached = (shellTaskRows ?? []).filter(
    (task) => task.status === "detached",
  );

  // 目标长跑期间每秒推进一次。
  // dep 是布尔量而不是 now，所以窗口内不会每秒重建 effect；
  // 窗口到期时它变 false，effect 自行清理。
  const [now, setNow] = useState(() => Date.now());
  // 只有目标长跑需要走表（回合秒表已搬到消息区底部的任务坞）。
  const isTimeLive = isGoalTimeLive(status);
  useEffect(() => {
    if (!isTimeLive) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isTimeLive]);

  // ── 右区（子代理指示）────────────────────────────────────────────
  // 只当"外面还有活在跑"的常驻信号用：右面板关着时，回合结束后消息区与任务坞
  // 都会安静下来，这枚 chip 是唯一还亮着的灯 —— 所以它常驻、不参与上面的优先级链。
  // 列表与细节都不在这里：一份列表只留在右面板，两份必然漂移（原来那份 popover
  // 与概览面板的内容完全重复，点行也只是跳回消息区）。
  const hasActivity = rows.length > 0;
  // 有失败行时整枚 chip 换成失败色：失败信号不能只剩打开面板才看得见。
  const hasError = rows.some((row) => row.status === "error");
  const runningCount = rows.filter((row) => row.status === "running").length;
  // 落点优先给还在跑的那条；都结束了就取最近一条（rows 本身按最近更新排序）。
  const focusTarget = rows.find((row) => row.status === "running") ?? rows[0];
  const focusOverviewTask = useAppStore((s) => s.focusOverviewTask);

  const subagentChip = hasActivity ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          type="button"
          onClick={() => focusOverviewTask(focusTarget.toolCallId)}
          // ⚠️ 这四条类必须显式写回：`<Button>` base 的 `text-sm` / `font-medium` /
          // `[&_svg]:size-4` 与缺省档的 `h-9` 会盖掉这枚 chip 自己写的 `min-h-5`
          // （min-height 顶不掉 36px 定高）和图标尺寸（`[&_svg]:size-4` 的选择器是
          // `.cls svg`，比 `.h-3` 高一级 ⇒ 16px）。真机实测（Chromium + 构建 CSS，
          // 2026-10-10）：chip 盒 32×36px、图标 16px、字 14px/500，而同一行左侧的状态
          // 文案是 12px/高 16px（用户报障「子代理这个图标太高了」）；写回后实测
          // 28×20px、图标 12px、字 12px/400 == `min-h-5`。
          // ⚠️ `[&_svg]:size-3` 的作用面是**这枚 chip 里所有 svg**，往 chip 里再加图标的
          // 人要回读这句。
          className="flex h-auto min-h-5 min-w-0 items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-left text-xs font-normal text-foreground transition-colors hover:bg-selected-surface [&_svg]:size-3"
        >
          <span className={`flex-none ${hasError ? "text-destructive" : ""}`}>
            {t("activity.subagents", { count: rows.length })}
          </span>
          {runningCount > 0 ? (
            <Loader2 className="h-3 w-3 flex-none animate-spin text-primary-text" />
          ) : hasError ? (
            <XCircle className="h-3 w-3 flex-none text-destructive" />
          ) : null}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">{t("activity.openOverview")}</TooltipContent>
    </Tooltip>
  ) : null;

  const shellChip =
    shellDetached.length > 0 ? (
      <span className="flex h-auto min-h-5 min-w-0 items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-left text-xs font-normal text-foreground [&_svg]:size-3">
        <SquareTerminal className="h-3 w-3 flex-none text-primary-text" />
        <span className="flex-none">
          {t("chat.shellTask.statusChip", { count: shellDetached.length })}
        </span>
      </span>
    ) : null;

  const rightZone =
    shellChip || subagentChip ? (
      <div className="flex items-center gap-1">
        {shellChip}
        {subagentChip}
      </div>
    ) : null;

  // ── Goal status rendering ──
  if (
    status &&
    (status.type === "goal-active" ||
      status.type === "goal-paused" ||
      status.type === "goal-complete" ||
      status.type === "goal-blocked" ||
      status.type === "goal-budget-limited")
  ) {
    const renderGoalIcon = (type: string) => {
      const cls = "w-3.5 h-3.5 flex-shrink-0 text-muted-foreground";
      switch (type) {
        case "goal-active":
          return <Target className={cls} />;
        case "goal-paused":
          return <CirclePause className={cls} />;
        case "goal-complete":
          return <BadgeCheck className={cls} />;
        case "goal-blocked":
          return <Ban className={cls} />;
        case "goal-budget-limited":
          return <CircleDollarSign className={cls} />;
        default:
          return null;
      }
    };

    // eslint-disable-next-line no-inner-declarations
    function formatElapsedTime(seconds: number): string {
      const s = Math.round(seconds);
      if (s < 60) return t("goal.timeLessThanMinute");
      if (s < 3600) return t("goal.timeMinutes", { n: Math.round(s / 60) });
      const h = Math.floor(s / 3600);
      const m = Math.round((s % 3600) / 60);
      if (m === 0) return t("goal.timeMinutes", { n: h * 60 });
      return t("goal.timeHoursMinutes", { h, m });
    }

    let infoText = "";
    if (status.type === "goal-active") {
      infoText = t("goal.turn", { n: status.iteration });
    } else if (status.type === "goal-paused") {
      infoText = t("goal.turnsDone", { n: status.iteration ?? 0 });
    } else if (
      status.type === "goal-complete" ||
      status.type === "goal-blocked"
    ) {
      infoText = t("goal.turnsDone", { n: status.iteration ?? 0 });
    } else if (status.type === "goal-budget-limited") {
      infoText = t("goal.lastRound");
    }

    // Append elapsed time for all goal states that have timeUsedSeconds
    const displaySeconds =
      status.timeUsedSeconds != null
        ? computeElapsedSeconds(status, now)
        : undefined;
    if (displaySeconds != null && displaySeconds > 0) {
      const isOngoing =
        status.type === "goal-active" ||
        status.type === "goal-paused" ||
        status.type === "goal-budget-limited";
      infoText += ` · ${t(isOngoing ? "goal.elapsed" : "goal.elapsedDone", { time: formatElapsedTime(displaySeconds) })}`;
    }

    return (
      <div className="min-h-5 px-1 pb-1">
        <style>{gradientStyles}</style>
        <div className="flex items-center gap-1.5 text-xs text-foreground">
          {renderGoalIcon(status.type)}
          <span
            className={`min-w-0 truncate ${status.type === "goal-active" ? "gradient-text" : ""}`}
          >
            {status.objective}
          </span>
          <span
            className={`flex-shrink-0 text-muted-foreground ${status.type === "goal-active" ? "gradient-text" : ""}`}
          >
            {infoText}
          </span>
          {status.type === "goal-active" && onGoalCommand && (
            <Button
              variant="ghost"
              type="button"
              className="flex-shrink-0 px-1.5 py-0.5 rounded text-[11px] bg-primary/15 text-primary-text hover:bg-primary/25 transition-[transform,background-color,color] active:scale-[0.97] h-auto font-normal"
              onClick={() => onGoalCommand("goal:pause")}
            >
              {t("goal.pause")}
            </Button>
          )}
          {status.type === "goal-paused" && onGoalCommand && (
            <>
              <Button
                variant="ghost"
                type="button"
                className="flex-shrink-0 px-1.5 py-0.5 rounded text-[11px] bg-primary/15 text-primary-text hover:bg-primary/25 transition-[transform,background-color,color] active:scale-[0.97] h-auto font-normal"
                onClick={() => onGoalCommand("goal:resume")}
              >
                {t("goal.resume")}
              </Button>
              <Button
                variant="ghost"
                type="button"
                className="flex-shrink-0 px-1.5 py-0.5 rounded text-[11px] bg-accent text-muted-foreground hover:bg-selected-surface transition-[transform,background-color,color] active:scale-[0.97] h-auto font-normal"
                onClick={() => onGoalCommand("goal:clear")}
              >
                {t("goal.clear")}
              </Button>
            </>
          )}
          {rightZone}
        </div>
      </div>
    );
  }

  // ── 非目标态 ──
  // 动作态（思考中/执行中/压缩中 + 秒表）已搬到消息区底部的任务坞；
  // 这里只剩子代理入口。没有内容时整行不渲染，也不留固定高度占位。
  if (!rightZone) return null;

  return (
    <div className="min-h-5 px-1 pb-1">
      <div className="flex items-center gap-1.5 text-xs text-foreground">
        {rightZone}
      </div>
    </div>
  );
}

/** Pure function: resolve the single highest-priority input-area status.
 *  Testable without mounting ChatView. */
export function resolveInputStatus(params: {
  isSending: boolean;
  isCompacting: boolean;
  compactionResult: "success" | "failed" | "aborted" | null;
  shouldShowThinkingIndicator: boolean;
  isResponding: boolean;
  goalStatus?: {
    status:
      | "active"
      | "paused"
      | "complete"
      | "cleared"
      | "blocked"
      | "budget_limited";
    objective?: string;
    iteration?: number;
    tokensUsed?: number;
    tokenBudget?: number;
    timeUsedSeconds?: number;
    timeBudgetSeconds?: number;
    activePeriodStartedAt?: number;
  } | null;
  /** 面板行（运行中 + 已完成）。改掉了原来的 `backgroundAgents`：那个列表完成 1 秒后
   *  就被清空，而入口需要在跑完之后仍然可达。 */
  backgroundAgentRows: BackgroundAgentRow[];
}): ChatInputStatus {
  if (params.isCompacting) return { type: "compacting" };
  if (params.isSending) return { type: "sending" };
  if (params.compactionResult === "failed") {
    return { type: "compaction-failed" };
  }
  if (params.compactionResult === "aborted") {
    return { type: "compaction-aborted" };
  }
  if (params.compactionResult === "success") {
    return { type: "compaction-success" };
  }
  if (params.goalStatus) {
    switch (params.goalStatus.status) {
      case "active":
        return {
          type: "goal-active",
          objective: params.goalStatus.objective ?? "",
          iteration: params.goalStatus.iteration ?? 0,
          tokensUsed: params.goalStatus.tokensUsed,
          tokenBudget: params.goalStatus.tokenBudget,
          timeUsedSeconds: params.goalStatus.timeUsedSeconds,
          activePeriodStartedAt: params.goalStatus.activePeriodStartedAt,
        };
      case "paused":
        return {
          type: "goal-paused",
          objective: params.goalStatus.objective ?? "",
          iteration: params.goalStatus.iteration,
          timeUsedSeconds: params.goalStatus.timeUsedSeconds,
        };
      case "complete":
        return {
          type: "goal-complete",
          objective: params.goalStatus.objective ?? "",
          iteration: params.goalStatus.iteration,
          timeUsedSeconds: params.goalStatus.timeUsedSeconds,
        };
      case "blocked":
        return {
          type: "goal-blocked",
          objective: params.goalStatus.objective ?? "",
          iteration: params.goalStatus.iteration,
          timeUsedSeconds: params.goalStatus.timeUsedSeconds,
        };
      case "budget_limited":
        return {
          type: "goal-budget-limited",
          objective: params.goalStatus.objective ?? "",
          iteration: params.goalStatus.iteration ?? 0,
          tokensUsed: params.goalStatus.tokensUsed,
          tokenBudget: params.goalStatus.tokenBudget,
          timeUsedSeconds: params.goalStatus.timeUsedSeconds,
          timeBudgetSeconds: params.goalStatus.timeBudgetSeconds,
          activePeriodStartedAt: params.goalStatus.activePeriodStartedAt,
        };
    }
  }
  if (params.shouldShowThinkingIndicator) {
    return { type: "thinking" };
  }
  if (params.isResponding) {
    return { type: "responding" };
  }
  if (params.backgroundAgentRows.length > 0) {
    const running = params.backgroundAgentRows.filter(
      (row) => row.status === "running",
    );
    const allDone = running.length === 0;
    const count = allDone ? params.backgroundAgentRows.length : running.length;
    const first = running[0];
    const detail =
      count === 1 && first
        ? [first.type, first.description].filter(Boolean).join(" · ")
        : undefined;
    const hasError =
      allDone &&
      params.backgroundAgentRows.some((row) => row.status === "error");
    return {
      type: "background-agent",
      count,
      detail,
      done: allDone,
      hasError: hasError || undefined,
    };
  }
  return null;
}

/** Goal status types whose elapsed clock keeps running (vs. frozen snapshots). */
export function isGoalTimeLive(status: ChatInputStatus): boolean {
  return (
    status?.type === "goal-active" || status?.type === "goal-budget-limited"
  );
}

/** 非 goal 的运行态里，回合秒表是否在走。
 *  `endAt === null` 就是 live 的定义：它让本函数与 5s 收尾分支互为补集，
 *  两者不会同时为真，所以同一帧只可能渲染一种措辞。 */
export function isTurnClockLive(
  status: ChatInputStatus,
  clock: SessionExecutionClock | undefined,
): boolean {
  if (!clock || clock.startAt === null || clock.endAt !== null) return false;
  return (
    status?.type === "sending" ||
    status?.type === "thinking" ||
    status?.type === "responding" ||
    status?.type === "compacting"
  );
}

/** Narrow to goal status variants that carry a timeUsedSeconds snapshot. */
function hasTimeUsed(
  status: ChatInputStatus,
): status is Extract<ChatInputStatus, { timeUsedSeconds?: number }> {
  return status !== null && "timeUsedSeconds" in status;
}

/** Seconds to display in the status bar: use the authoritative active
 *  period start for live states, frozen snapshot otherwise. */
export function computeElapsedSeconds(
  status: ChatInputStatus,
  nowMs: number,
): number {
  const base = hasTimeUsed(status) ? (status.timeUsedSeconds ?? 0) : 0;
  if (
    !status ||
    (status.type !== "goal-active" && status.type !== "goal-budget-limited")
  ) {
    return base;
  }
  const startedAt = status.activePeriodStartedAt;
  if (startedAt == null) return base;
  return base + Math.max(0, (nowMs - startedAt) / 1000);
}
