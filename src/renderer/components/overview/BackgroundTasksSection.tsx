import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../store";
import {
  buildOverviewBackgroundTasks,
  type BackgroundAgentRow,
} from "../../utils/subagent-card";
import { getToolLabel } from "../message/toolHelpers";
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
  onClick,
}: {
  row: BackgroundAgentRow;
  onClick: () => void;
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
    <button
      type="button"
      onClick={onClick}
      title={row.description ?? title}
      className="flex w-full items-start gap-2 rounded px-1 py-1 text-left hover:bg-hover-surface"
    >
      <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs text-foreground">{title}</span>
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
    </button>
  );
}

export function BackgroundTasksSection() {
  const { t, i18n } = useTranslation();
  const activities = useAppStore((s) =>
    s.activeSessionId
      ? s.sessionStates[s.activeSessionId]?.subagentActivities
      : undefined,
  );
  const requestFocusToolCall = useAppStore((s) => s.requestFocusToolCall);
  const [expanded, setExpanded] = useState(false);

  const { running, finished } = buildOverviewBackgroundTasks(
    activities,
    (step) => getToolLabel(step.toolName, step.args, t),
    i18n.language,
  );
  const finishedVisible = expanded ? finished.slice(0, MAX_FINISHED_ROWS) : [];

  return (
    <OverviewSection titleKey="overview.tasks.title">
      {running.length === 0 && finished.length === 0 && (
        <p className="px-1 text-xs text-muted-foreground">
          {t("overview.tasks.empty")}
        </p>
      )}
      {running.map((row) => (
        <TaskRow
          key={row.toolCallId}
          row={row}
          onClick={() => requestFocusToolCall(row.toolCallId)}
        />
      ))}
      {finished.length > 0 && (
        <button
          type="button"
          aria-label={t("overview.tasks.finishedCount")}
          onClick={() => setExpanded((value) => !value)}
          className="w-full rounded px-1 py-1 text-left text-[11px] text-muted-foreground hover:bg-hover-surface"
        >
          {expanded
            ? t("overview.tasks.showLess")
            : t("overview.tasks.finishedCount", { count: finished.length })}
        </button>
      )}
      {finishedVisible.map((row) => (
        <TaskRow
          key={row.toolCallId}
          row={row}
          onClick={() => requestFocusToolCall(row.toolCallId)}
        />
      ))}
    </OverviewSection>
  );
}
