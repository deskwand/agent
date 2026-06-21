import { useTranslation } from "react-i18next";
import { AlertCircle, Check, Loader2, Target } from "lucide-react";

export type ChatInputStatus =
  | { type: "thinking" }
  | { type: "compacting" }
  | { type: "compaction-success" }
  | { type: "compaction-failed" }
  | { type: "steering"; text: string }
  | {
      type: "goal-active";
      objective: string;
      iteration: number;
      tokensUsed?: number;
      tokenBudget?: number;
      timeUsedSeconds?: number;
      timeBudgetSeconds?: number;
    }
  | { type: "goal-paused"; objective: string }
  | { type: "goal-complete"; objective: string }
  | { type: "goal-blocked"; objective: string }
  | {
      type: "goal-budget-limited";
      objective: string;
      iteration: number;
      tokensUsed?: number;
      tokenBudget?: number;
      timeUsedSeconds?: number;
      timeBudgetSeconds?: number;
    }
  | null;

interface ChatInputStatusBarProps {
  status: ChatInputStatus;
}

export function ChatInputStatusBar({ status }: ChatInputStatusBarProps) {
  const { t } = useTranslation();

  if (!status) return null;

  let icon: React.ReactNode = null;
  let text = "";
  let toneClass = "text-text-muted";

  switch (status.type) {
    case "thinking":
      icon = <Loader2 className="w-3 h-3 animate-spin" />;
      text = t("chat.processing");
      break;
    case "compacting":
      icon = <Loader2 className="w-3 h-3 animate-spin" />;
      text = t("chat.compacting");
      break;
    case "compaction-success":
      icon = <Check className="w-3 h-3" />;
      text = t("chat.compacted");
      toneClass = "text-success";
      break;
    case "compaction-failed":
      icon = <AlertCircle className="w-3 h-3" />;
      text = t("chat.compactFailed");
      toneClass = "text-error";
      break;
    case "steering":
      icon = <Target className="w-3 h-3" />;
      text = `${t("steer.eventLabel")}: ${status.text}`;
      toneClass = "text-text-secondary";
      break;
    case "goal-active":
      icon = <Target className="w-3 h-3 animate-pulse" />;
      text = `${t("goal.active")}: ${status.objective} (${t("goal.turn", { n: status.iteration })})`;
      break;
    case "goal-paused":
      icon = <Target className="w-3 h-3" />;
      text = `${t("goal.paused")}: ${status.objective}`;
      break;
    case "goal-complete":
      icon = <Check className="w-3 h-3" />;
      text = `${t("goal.complete")}: ${status.objective}`;
      toneClass = "text-success";
      break;
    case "goal-blocked":
      icon = <AlertCircle className="w-3 h-3" />;
      text = `${t("goal.blocked")}: ${status.objective}`;
      toneClass = "text-error";
      break;
    case "goal-budget-limited":
      icon = <AlertCircle className="w-3 h-3" />;
      text = `${t("goal.budgetLimited")}: ${status.objective} (${t("goal.turn", { n: status.iteration })})`;
      toneClass = "text-warning";
      break;
  }

  return (
    <div className="min-h-5 px-1 pb-1">
      <div className={`flex items-center gap-1.5 text-xs ${toneClass}`}>
        <span className="shrink-0 opacity-70">{icon}</span>
        <span className="min-w-0 truncate">{text}</span>
      </div>
    </div>
  );
}

/** Pure function: resolve the single highest-priority input-area status.
 *  Testable without mounting ChatView. */
export function resolveInputStatus(params: {
  isCompacting: boolean;
  compactionResult: "success" | "failed" | null;
  steeringText: string;
  shouldShowThinkingIndicator: boolean;
  goalStatus?: {
    status: "active" | "paused" | "complete" | "cleared" | "blocked" | "budget_limited";
    objective?: string;
    iteration?: number;
    tokensUsed?: number;
    tokenBudget?: number;
    timeUsedSeconds?: number;
    timeBudgetSeconds?: number;
  } | null;
}): ChatInputStatus {
  if (params.isCompacting) return { type: "compacting" };
  if (params.compactionResult === "failed") {
    return { type: "compaction-failed" };
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
        };
      case "paused":
        return {
          type: "goal-paused",
          objective: params.goalStatus.objective ?? "",
        };
      case "complete":
        return {
          type: "goal-complete",
          objective: params.goalStatus.objective ?? "",
        };
      case "blocked":
        return {
          type: "goal-blocked",
          objective: params.goalStatus.objective ?? "",
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
  return null;
}
