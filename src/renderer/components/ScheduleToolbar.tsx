/**
 * @module renderer/components/ScheduleToolbar
 *
 * Navigation bar: Today button, ←/→ arrows, date display, Day|Week|Month tabs.
 */

import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import type { CalendarView } from "./ScheduleCalendar";
import { WEEKDAY_LONG_KEYS } from "../../shared/schedule/weekday-keys";

export interface ScheduleToolbarProps {
  view: CalendarView;
  currentDate: Date;
  onViewChange: (view: CalendarView) => void;
  onNavigatePrev: () => void;
  onNavigateNext: () => void;
  onToday: () => void;
  onCreateClick: () => void;
}

const VIEW_OPTIONS: { value: CalendarView; i18nKey: string }[] = [
  { value: "day", i18nKey: "schedule.viewDay" },
  { value: "week", i18nKey: "schedule.viewWeek" },
  { value: "month", i18nKey: "schedule.viewMonth" },
];

export function ScheduleToolbar({
  view,
  currentDate,
  onViewChange,
  onNavigatePrev,
  onNavigateNext,
  onToday,
  onCreateClick,
}: ScheduleToolbarProps) {
  const { t } = useTranslation();

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth() + 1;
  const day = currentDate.getDate();
  const weekday = t(WEEKDAY_LONG_KEYS[currentDate.getDay()]);

  const dateHeader =
    view === "day"
      ? t("schedule.dateFormatDay", { year, month, day, weekday })
      : t("schedule.dateFormatMonth", { year, month });

  return (
    <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-surface">
      {/* Left: nav */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onToday}
          className="px-3 py-1 text-xs font-medium rounded-md border border-border hover:bg-surface-hover text-text-secondary transition-colors"
        >
          {t("schedule.today")}
        </button>
        <button
          type="button"
          onClick={onNavigatePrev}
          className="p-1 rounded-md hover:bg-surface-hover text-text-muted transition-colors"
          aria-label={t("schedule.toolbarPrev")}
        >
          <ChevronLeft size={16} />
        </button>
        <button
          type="button"
          onClick={onNavigateNext}
          className="p-1 rounded-md hover:bg-surface-hover text-text-muted transition-colors"
          aria-label={t("schedule.toolbarNext")}
        >
          <ChevronRight size={16} />
        </button>
        <span className="ml-2 text-sm font-medium text-text-primary">
          {dateHeader}
        </span>
      </div>

      {/* Right: view tabs + create */}
      <div className="flex items-center gap-2">
        <div className="flex items-center bg-surface-muted rounded-lg p-0.5 border border-border">
          {VIEW_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onViewChange(opt.value)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                view === opt.value
                  ? "bg-surface text-text-primary shadow-sm"
                  : "text-text-muted hover:text-text-secondary"
              }`}
            >
              {t(opt.i18nKey)}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onCreateClick}
          className="flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-lg bg-accent text-accent-foreground hover:bg-accent/90 transition-colors"
        >
          <Plus size={14} />
          {t("schedule.create")}
        </button>
      </div>
    </div>
  );
}
