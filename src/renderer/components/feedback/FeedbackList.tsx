import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  Bug,
  Lightbulb,
  MessageCircle,
  Plus,
  RefreshCw,
} from "lucide-react";
import { formatAppDateTime } from "../../utils/i18n-format";
import { cn } from "../../utils/cn";
import { Button } from "../app-button";
import { PAGE_INSET_X } from "../page-styles";
import type {
  FeedbackIssueSummary,
  FeedbackStatus,
} from "../../../shared/feedback";
import { STATUS_LABEL_KEYS } from "./feedback-format";

export type FeedbackFilter = "all" | FeedbackStatus;

const TYPE_ICONS = {
  bug: Bug,
  feature: Lightbulb,
  other: MessageCircle,
} as const;

export function FeedbackList({
  issues,
  selectedId,
  filter,
  loading,
  error,
  total,
  onFilter,
  onSelect,
  onRefresh,
  onLoadMore,
  onNew,
  onBack,
}: {
  issues: FeedbackIssueSummary[];
  selectedId: string | null;
  filter: FeedbackFilter;
  loading: boolean;
  error: string | null;
  total: number;
  onFilter: (filter: FeedbackFilter) => void;
  onSelect: (id: string) => void;
  onRefresh: () => void;
  onLoadMore: () => void;
  onNew: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const filters: FeedbackFilter[] = ["all", "open", "resolved"];

  return (
    <aside className="flex w-[300px] shrink-0 flex-col border-r border-border bg-card/30">
      <header className={`border-b border-border/60 ${PAGE_INSET_X} pb-3 pt-4`}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              onClick={onBack}
              aria-label={t("common.back")}
              className="-ml-1.5 h-auto rounded-lg p-1.5 transition-colors hover:bg-hover-surface"
            >
              <ArrowLeft className="h-5 w-5 text-muted-foreground" />
            </Button>
            <h2 className="truncate text-base font-semibold text-foreground">
              {t("feedback.title")}
            </h2>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="iconSm"
            aria-label={t("feedback.refresh")}
            onClick={onRefresh}
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t("feedback.subtitle")}
        </p>
        <Button
          type="button"
          className="mt-3 w-full justify-center"
          onClick={onNew}
        >
          <Plus className="h-4 w-4" />
          {t("feedback.new")}
        </Button>
        <div className="mt-3 flex gap-1 rounded-control bg-muted/40 p-0.5">
          {filters.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => onFilter(value)}
              className={cn(
                "flex-1 rounded-control px-2 py-1 text-xs transition-colors",
                filter === value
                  ? "bg-selected-surface text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {value === "all"
                ? t("feedback.filter.all")
                : t(STATUS_LABEL_KEYS[value])}
            </button>
          ))}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <div className="space-y-2 px-4 py-3 text-xs text-destructive">
            <p>{t(error)}</p>
            <Button type="button" variant="ghost" size="sm" onClick={onRefresh}>
              {t("feedback.detail.retry")}
            </Button>
          </div>
        ) : null}
        {loading && issues.length === 0 ? (
          <div className="space-y-3 px-4 py-4">
            {[0, 1, 2].map((index) => (
              <div
                key={index}
                className="h-14 animate-pulse rounded-control bg-muted/30"
              />
            ))}
          </div>
        ) : issues.length === 0 ? (
          <div className="px-6 py-10 text-center text-xs text-muted-foreground">
            {t("feedback.empty")}
          </div>
        ) : (
          issues.map((issue) => {
            const Icon = TYPE_ICONS[issue.type];
            return (
              <button
                key={issue.id}
                type="button"
                onClick={() => onSelect(issue.id)}
                aria-current={issue.id === selectedId ? "true" : undefined}
                className={cn(
                  "flex w-full items-start gap-2.5 border-b border-border/40 px-4 py-3 text-left transition-colors hover:bg-hover-surface",
                  issue.id === selectedId &&
                    "bg-selected-surface shadow-[inset_2px_0_0_var(--primary)]",
                )}
              >
                <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md bg-muted/50 text-muted-foreground">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-foreground">
                    {issue.title}
                  </span>
                  <span className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                    <span className="truncate">
                      {t("feedback.author.handle", {
                        handle: issue.author.handle,
                      })}
                    </span>
                    <span>·</span>
                    <span>{formatAppDateTime(issue.createdAt)}</span>
                    <span className="ml-auto inline-flex items-center gap-0.5">
                      <MessageCircle className="h-3 w-3" />
                      {issue.replyCount}
                    </span>
                  </span>
                </span>
                <span
                  title={t(STATUS_LABEL_KEYS[issue.status])}
                  className={cn(
                    "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                    issue.status === "open" ? "bg-warning" : "bg-success",
                  )}
                />
              </button>
            );
          })
        )}
        {issues.length > 0 && issues.length < total ? (
          <div className="p-2">
            <Button
              type="button"
              variant="ghost"
              className="w-full justify-center text-xs text-muted-foreground"
              disabled={loading}
              onClick={onLoadMore}
            >
              {t("feedback.loadMore")}
            </Button>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
