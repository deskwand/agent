import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../store";
import {
  useActiveContextWindow,
  useActivePromptParts,
  useActiveSessionMessages,
} from "../../store/selectors";
import {
  computeContextUsage,
  contextUsageLevel,
  findLastPromptInputTokens,
  formatTokenCount,
} from "../../utils/context-usage";
import { buildContextBreakdown } from "../../utils/context-breakdown";
import {
  DOT_CLASS,
  LABEL_KEY,
  MERGED_SYSTEM_LABEL_KEY,
  SEGMENT_CLASS,
} from "./context-breakdown-style";
import type { CompactionState } from "../../types";
import { OverviewSection } from "./OverviewSection";

const IDLE_COMPACTION: CompactionState = { status: "idle" };

function percentLabel(percent: number, showPercent: boolean): string {
  if (!showPercent) return "--";
  if (percent <= 0) return "0%";
  if (percent < 1) return "<1%";
  return `${Math.round(percent)}%`;
}

function BreakdownRow({
  label,
  tokens,
  percent,
  swatch,
  showPercent,
  estimated = true,
}: {
  label: string;
  tokens: number;
  percent: number;
  swatch: string;
  showPercent: boolean;
  /** 空闲行是精确差值，其余分类都是估算。 */
  estimated?: boolean;
}) {
  return (
    <li className="flex items-center gap-1.5 px-1 text-[11px] leading-4">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${swatch}`} />
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        {label}
      </span>
      <span className="shrink-0 tabular-nums text-foreground">
        {estimated ? `≈${formatTokenCount(tokens)}` : formatTokenCount(tokens)}
      </span>
      <span className="w-8 shrink-0 text-right tabular-nums text-muted-foreground">
        {percentLabel(percent, showPercent)}
      </span>
    </li>
  );
}

export function ContextSection() {
  const { t } = useTranslation();
  const messages = useActiveSessionMessages();
  const contextWindow = useActiveContextWindow();
  const promptParts = useActivePromptParts();
  const compaction =
    useAppStore((s) =>
      s.activeSessionId
        ? s.sessionStates[s.activeSessionId]?.compaction
        : undefined,
    ) ?? IDLE_COMPACTION;
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  // 历史未预载完时 messages 是空的，残差会把整个窗口误报成「系统与工具」。
  const historyHydrated = useAppStore((s) =>
    s.activeSessionId
      ? Boolean(s.sessionStates[s.activeSessionId]?.historyHydrated)
      : false,
  );
  // 上一次「未折算」测得的系统侧残差。压缩后历史被摘要、残差算不出来，
  // 靠它把系统提示词保留在表里，而不是让最大的真实分类凭空消失。
  const systemHintRef = useRef<{ sessionId: string | null; tokens: number }>({
    sessionId: null,
    tokens: 0,
  });

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

  const systemHint =
    systemHintRef.current.sessionId === activeSessionId
      ? systemHintRef.current.tokens
      : undefined;
  const breakdown = useMemo(
    () =>
      buildContextBreakdown(
        historyHydrated ? messages : [],
        usage.tokens,
        contextWindow,
        systemHint,
        promptParts,
      ),
    [
      historyHydrated,
      messages,
      usage.tokens,
      contextWindow,
      systemHint,
      promptParts,
    ],
  );
  const showPercent = breakdown.windowTokens !== null;

  // 只在未折算时记录：那时的系统侧总量就是「总量 − 消息估算」的残差。
  // 记录的是三块之和（拆开之后没有单独的 system 行了）。
  useEffect(() => {
    if (breakdown.scaled || breakdown.systemTotal <= 0) return;
    systemHintRef.current = {
      sessionId: activeSessionId,
      tokens: breakdown.systemTotal,
    };
  }, [breakdown, activeSessionId]);

  return (
    <OverviewSection titleKey="overview.context.title">
      <div className="flex items-center gap-2 px-1">
        <span className={`text-xs font-medium tabular-nums ${percentClass}`}>
          {showPercent ? `${Math.round(usage.percentage)}%` : "--"}
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
        <span className="flex-1" />
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {t("overview.context.used", {
            used: formatTokenCount(usage.tokens ?? 0),
            // 窗口未知时不要渲染成「430.4k / 0」。
            total: showPercent ? formatTokenCount(contextWindow ?? 0) : "--",
          })}
        </span>
      </div>
      {breakdown.rows.length > 0 && (
        <div className="space-y-1 pt-0.5">
          {showPercent && (
            <div
              className="mx-1 flex h-1.5 gap-px overflow-hidden rounded-full bg-muted"
              // 这一条就是「用了多少」的唯一进度条：填充比例 = 已用 / 窗口，
              // 剩余轨道 = 空闲。分段只解释填充的构成，不再单独画一条总长条。
              role="progressbar"
              aria-label={t("overview.context.title")}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(usage.percentage)}
            >
              {breakdown.rows.map((row) => (
                <div
                  key={row.id}
                  className={`h-full ${SEGMENT_CLASS[row.id]}`}
                  style={{ width: `${row.percent}%` }}
                />
              ))}
            </div>
          )}
          <ul className="space-y-0.5">
            {breakdown.rows.map((row) => (
              <BreakdownRow
                key={row.id}
                // 没量到三块比例时这一行是整个残差，标签必须退回合并版 ——
                // 否则「系统提示词 ≈108.6k」把工具与技能冒充成了系统提示词。
                label={t(
                  row.id === "system" && !breakdown.systemSplit
                    ? MERGED_SYSTEM_LABEL_KEY
                    : LABEL_KEY[row.id],
                )}
                tokens={row.tokens}
                percent={row.percent}
                swatch={DOT_CLASS[row.id]}
                showPercent={showPercent}
              />
            ))}
            {breakdown.freeTokens !== null && breakdown.freeTokens > 0 && (
              <BreakdownRow
                label={t("overview.context.breakdownFree")}
                tokens={breakdown.freeTokens}
                percent={breakdown.freePercent}
                swatch={DOT_CLASS.free}
                showPercent={showPercent}
                // 总量本身是估算（压缩后）时，空闲也不是精确值。
                estimated={usage.isEstimated}
              />
            )}
          </ul>
          {breakdown.scaled && (
            <p className="px-1 text-[11px] text-muted-foreground">
              {t("overview.context.breakdownScaled")}
            </p>
          )}
        </div>
      )}
    </OverviewSection>
  );
}
