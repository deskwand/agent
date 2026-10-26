import { useTranslation } from "react-i18next";
import { useAppStore } from "../../store";
import { useActiveContextWindow } from "../../store/selectors";
import { AppProgress } from "../app-progress";
import {
  computeContextUsage,
  contextUsageLevel,
  findLastPromptInputTokens,
  formatTokenCount,
} from "../../utils/context-usage";
import type { CompactionState, Message } from "../../types";
import { OverviewSection } from "./OverviewSection";

const IDLE_COMPACTION: CompactionState = { status: "idle" };
const EMPTY_MESSAGES: Message[] = [];

export function ContextSection() {
  const { t } = useTranslation();
  // 直接用 useActiveSessionMessages 会在 sessionState 还没建立时每次返回新数组，
  // zustand 的 useSyncExternalStore 会判定快照不稳定并无限重渲。兜底用模块常量。
  const messages =
    useAppStore((s) =>
      s.activeSessionId
        ? s.sessionStates[s.activeSessionId]?.messages
        : undefined,
    ) ?? EMPTY_MESSAGES;
  const contextWindow = useActiveContextWindow();
  const compaction =
    useAppStore((s) =>
      s.activeSessionId
        ? s.sessionStates[s.activeSessionId]?.compaction
        : undefined,
    ) ?? IDLE_COMPACTION;

  const usage = computeContextUsage(
    findLastPromptInputTokens(messages),
    compaction.estimatedTokens,
    contextWindow,
  );
  const level = contextUsageLevel(usage.percentage);
  const percentClass =
    level === "destructive"
      ? "text-destructive"
      : level === "warning"
        ? "text-warning"
        : "text-foreground";

  return (
    <OverviewSection titleKey="overview.context.title">
      <div className="flex items-center gap-2 px-1">
        <span className={`text-xs font-medium tabular-nums ${percentClass}`}>
          {Math.round(usage.percentage)}%
        </span>
        {usage.isEstimated && (
          <span className="text-[11px] text-muted-foreground">
            {t("overview.context.estimated")}
          </span>
        )}
        {compaction.status === "running" && (
          <span className="text-[11px] text-muted-foreground">
            {t("overview.context.compacting")}
          </span>
        )}
      </div>
      <AppProgress
        value={usage.percentage}
        max={100}
        className="mx-1 h-1.5"
        aria-label={t("overview.context.title")}
      />
      <p className="px-1 text-[11px] text-muted-foreground">
        {t("overview.context.used", {
          used: formatTokenCount(usage.tokens ?? 0),
          total: formatTokenCount(contextWindow ?? 0),
        })}
      </p>
    </OverviewSection>
  );
}
