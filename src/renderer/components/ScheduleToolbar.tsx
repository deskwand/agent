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
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";

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
        <Button
          variant="ghost"
          type="button"
          onClick={onToday}
          className="px-3 py-1 text-xs font-medium rounded-md border border-border hover:bg-accent text-muted-foreground transition-colors h-auto"
        >
          {t("schedule.today")}
        </Button>
        <Button
          variant="ghost"
          type="button"
          onClick={onNavigatePrev}
          className="p-1 rounded-md hover:bg-accent text-muted-foreground transition-colors h-auto"
          aria-label={t("schedule.toolbarPrev")}
        >
          <ChevronLeft size={16} />
        </Button>
        <Button
          variant="ghost"
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
        {/* 单选语义（role=radiogroup/radio、aria-checked、方向键漫游）交给 Radix。
            ⚠️ 再点当前视图时 Radix 会回传 `""`（取消选中）：视图是必选项，空串与未知值
            都不写回，否则 ScheduleView 的滚动/刷新语义会被清值连锁触发。 */}
        <ToggleGroup
          type="single"
          value={view}
          onValueChange={(next) => {
            if (next === "day" || next === "week" || next === "month") {
              onViewChange(next);
            }
          }}
          aria-label={t("schedule.viewLabel")}
          className="flex items-center gap-0 rounded-lg border border-border bg-muted p-0.5"
        >
          {VIEW_OPTIONS.map((opt) => (
            <ToggleGroupItem
              key={opt.value}
              value={opt.value}
              className="h-auto min-w-0 rounded-md px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-transparent hover:text-muted-foreground data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-sm"
            >
              {t(opt.i18nKey)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {/* 主操作走 default 变体（Task11 收敛），皮肤不再手写实心主色。 */}
        <Button
          variant="default"
          type="button"
          onClick={onCreateClick}
          className="flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-lg transition-colors h-auto"
        >
          <Plus size={14} />
          {t("schedule.create")}
        </Button>
      </div>
    </div>
  );
}
