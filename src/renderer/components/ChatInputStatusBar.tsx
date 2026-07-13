import { useTranslation } from "react-i18next";

export type ChatInputStatus =
  | { type: "sending" }
  | { type: "thinking" }
  | { type: "responding" }
  | { type: "compacting" }
  | { type: "compaction-success" }
  | { type: "compaction-failed" }
  | { type: "compaction-aborted" }
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

export function ChatInputStatusBar({ status }: ChatInputStatusBarProps) {
  const { t } = useTranslation();

  // Always render a fixed-height container to prevent layout jump
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
    case "goal-active":
      text = `${t("goal.active")}: ${status.objective} (${t("goal.turn", { n: status.iteration })})`;
      toneClass = "text-text-primary";
      isRunning = true;
      break;
    case "goal-paused":
      text = `${t("goal.paused")}: ${status.objective}`;
      toneClass = "text-text-primary";
      isRunning = true;
      break;
    case "goal-complete":
      text = `${t("goal.complete")}: ${status.objective}`;
      toneClass = "text-text-muted";
      break;
    case "goal-blocked":
      text = `${t("goal.blocked")}: ${status.objective}`;
      toneClass = "text-text-muted";
      break;
    case "goal-budget-limited":
      text = `${t("goal.budgetLimited")}: ${status.objective} (${t("goal.turn", { n: status.iteration })})`;
      toneClass = "text-text-primary";
      isRunning = true;
      break;
    }
  }

  return (
    <div className="min-h-5 px-1 pb-1">
      <style>{gradientStyles}</style>
      <div className={`flex items-center gap-1.5 text-xs ${toneClass}`}>
        <span className={`min-w-0 truncate ${isRunning ? "gradient-text" : ""}`}>
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
  shouldShowThinkingIndicator: boolean;
  isResponding: boolean;
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
  if (params.isSending) return { type: "sending" };
  if (params.compactionResult === "failed") {
    return { type: "compaction-failed" };
  }
  if (params.compactionResult === "aborted") {
    return { type: "compaction-aborted" };
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
  if (params.isResponding) {
    return { type: "responding" };
  }
  return null;
}
