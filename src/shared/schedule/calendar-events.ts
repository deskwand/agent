/**
 * @module shared/schedule/calendar-events
 *
 * Pure functions to project ScheduleTask[] onto a time range as calendar events.
 * No I/O, no framework dependencies — usable from main & renderer.
 *
 * CONVENTIONS (aligning with ScheduledTaskManager):
 * - All timestamps are Unix ms
 * - times[] are local "HH:mm" strings (24h)
 * - weekdays[] are 0-6 (Sunday=0 … Saturday=6)
 * - The "today" concept is resolved via local Date APIs
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CalendarEvent {
  /** The task this event belongs to */
  taskId: string;
  /** Display title (truncation is the UI's job) */
  title: string;
  /** Event start (Unix ms) */
  start: number;
  /** Event end (start + DEFAULT_EVENT_DURATION_MS, for visual sizing only) */
  end: number;
  /** Whether the parent task is enabled */
  enabled: boolean;
  /** Whether the parent task repeats (daily / weekly / interval) */
  isRepeating: boolean;
}

/** Minimal task shape needed for calendar projection. */
export interface CalendarTaskInput {
  id: string;
  title: string;
  runAt: number;
  nextRunAt: number | null;
  scheduleConfig: CalendarScheduleConfig | null;
  repeatEvery: number | null;
  repeatUnit: CalendarScheduleRepeatUnit | null;
  enabled: boolean;
}

export type CalendarScheduleRepeatUnit = "minute" | "hour" | "day";

export type CalendarScheduleConfig =
  | { kind: "daily"; times: string[] }
  | { kind: "weekly"; weekdays: number[]; times: string[] };

/** Per-day summary for the month-view cell. */
export interface MonthCellInfo {
  /** Day of month (1-31) */
  date: number;
  /** Midnight timestamp of this day (local) */
  timestamp: number;
  /** All events on this day (already filtered & sorted) */
  events: MonthCellEvent[];
  /** Total distinct task-titles (before merging) — convenience for "+N more" */
  totalCount: number;
}

