/**
 * @module renderer/components/ScheduleToolbar
 *
 * Navigation bar: Today button, ←/→ arrows, date display, Day|Week|Month tabs.
 */

import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import type { CalendarView } from "./ScheduleCalendar";
import { WEEKDAY_LONG_KEYS } from "../../shared/schedule/weekday-keys";
import { Button } from "./app-button";

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
    <div className="flex items-center justify-between px-3 py-2 border-b border-border/60 bg-card">
      {/* Left: nav */}
      <div className="flex items-center gap-1">
        <Button variant="ghost"
          type="button"
          onClick={onToday}
          className="px-3 py-1 text-xs font-medium rounded-md border border-border hover:bg-accent text-muted-foreground transition-colors h-auto"
        >
          {t("schedule.today")}
        </Button>
        <Button variant="ghost"
          type="button"
          onClick={onNavigatePrev}
          className="p-1 rounded-md hover:bg-accent text-muted-foreground transition-colors h-auto"
          aria-label={t("schedule.toolbarPrev")}
        >
          <ChevronLeft size={16} />
        </Button>
        <Button variant="ghost"
          type="button"
          onClick={onNavigateNext}
          className="p-1 rounded-md hover:bg-accent text-muted-foreground transition-colors h-auto"
          aria-label={t("schedule.toolbarNext")}
        >
          <ChevronRight size={16} />
        </Button>
        <span className="ml-2 text-sm font-medium text-foreground">
          {dateHeader}
        </span>
      </div>

      {/* Right: view tabs + create */}
      <div className="flex items-center gap-2">
        <div className="flex items-center bg-muted rounded-lg p-0.5 border border-border">
          {VIEW_OPTIONS.map((opt) => (
            <Button variant="ghost"
              key={opt.value}
              type="button"
              onClick={() => onViewChange(opt.value)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                view === opt.value
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-muted-foreground"
              }`}
            >
              {t(opt.i18nKey)}
            </Button>
          ))}
        </div>
        <Button variant="ghost"
          type="button"
          onClick={onCreateClick}
          className="flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors h-auto"
        >
          <Plus size={14} />
          {t("schedule.create")}
        </Button>
      </div>
    </div>
  );
}
