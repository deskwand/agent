import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useAppStore } from "../../store";
import {
  buildOverviewBackgroundTasks,
  type BackgroundAgentRow,
} from "../../utils/subagent-card";
import { getToolLabel } from "../message/toolHelpers";
import { SubagentSteps } from "../message/SubagentSteps";
import { Tooltip, TooltipContent, TooltipTrigger } from "../app-tooltip";
import { OverviewSection } from "./OverviewSection";

const MAX_FINISHED_ROWS = 5;

function durationLabel(durationMs: number): string | null {
  if (durationMs <= 0) return null;
  return durationMs < 1000
    ? `${durationMs}ms`
    : `${(durationMs / 1000).toFixed(1)}s`;
}

function TaskRow({
  row,
  expanded,
  onToggle,
}: {
  row: BackgroundAgentRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  const title = row.name || row.type || row.description || row.toolCallId;
  const subtitle = row.currentLabel || row.description;
  const duration = durationLabel(row.durationMs);
  const dotClass =
    row.status === "running"
      ? "bg-primary"
      : row.status === "error"
        ? "bg-destructive"
        : "bg-muted-foreground/50";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          data-bg-task={row.toolCallId}
          className={`flex w-full items-start gap-2 rounded px-1 py-1 text-left transition-colors hover:bg-hover-surface ${
            expanded ? "bg-hover-surface" : ""
          }`}
        >
          <span
            className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs text-foreground">
              {title}
            </span>
            {subtitle && (
              <span className="block truncate text-[11px] text-muted-foreground">
                {subtitle}
              </span>
            )}
          </span>
          {duration && (
            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
              {duration}
            </span>
          )}
          <span className="mt-0.5 shrink-0 text-muted-foreground">
            {expanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="left">{row.description ?? title}</TooltipContent>
    </Tooltip>
  );
}

export function BackgroundTasksSection() {
  const { t, i18n } = useTranslation();
  const activities = useAppStore((s) =>
    s.activeSessionId
      ? s.sessionStates[s.activeSessionId]?.subagentActivities
      : undefined,
  );
  const focusId = useAppStore((s) => s.overviewTaskFocusId);
  const focusNonce = useAppStore((s) => s.overviewTaskFocusNonce);
  const clearOverviewTaskFocus = useAppStore((s) => s.clearOverviewTaskFocus);

  // 同一时刻只展开一条：步骤列表本身就很长，两条并排会把这栏撑成一条流水账。
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showFinished, setShowFinished] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  // 等目标行真的进了 DOM 再滚（它可能还折叠在「已完成」里）。
  const pendingScrollRef = useRef<string | null>(null);

  const { running, finished } = buildOverviewBackgroundTasks(
    activities,
    (step) => getToolLabel(step.toolName, step.args, t),
    i18n.language,
  );

  // 外部（消息区那行 / 输入框 chip）点名要看的任务：展开它所在的组，再展开它自己。
  // 触发看 nonce 而不是 id：同一条重复点名（面板里刚收起、消息区又点了一次）也必须再展开。
  // 依赖里只放 nonce —— running/finished 每次渲染都是新数组，放进来会反复调度滚动。
  useEffect(() => {
    if (!focusId) return;
    setExpandedId(focusId);
    pendingScrollRef.current = focusId;
    setShowFinished(
      (value) => value || finished.some((row) => row.toolCallId === focusId),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce]);

  // 行已经在 DOM 里才滚，滚完清掉请求（它是一次性的）。
  useEffect(() => {
    const id = pendingScrollRef.current;
    if (!id || !listRef.current) return;
    const node = listRef.current.querySelector<HTMLElement>(
      `[data-bg-task="${id}"]`,
    );
    if (!node) return;
    node.scrollIntoView?.({ block: "nearest" });
    pendingScrollRef.current = null;
    clearOverviewTaskFocus();
  }, [focusId, expandedId, showFinished, clearOverviewTaskFocus]);

  const finishedVisible = showFinished
    ? finished.slice(0, MAX_FINISHED_ROWS)
    : [];
  // 折叠在「已完成」之下、又被点名的那一条：它可能落在截断之外，单独补一行 ——
  // 否则从消息区点过来会看起来毫无反应。
  const pinnedFinished =
    expandedId && !finishedVisible.some((row) => row.toolCallId === expandedId)
      ? finished.find((row) => row.toolCallId === expandedId)
      : undefined;

  const renderRows = (list: BackgroundAgentRow[]) =>
    list.map((row) => (
      <div key={row.toolCallId}>
        <TaskRow
          row={row}
          expanded={expandedId === row.toolCallId}
          onToggle={() =>
            setExpandedId((current) =>
              current === row.toolCallId ? null : row.toolCallId,
            )
          }
        />
        {expandedId === row.toolCallId && activities?.[row.toolCallId] ? (
          <SubagentSteps activity={activities[row.toolCallId]} inset={false} />
        ) : null}
      </div>
    ));

  return (
    <OverviewSection titleKey="overview.tasks.title">
      <div ref={listRef}>
        {running.length === 0 && finished.length === 0 && (
          <p className="px-1 text-xs text-muted-foreground">
            {t("overview.tasks.empty")}
          </p>
        )}
        {renderRows(running)}
        {finished.length > 0 && (
          <button
            type="button"
            aria-label={t("overview.tasks.finishedCount")}
            aria-expanded={showFinished}
            onClick={() => setShowFinished((value) => !value)}
            className="flex w-full items-center gap-1 rounded px-1 py-1 text-left text-[11px] text-muted-foreground hover:bg-hover-surface"
          >
            {showFinished ? (
              <ChevronDown className="h-3 w-3 shrink-0" />
            ) : (
              <ChevronRight className="h-3 w-3 shrink-0" />
            )}
            {showFinished
              ? t("overview.tasks.showLess")
              : t("overview.tasks.finishedCount", { count: finished.length })}
          </button>
        )}
        {renderRows(finishedVisible)}
        {pinnedFinished ? renderRows([pinnedFinished]) : null}
      </div>
    </OverviewSection>
  );
}
