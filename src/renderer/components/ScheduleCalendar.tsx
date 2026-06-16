/**
 * @module renderer/components/ScheduleCalendar
 *
 * Calendar grid with three views: Day / Week / Month.
 * Projects scheduled tasks onto a time grid using shared/calendar-events.
 * Emits onSlotClick (empty slot) and onTaskClick (existing task).
 */

import { useMemo, useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { ScheduleTask } from "../types";
import {
  getCalendarEvents,
  getMonthCellEvents,
  type CalendarEvent,
  type MonthCellEvent,
} from "../../shared/schedule/calendar-events";
import {
  WEEKDAY_LONG_KEYS,
  WEEKDAY_SHORT_KEYS,
} from "../../shared/schedule/weekday-keys";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CalendarView = "day" | "week" | "month";

export interface ScheduleCalendarProps {
  tasks: ScheduleTask[];
  view: CalendarView;
  /** Midnight timestamp of the first visible day (local). */
  currentDate: Date;
  onSlotClick?: (date: Date, time?: string) => void;
  onTaskClick?: (taskId: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HOUR_HEIGHT = 56; // px per hour
const EVENT_MIN_HEIGHT = 20;
const EVENT_DURATION_MS = 30 * 60 * 1000;

function dayMidnight(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function addDays(d: Date, n: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatHour(h: number): string {
  return `${String(h).padStart(2, "0")}:00`;
}

function timeString(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Deterministic color from task id (hue 0-360). */
function taskColor(taskId: string): string {
  let hash = 0;
  for (let i = 0; i < taskId.length; i++) {
    hash = ((hash << 5) - hash + taskId.charCodeAt(i)) | 0;
  }
  return `hsl(${Math.abs(hash) % 360}, 55%, 48%)`;
}

/** Build a stable set of week-start days for the month view grid. */
function buildMonthGrid(year: number, month: number): Date[][] {
  const firstDay = new Date(year, month, 1);
  const startDay = firstDay.getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: Date[] = [];
  // Leading blanks
  for (let i = 0; i < startDay; i++) {
    cells.push(new Date(year, month, 1 - startDay + i));
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(new Date(year, month, d));
  }
  // Trailing blanks to fill 6 rows
  while (cells.length < 42) {
    const last = cells[cells.length - 1];
    cells.push(
      new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1),
    );
  }

  const grid: Date[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    grid.push(cells.slice(i, i + 7));
  }
  return grid;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ScheduleCalendar({
  tasks,
  view,
  currentDate,
  onSlotClick,
  onTaskClick,
}: ScheduleCalendarProps) {
  const today = dayMidnight(new Date());
  const { t } = useTranslation();

  // Compute range once
  const range = useMemo(() => {
    const start = dayMidnight(currentDate);
    if (view === "day") {
      return { start, end: addDays(start, 1) };
    }
    if (view === "week") {
      // Week starts Sunday
      const dayOfWeek = start.getDay();
      const weekStart = addDays(start, -dayOfWeek);
      return { start: weekStart, end: addDays(weekStart, 7) };
    }
    // Month: show 6-week grid
    const first = new Date(start.getFullYear(), start.getMonth(), 1);
    const firstGridDay = addDays(first, -first.getDay());
    const lastGridDay = addDays(firstGridDay, 41);
    const end = new Date(
      lastGridDay.getFullYear(),
      lastGridDay.getMonth(),
      lastGridDay.getDate() + 1,
    );
    return { start: firstGridDay, end };
  }, [currentDate, view]);

  const events = useMemo(
    () =>
      getCalendarEvents(tasks, range.start.getTime(), range.end.getTime() - 1),
    [tasks, range],
  );

  const monthCells = useMemo(() => {
    if (view !== "month") return null;
    return getMonthCellEvents(
      tasks,
      currentDate.getFullYear(),
      currentDate.getMonth(),
    );
  }, [tasks, currentDate, view]);

  const handleSlotClick = useCallback(
    (date: Date, time?: string) => {
      onSlotClick?.(date, time);
    },
    [onSlotClick],
  );

  if (view === "day") {
    return (
      <DayView
        date={currentDate}
        events={events}
        onSlotClick={handleSlotClick}
        onTaskClick={onTaskClick}
      />
    );
  }
  if (view === "week") {
    const weekStart = addDays(range.start, 0);
    return (
      <WeekView
        weekStart={weekStart}
        events={events}
        today={today}
        onSlotClick={handleSlotClick}
        onTaskClick={onTaskClick}
        t={t}
      />
    );
  }
  return (
    <MonthView
      year={currentDate.getFullYear()}
      month={currentDate.getMonth()}
      cells={monthCells}
      today={today}
      onSlotClick={handleSlotClick}
      onTaskClick={onTaskClick}
      t={t}
    />
  );
}

// ---------------------------------------------------------------------------
// DayView
// ---------------------------------------------------------------------------

function DayView({
  date,
  events,
  onSlotClick,
  onTaskClick,
}: {
  date: Date;
  events: CalendarEvent[];
  onSlotClick?: (date: Date, time?: string) => void;
  onTaskClick?: (taskId: string) => void;
}) {
  const dayStart = dayMidnight(date);
  const dayEnd = addDays(dayStart, 1);
  const dayEvents = events.filter(
    (e) => e.start >= dayStart.getTime() && e.start < dayEnd.getTime(),
  );

  const hours = Array.from({ length: 24 }, (_, i) => i);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 8 * HOUR_HEIGHT;
  }, []);

  return (
    <div ref={scrollRef} className="flex flex-col h-full overflow-auto">
      {/* All-day area — none for now */}
      <div className="flex">
        <div className="w-12 flex-shrink-0" />
        <div className="flex-1 min-h-2" />
      </div>

      {/* Time grid */}
      <div className="relative flex flex-1">
        {/* Time axis */}
        <div className="w-12 flex-shrink-0">
          {hours.map((h) => (
            <div
              key={h}
              className="text-xs text-text-muted text-right pr-2"
              style={{
                height: HOUR_HEIGHT,
                lineHeight: `${HOUR_HEIGHT}px`,
                transform: "translateY(-0.5em)",
              }}
            >
              {h === 0 ? null : formatHour(h)}
            </div>
          ))}
        </div>

        {/* Event area */}
        <div className="relative flex-1 border-l border-border">
          {hours.map((h) => (
            <div
              key={h}
              className="border-t border-border-muted cursor-pointer hover:bg-surface-hover/50"
              style={{ height: HOUR_HEIGHT }}
              onClick={() => {
                const d = new Date(date);
                d.setHours(h, 0, 0, 0);
                onSlotClick?.(d, formatHour(h));
              }}
            />
          ))}

          {/* Event cards */}
          {dayEvents.map((ev) => {
            const startDate = new Date(ev.start);
            const hoursFloat =
              startDate.getHours() + startDate.getMinutes() / 60;
            const top = hoursFloat * HOUR_HEIGHT;
            const height = Math.max(
              EVENT_MIN_HEIGHT,
              (EVENT_DURATION_MS / (60 * 60 * 1000)) * HOUR_HEIGHT,
            );

            const color = taskColor(ev.taskId);
            const isDisabled = !ev.enabled;

            return (
              <div
                key={`${ev.taskId}-${ev.start}`}
                className={`absolute left-1 right-1 rounded-lg px-2 py-1 cursor-pointer overflow-hidden border transition-opacity ${
                  isDisabled ? "opacity-40" : ""
                } ${ev.isRepeating ? "border-dashed" : "border-solid"}`}
                style={{
                  top,
                  height,
                  backgroundColor: `${color}18`,
                  borderColor: `${color}60`,
                  color,
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  onTaskClick?.(ev.taskId);
                }}
              >
                <div className="text-xs font-medium truncate leading-tight">
                  {ev.title}
                </div>
                <div className="text-xs opacity-70 leading-tight">
                  {timeString(startDate)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// WeekView
// ---------------------------------------------------------------------------

function WeekView({
  weekStart,
  events,
  today,
  onSlotClick,
  onTaskClick,
  t,
}: {
  weekStart: Date;
  events: CalendarEvent[];
  today: Date;
  onSlotClick?: (date: Date, time?: string) => void;
  onTaskClick?: (taskId: string) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const hours = Array.from({ length: 24 }, (_, i) => i);

  return (
    <div className="flex flex-col h-full overflow-auto">
      {/* Header row */}
      <div className="flex border-b border-border sticky top-0 bg-surface z-10">
        <div className="w-12 flex-shrink-0" />
        {days.map((day) => {
          const isToday = sameDay(day, today);
          return (
            <div key={day.getTime()} className="flex-1 text-center py-2">
              <div className="text-xs text-text-muted">
                {t(WEEKDAY_LONG_KEYS[day.getDay()])}
              </div>
              <div
                className={`text-sm font-medium inline-flex items-center justify-center w-7 h-7 rounded-full ${
                  isToday
                    ? "bg-accent text-accent-foreground"
                    : "text-text-primary"
                }`}
              >
                {day.getDate()}
              </div>
            </div>
          );
        })}
      </div>

      {/* Grid */}
      <div className="flex flex-1 overflow-auto">
        <div className="w-12 flex-shrink-0">
          {hours.map((h) => (
            <div
              key={h}
              className="text-xs text-text-muted text-right pr-2"
              style={{
                height: HOUR_HEIGHT,
                lineHeight: `${HOUR_HEIGHT}px`,
                transform: "translateY(-0.5em)",
              }}
            >
              {h === 0 ? null : formatHour(h)}
            </div>
          ))}
        </div>

        <div className="flex flex-1 border-l border-border">
          {days.map((day) => {
            const dayStart = dayMidnight(day);
            const dayEnd = addDays(dayStart, 1);
            const dayEvents = events.filter(
              (e) =>
                e.start >= dayStart.getTime() && e.start < dayEnd.getTime(),
            );

            return (
              <div
                key={day.getTime()}
                className="relative flex-1 border-r border-border-muted last:border-r-0"
              >
                {hours.map((h) => (
                  <div
                    key={h}
                    className="border-t border-border-muted cursor-pointer hover:bg-surface-hover/50"
                    style={{ height: HOUR_HEIGHT }}
                    onClick={() => {
                      const d = new Date(day);
                      d.setHours(h, 0, 0, 0);
                      onSlotClick?.(d, formatHour(h));
                    }}
                  />
                ))}

                {dayEvents.map((ev) => {
                  const startDate = new Date(ev.start);
                  const hoursFloat =
                    startDate.getHours() + startDate.getMinutes() / 60;
                  const top = hoursFloat * HOUR_HEIGHT;
                  const height = Math.max(
                    EVENT_MIN_HEIGHT,
                    (EVENT_DURATION_MS / (60 * 60 * 1000)) * HOUR_HEIGHT,
                  );
                  const color = taskColor(ev.taskId);
                  const isDisabled = !ev.enabled;

                  return (
                    <div
                      key={`${ev.taskId}-${ev.start}`}
                      className={`absolute left-0.5 right-0.5 rounded px-1 py-0.5 cursor-pointer overflow-hidden border transition-opacity ${
                        isDisabled ? "opacity-40" : ""
                      } ${ev.isRepeating ? "border-dashed" : "border-solid"}`}
                      style={{
                        top,
                        height,
                        backgroundColor: `${color}14`,
                        borderColor: `${color}50`,
                        color,
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onTaskClick?.(ev.taskId);
                      }}
                    >
                      <div className="text-xs font-medium truncate leading-tight">
                        {ev.title}
                      </div>
                      <div className="text-xs opacity-70 leading-tight">
                        {timeString(startDate)}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MonthView
// ---------------------------------------------------------------------------

function MonthView({
  year,
  month,
  cells,
  today,
  onSlotClick,
  onTaskClick,
  t,
}: {
  year: number;
  month: number;
  cells: ReturnType<typeof getMonthCellEvents> | null;
  today: Date;
  onSlotClick?: (date: Date, time?: string) => void;
  onTaskClick?: (taskId: string) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const grid = buildMonthGrid(year, month);
  const isCurrentMonth = (d: Date) => d.getMonth() === month;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="grid grid-cols-7 border-b border-border">
        {WEEKDAY_SHORT_KEYS.map((key) => (
          <div
            key={key}
            className="text-center text-xs text-text-muted py-2 font-medium"
          >
            {t(key)}
          </div>
        ))}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-7 flex-1 auto-rows-fr">
        {grid.flat().map((dayDate, idx) => {
          const day = dayDate.getDate();
          const inMonth = isCurrentMonth(dayDate);
          const isToday = sameDay(dayDate, today);
          const cell = cells?.get(day) ?? null;

          return (
            <div
              key={idx}
              className={`border-r border-b border-border-muted p-1 cursor-pointer hover:bg-surface-hover/30 transition-colors ${
                inMonth ? "" : "opacity-40"
              } ${idx % 7 === 0 ? "border-l" : ""}`}
              onClick={() => {
                if (inMonth) {
                  onSlotClick?.(dayDate);
                }
              }}
            >
              {/* Date number */}
              <div className="flex justify-center mb-0.5">
                <span
                  className={`text-xs inline-flex items-center justify-center w-6 h-6 rounded-full ${
                    isToday
                      ? "bg-accent text-accent-foreground font-semibold"
                      : "text-text-secondary"
                  }`}
                >
                  {day}
                </span>
              </div>

              {/* Events */}
              {cell && cell.events.length > 0 && (
                <div className="space-y-0.5">
                  {renderMonthCellEvents(cell.events, inMonth, t, onTaskClick)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Merge rule: >3 events from same taskId → "TaskName (N次)". */
function renderMonthCellEvents(
  events: MonthCellEvent[],
  inMonth: boolean,
  t: (key: string, options?: Record<string, unknown>) => string,
  onTaskClick?: (taskId: string) => void,
): React.ReactNode[] {
  const groups = new Map<string, MonthCellEvent[]>();
  for (const ev of events) {
    const list = groups.get(ev.taskId) || [];
    list.push(ev);
    groups.set(ev.taskId, list);
  }

  const items: React.ReactNode[] = [];
  let taskCount = 0;

  for (const [taskId, evs] of groups) {
    if (taskCount >= 3) {
      const remaining = groups.size - taskCount;
      if (remaining > 0) {
        items.push(
          <div key="more" className="text-xs text-text-muted pl-1">
            {t("schedule.monthMoreEvents", { count: remaining })}
          </div>,
        );
      }
      break;
    }

    const first = evs[0];
    const color = taskColor(taskId);
    const isDisabled = !first.enabled;
    const opacity = isDisabled || !inMonth ? "opacity-40" : "";

    if (evs.length > 3) {
      items.push(
        <div
          key={taskId}
          className={`text-xs leading-tight px-1 rounded truncate cursor-pointer ${opacity}`}
          style={{ backgroundColor: `${color}18`, color }}
          title={first.title}
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation();
            onTaskClick?.(taskId);
          }}
        >
          <span
            className="inline-block w-1.5 h-1.5 rounded-full mr-0.5 align-middle"
            style={{ backgroundColor: color }}
          />
          {first.title}
          <span className="text-text-muted ml-0.5">
            {t("schedule.monthEventCount", { count: evs.length })}
          </span>
        </div>,
      );
    } else {
      for (const ev of evs) {
        items.push(
          <div
            key={`${ev.taskId}-${ev.time}`}
            className={`text-xs leading-tight px-1 rounded truncate cursor-pointer ${opacity}`}
            style={{ backgroundColor: `${color}18`, color }}
            title={`${ev.title} ${ev.time}`}
            onClick={(e: React.MouseEvent) => {
              e.stopPropagation();
              onTaskClick?.(ev.taskId);
            }}
          >
            <span
              className="inline-block w-1.5 h-1.5 rounded-full mr-0.5 align-middle"
              style={{ backgroundColor: color }}
            />
            {ev.title} {ev.time}
          </div>,
        );
      }
    }

    taskCount++;
  }

  return items;
}