export interface MonthCellEvent {
  taskId: string;
  title: string;
  /** "HH:mm" */
  time: string;
  enabled: boolean;
  isRepeating: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default visual duration for an event (30 min). Tasks have no natural end. */
const DEFAULT_EVENT_DURATION_MS = 30 * 60 * 1000;

/**
 * Safety cap to prevent browser-freeze when an interval task repeats
 * every minute across a month view.
 */
const MAX_OCCURRENCES_PER_TASK = 500;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Project all tasks onto [rangeStart, rangeEnd] as flat CalendarEvent[].
 *
 * - once tasks: emit iff `runAt` falls inside the range.
 * - daily tasks: for each day in range, for each time → 1 event.
 * - weekly tasks: for each day in range whose weekday is in `weekdays`,
 *   for each time → 1 event.
 * - interval tasks (legacy): start from `nextRunAt ?? runAt`, then keep
 *   adding `repeatEvery × repeatUnit` until past rangeEnd or
 *   MAX_OCCURRENCES_PER_TASK is reached.
 *
 * @returns events sorted by start ascending.
 */
export function getCalendarEvents(
  tasks: CalendarTaskInput[],
  rangeStart: number,
  rangeEnd: number,
): CalendarEvent[] {
  const events: CalendarEvent[] = [];

  for (const task of tasks) {
    if (task.scheduleConfig !== null) {
      expandScheduledTask(
        task,
        task.scheduleConfig,
        rangeStart,
        rangeEnd,
        events,
      );
    } else if (isIntervalTask(task)) {
      expandIntervalTask(task, rangeStart, rangeEnd, events);
    } else {
      expandOnceTask(task, rangeStart, rangeEnd, events);
    }
  }

  events.sort((a, b) => a.start - b.start);
  return events;
}

/**
 * Build per-day buckets for the month grid.
 *
 * Calls `getCalendarEvents` internally, then groups by day-of-month.
 * The returned Map keys are day numbers (1-31).
 */
export function getMonthCellEvents(
  tasks: CalendarTaskInput[],
  year: number,
  month: number, // 0-based (Jan = 0)
): Map<number, MonthCellInfo> {
  const firstDay = new Date(year, month, 1);
  const rangeStart = firstDay.getTime();
  const rangeEnd = new Date(year, month + 1, 1).getTime() - 1;

  const allEvents = getCalendarEvents(tasks, rangeStart, rangeEnd);
  const cells = new Map<number, MonthCellInfo>();

  for (const event of allEvents) {
    const d = new Date(event.start);
    const day = d.getDate();

    let cell = cells.get(day);
    if (!cell) {
      cell = {
        date: day,
        timestamp: new Date(year, month, day).getTime(),
        events: [],
        totalCount: 0,
      };
      cells.set(day, cell);
    }

    cell.events.push({
      taskId: event.taskId,
      title: event.title,
      time: formatTime(event.start),
      enabled: event.enabled,
      isRepeating: event.isRepeating,
    });
    cell.totalCount += 1;
  }

  return cells;
}

// ---------------------------------------------------------------------------
// Scheduled-task expansion
// ---------------------------------------------------------------------------

function expandScheduledTask(
  task: CalendarTaskInput,
  config: CalendarScheduleConfig,
  rangeStart: number,
  rangeEnd: number,
  out: CalendarEvent[],
): void {
  const times = normalizeTimes(config.times);
  if (times.length === 0) return;

  const weekdays =
    config.kind === "weekly"
      ? new Set(normalizeWeekdays(config.weekdays))
      : null;

  // Walk day-by-day from rangeStart's date through rangeEnd's date.
  const cursor = dayStart(rangeStart);
  const endDay = dayStart(rangeEnd);

  while (cursor.getTime() <= endDay.getTime()) {
    if (weekdays && !weekdays.has(cursor.getDay())) {
      cursor.setDate(cursor.getDate() + 1);
      continue;
    }

    for (const time of times) {
      const [h, m] = time;
      const ts = new Date(
        cursor.getFullYear(),
        cursor.getMonth(),
        cursor.getDate(),
        h,
        m,
        0,
        0,
      ).getTime();

      if (ts >= rangeStart && ts <= rangeEnd) {
        out.push({
          taskId: task.id,
          title: task.title || "Untitled",
          start: ts,
          end: ts + DEFAULT_EVENT_DURATION_MS,
          enabled: task.enabled,
          isRepeating: true,
        });
      }
    }

    cursor.setDate(cursor.getDate() + 1);
  }
}

function expandOnceTask(
  task: CalendarTaskInput,
  rangeStart: number,
  rangeEnd: number,
  out: CalendarEvent[],
): void {
  const ts = task.runAt;
  if (ts >= rangeStart && ts <= rangeEnd) {
    out.push({
      taskId: task.id,
      title: task.title || "Untitled",
      start: ts,
      end: ts + DEFAULT_EVENT_DURATION_MS,
      enabled: task.enabled,
      isRepeating: false,
    });
  }
}

function expandIntervalTask(
  task: CalendarTaskInput,
  rangeStart: number,
  rangeEnd: number,
  out: CalendarEvent[],
): void {
  const intervalMs = getIntervalMs(task.repeatEvery, task.repeatUnit);
  if (intervalMs === null) return;

  let cursor = task.nextRunAt ?? task.runAt;
  if (!Number.isFinite(cursor)) return;

  let count = 0;

  while (cursor <= rangeEnd && count < MAX_OCCURRENCES_PER_TASK) {
    if (cursor >= rangeStart) {
      out.push({
        taskId: task.id,
        title: task.title || "Untitled",
        start: cursor,
        end: cursor + DEFAULT_EVENT_DURATION_MS,
        enabled: task.enabled,
        isRepeating: true,
      });
      count += 1;
    }
    cursor += intervalMs;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse & validate "HH:mm" times, return as [hour, minute] pairs sorted. */
function normalizeTimes(times: string[]): Array<[number, number]> {
  if (!Array.isArray(times)) return [];

  const parsed: Array<[number, number]> = [];
  const seen = new Set<string>();

  for (const t of times) {
    if (typeof t !== "string") continue;
    if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    const [h, m] = t.split(":").map(Number);
    parsed.push([h, m]);
  }

  parsed.sort((a, b) => a[0] * 60 + a[1] - (b[0] * 60 + b[1]));
  return parsed;
}

/** Validate & deduplicate weekday numbers (0-6). */
function normalizeWeekdays(days: number[]): number[] {
  if (!Array.isArray(days)) return [];

  const set = new Set<number>();
  for (const d of days) {
    if (Number.isInteger(d) && d >= 0 && d <= 6) {
      set.add(d);
    }
  }
  return Array.from(set).sort((a, b) => a - b);
}

/** Convert repeatEvery + repeatUnit → milliseconds. Mirrors ScheduledTaskManager. */
function getIntervalMs(
  every: number | null,
  unit: CalendarScheduleRepeatUnit | null,
): number | null {
  if (!every || !unit) return null;
  if (!Number.isFinite(every) || every <= 0) return null;

  switch (unit) {
    case "minute":
      return every * 60 * 1000;
    case "hour":
      return every * 60 * 60 * 1000;
    case "day":
      return every * 24 * 60 * 60 * 1000;
    default:
      return null;
  }
}

/** Return a Date at 00:00:00.000 local time for the given timestamp's date. */
function dayStart(ts: number): Date {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** "HH:mm" from Unix ms (local). */
function formatTime(ts: number): string {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

/** True when task uses legacy interval-repeat mode. */
function isIntervalTask(task: CalendarTaskInput): boolean {
  return Boolean(task.repeatEvery && task.repeatUnit);
}
