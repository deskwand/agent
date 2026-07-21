import { useTranslation } from "react-i18next";
import {
  Target,
  CirclePause,
  BadgeCheck,
  Ban,
  CircleDollarSign,
} from "lucide-react";

export type ChatInputStatus =
  | { type: "sending" }
  | { type: "thinking" }
  | { type: "responding" }
  | { type: "compacting" }
  | { type: "compaction-success" }
  | { type: "compaction-failed" }
  | { type: "compaction-aborted" }
  | { type: "steering"; text: string }
  | { type: "steering-accepted"; text: string }
  | { type: "steering-failed"; text: string }
  | {
      type: "goal-active";
      objective: string;
      iteration: number;
      tokensUsed?: number;
      tokenBudget?: number;
      timeUsedSeconds?: number;
      timeBudgetSeconds?: number;
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
    }
  | {
      type: "background-agent";
      count: number;
      detail?: string;
      done?: boolean;
    }
  | null;

interface ChatInputStatusBarProps {
  status: ChatInputStatus;
  onGoalCommand?: (action: string) => void;
}

// Inline keyframes for gradient text animation (currentColor-based, auto-adapts to theme).
const gradientStyles = `
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
}: ChatInputStatusBarProps) {
  const { t } = useTranslation();

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
      const cls = "w-3.5 h-3.5 flex-shrink-0 text-text-muted";
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
    if (status.timeUsedSeconds != null && status.timeUsedSeconds > 0) {
      const isOngoing =
        status.type === "goal-active" ||
        status.type === "goal-paused" ||
        status.type === "goal-budget-limited";
      infoText += ` · ${t(isOngoing ? "goal.elapsed" : "goal.elapsedDone", { time: formatElapsedTime(status.timeUsedSeconds) })}`;
    }

    return (
      <div className="min-h-5 px-1 pb-1">
        <style>{gradientStyles}</style>
        <div className="flex items-center gap-1.5 text-xs text-text-primary">
          {renderGoalIcon(status.type)}
          <span className="min-w-0 truncate">{status.objective}</span>
          <span className="flex-shrink-0 text-text-muted">{infoText}</span>
          {status.type === "goal-active" && onGoalCommand && (
            <button
              type="button"
              className="flex-shrink-0 px-1.5 py-0.5 rounded text-[11px] bg-accent/15 text-accent hover:bg-accent/25 transition-[transform,background-color,color] active:scale-[0.97]"
              onClick={() => onGoalCommand("goal:pause")}
            >
              {t("goal.pause")}
            </button>
          )}
          {status.type === "goal-paused" && onGoalCommand && (
            <>
              <button
                type="button"
                className="flex-shrink-0 px-1.5 py-0.5 rounded text-[11px] bg-accent/15 text-accent hover:bg-accent/25 transition-[transform,background-color,color] active:scale-[0.97]"
                onClick={() => onGoalCommand("goal:resume")}
              >
                {t("goal.resume")}
              </button>
              <button
                type="button"
                className="flex-shrink-0 px-1.5 py-0.5 rounded text-[11px] bg-surface-hover text-text-muted hover:bg-surface-hover/80 transition-[transform,background-color,color] active:scale-[0.97]"
                onClick={() => onGoalCommand("goal:clear")}
              >
                {t("goal.clear")}
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  // ── Non-goal status rendering ──
  let text = "";
  let toneClass = "text-text-muted";
  let isRunning = false;

  if (status) {
    switch (status.type) {
      case "sending":
        text = t("chat.sending");
        toneClass = "text-text-primary";
        isRunning = true;
        break;
      case "thinking":
        text = t("chat.processing");
        toneClass = "text-text-primary";
        isRunning = true;
        break;
      case "responding":
        text = t("chat.responding");
        toneClass = "text-text-primary";
        isRunning = true;
        break;
      case "compacting":
        text = t("chat.compacting");
        toneClass = "text-text-primary";
        isRunning = true;
        break;
      case "compaction-success":
        text = t("chat.compacted");
        toneClass = "text-text-muted";
        break;
      case "compaction-failed":
        text = t("chat.compactFailed");
        toneClass = "text-text-muted";
        break;
      case "compaction-aborted":
        text = t("chat.compactAborted");
        toneClass = "text-text-muted";
        break;
      case "steering":
        text = `${t("steer.eventLabel")}: ${status.text}`;
        toneClass = "text-text-primary";
        isRunning = true;
        break;
      case "steering-accepted":
        text = `\u2713 ${t("steer.eventLabel")}: ${status.text}`;
        toneClass = "text-success font-medium";
        break;
      case "steering-failed":
        text = `\u2717 ${t("steer.eventLabel")} ${t("steer.notDelivered")}`;
        toneClass = "text-error";
        break;
      case "background-agent":
        if (status.done) {
          text = t("subagent.statusDone", { count: status.count });
          toneClass = "text-text-muted";
        } else {
          text = t("subagent.statusRunning", {
            count: status.count,
            detail: status.detail ? ` ${status.detail}` : "",
          });
          toneClass = "text-text-primary";
          isRunning = true;
        }
        break;
      // goal-* handled by early return above
    }
  }

  // Always render a fixed-height container to prevent layout jump
  return (
    <div className="min-h-5 px-1 pb-1">
      <style>{gradientStyles}</style>
      <div className={`flex items-center gap-1.5 text-xs ${toneClass}`}>
        <span
          className={`min-w-0 truncate ${isRunning ? "gradient-text" : ""}`}
        >
          {text}
        </span>
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
  steeringText: string;
  steeringAcceptedText: string;
  steeringFailedText: string;
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
  } | null;
  backgroundAgents: Array<{
    id: string;
    type: string;
    description: string;
    status: "running" | "done";
  }>;
}): ChatInputStatus {
  if (params.isCompacting) return { type: "compacting" };
  if (params.isSending) return { type: "sending" };
  if (params.compactionResult === "failed") {
    return { type: "compaction-failed" };
  }
  if (params.compactionResult === "aborted") {
    return { type: "compaction-aborted" };
  }
  if (params.steeringAcceptedText) {
    return { type: "steering-accepted", text: params.steeringAcceptedText };
  }
  if (params.steeringFailedText) {
    return { type: "steering-failed", text: params.steeringFailedText };
  }
  if (params.steeringText) {
    return { type: "steering", text: params.steeringText };
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
        };
    }
  }
  if (params.shouldShowThinkingIndicator) {
    return { type: "thinking" };
  }
  if (params.isResponding) {
    return { type: "responding" };
  }
  if (params.backgroundAgents.length > 0) {
    const allDone = params.backgroundAgents.every((a) => a.status === "done");
    const count = params.backgroundAgents.length;
    const detail =
      count === 1 && !allDone
        ? `${params.backgroundAgents[0].type} · ${params.backgroundAgents[0].description}`
        : undefined;
    return { type: "background-agent", count, detail, done: allDone };
  }
  return null;
}
