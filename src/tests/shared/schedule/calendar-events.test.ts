/**
 * Tests for shared/schedule/calendar-events.ts
 *
 * Run: npx vitest run src/tests/shared/schedule/calendar-events.test.ts
 */

import { describe, it, expect } from "vitest";
import {
  getCalendarEvents,
  getMonthCellEvents,
  type CalendarTaskInput,
} from "../../../shared/schedule/calendar-events";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Helpers using local Date APIs — matching production code (calendar-events.ts
 * uses `new Date(y, m, d, h, m, 0, 0).getTime()` everywhere).
 */

function localMidnight(year: number, month: number, day: number): number {
  return new Date(year, month, day, 0, 0, 0, 0).getTime();
}

function localTs(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): number {
  return new Date(year, month, day, hour, minute, 0, 0).getTime();
}

function makeTask(
  overrides: Partial<CalendarTaskInput> = {},
): CalendarTaskInput {
  return {
    id: "task-1",
    title: "Test Task",
    runAt: localTs(2026, 5, 10, 14, 0), // June 10, 2026 14:00 local
    nextRunAt: null,
    scheduleConfig: null,
    repeatEvery: null,
    repeatUnit: null,
    enabled: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Once tasks
// ---------------------------------------------------------------------------

describe("once tasks", () => {
  it("emits event when runAt falls inside range", () => {
    const task = makeTask({ runAt: localTs(2026, 5, 10, 14, 0) });
    const rangeStart = localMidnight(2026, 5, 10);
    const rangeEnd = localMidnight(2026, 5, 11) - 1;

    const events = getCalendarEvents([task], rangeStart, rangeEnd);

    expect(events).toHaveLength(1);
    expect(events[0].taskId).toBe("task-1");
    expect(events[0].start).toBe(localTs(2026, 5, 10, 14, 0));
    expect(events[0].isRepeating).toBe(false);
  });

  it("emits nothing when runAt is before rangeStart", () => {
    const task = makeTask({ runAt: localTs(2026, 5, 9, 14, 0) });
    const rangeStart = localMidnight(2026, 5, 10);
    const rangeEnd = localMidnight(2026, 5, 11) - 1;

    const events = getCalendarEvents([task], rangeStart, rangeEnd);
    expect(events).toHaveLength(0);
  });

  it("emits nothing when runAt is after rangeEnd", () => {
    const task = makeTask({ runAt: localTs(2026, 5, 11, 14, 0) });
    const rangeStart = localMidnight(2026, 5, 10);
    const rangeEnd = localMidnight(2026, 5, 11) - 1;

    const events = getCalendarEvents([task], rangeStart, rangeEnd);
    expect(events).toHaveLength(0);
  });

  it("marks disabled once tasks with enabled=false", () => {
    const task = makeTask({
      runAt: localTs(2026, 5, 10, 14, 0),
      enabled: false,
    });
    const rangeStart = localMidnight(2026, 5, 10);
    const rangeEnd = localMidnight(2026, 5, 11) - 1;

    const events = getCalendarEvents([task], rangeStart, rangeEnd);

    expect(events).toHaveLength(1);
    expect(events[0].enabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Daily tasks
// ---------------------------------------------------------------------------

describe("daily tasks", () => {
  it("emits one event per time per day", () => {
    const task = makeTask({
      scheduleConfig: { kind: "daily", times: ["09:00", "14:00"] },
      nextRunAt: null,
      repeatEvery: null,
      repeatUnit: null,
    });
    // 2-day range → 2 days × 2 times = 4 events
    const rangeStart = localMidnight(2026, 5, 10);
    const rangeEnd = localMidnight(2026, 5, 12) - 1; // June 10-11

    const events = getCalendarEvents([task], rangeStart, rangeEnd);

    expect(events).toHaveLength(4);
    expect(events[0].start).toBe(localTs(2026, 5, 10, 9, 0));
    expect(events[1].start).toBe(localTs(2026, 5, 10, 14, 0));
    expect(events[2].start).toBe(localTs(2026, 5, 11, 9, 0));
    expect(events[3].start).toBe(localTs(2026, 5, 11, 14, 0));
    expect(events[0].isRepeating).toBe(true);
  });

  it("respects range boundaries", () => {
    const task = makeTask({
      scheduleConfig: { kind: "daily", times: ["14:00"] },
      nextRunAt: null,
      repeatEvery: null,
      repeatUnit: null,
    });
    // Range covers exactly half of June 10
    const rangeStart = localTs(2026, 5, 10, 12, 0);
    const rangeEnd = localTs(2026, 5, 10, 16, 0);

    const events = getCalendarEvents([task], rangeStart, rangeEnd);
    expect(events).toHaveLength(1);
    expect(events[0].start).toBe(localTs(2026, 5, 10, 14, 0));
  });

  it("skips times outside the range within a day", () => {
    const task = makeTask({
      scheduleConfig: { kind: "daily", times: ["08:00", "22:00"] },
      nextRunAt: null,
      repeatEvery: null,
      repeatUnit: null,
    });
    // Range only covers 09:00-21:00
    const rangeStart = localTs(2026, 5, 10, 9, 0);
    const rangeEnd = localTs(2026, 5, 10, 21, 0);

    const events = getCalendarEvents([task], rangeStart, rangeEnd);

    // 08:00 is before rangeStart, 22:00 is after rangeEnd → 0 events
    expect(events).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Weekly tasks
// ---------------------------------------------------------------------------

describe("weekly tasks", () => {
  it("emits events only on matching weekdays", () => {
    // June 10, 2026 is a Wednesday (3)
    // June 11 = Thursday (4), June 12 = Friday (5)
    const task = makeTask({
      scheduleConfig: {
        kind: "weekly",
        weekdays: [3, 5], // Wed & Fri
        times: ["10:00"],
      },
      nextRunAt: null,
      repeatEvery: null,
      repeatUnit: null,
    });
    const rangeStart = localMidnight(2026, 5, 10); // Wed
    const rangeEnd = localMidnight(2026, 5, 13) - 1; // Fri end

    const events = getCalendarEvents([task], rangeStart, rangeEnd);

    // Wed (Jun 10) + Fri (Jun 12) = 2 events
    expect(events).toHaveLength(2);
    expect(events[0].start).toBe(localTs(2026, 5, 10, 10, 0)); // Wed
    expect(events[1].start).toBe(localTs(2026, 5, 12, 10, 0)); // Fri
  });

  it("handles multiple times on matching weekdays", () => {
    const task = makeTask({
      scheduleConfig: {
        kind: "weekly",
        weekdays: [3], // Wed only
        times: ["09:00", "14:00", "18:00"],
      },
      nextRunAt: null,
      repeatEvery: null,
      repeatUnit: null,
    });
    const rangeStart = localMidnight(2026, 5, 10);
    const rangeEnd = localMidnight(2026, 5, 11) - 1;

    const events = getCalendarEvents([task], rangeStart, rangeEnd);

    expect(events).toHaveLength(3);
    expect(events.map((e) => e.start)).toEqual([
      localTs(2026, 5, 10, 9, 0),
      localTs(2026, 5, 10, 14, 0),
      localTs(2026, 5, 10, 18, 0),
    ]);
  });
});

// ---------------------------------------------------------------------------
// Interval tasks
// ---------------------------------------------------------------------------

describe("interval tasks", () => {
  it("expands minute-repeat within range", () => {
    const task = makeTask({
      nextRunAt: localTs(2026, 5, 10, 14, 0),
      repeatEvery: 10,
      repeatUnit: "minute",
      scheduleConfig: null,
    });
    // 30-min range → 4 events (0, 10, 20, 30)
    const rangeStart = localTs(2026, 5, 10, 14, 0);
    const rangeEnd = localTs(2026, 5, 10, 14, 30);

    const events = getCalendarEvents([task], rangeStart, rangeEnd);

    expect(events).toHaveLength(4);
    expect(events[0].start).toBe(localTs(2026, 5, 10, 14, 0));
    expect(events[1].start).toBe(localTs(2026, 5, 10, 14, 10));
    expect(events[2].start).toBe(localTs(2026, 5, 10, 14, 20));
    expect(events[3].start).toBe(localTs(2026, 5, 10, 14, 30));
  });

  it("expands hour-repeat within range", () => {
    const task = makeTask({
      nextRunAt: localTs(2026, 5, 10, 8, 0),
      repeatEvery: 2,
      repeatUnit: "hour",
      scheduleConfig: null,
    });
    const rangeStart = localMidnight(2026, 5, 10);
    const rangeEnd = localMidnight(2026, 5, 11) - 1;

    const events = getCalendarEvents([task], rangeStart, rangeEnd);

    // 8:00, 10:00, 12:00, ..., 22:00 = 8 events
    expect(events).toHaveLength(8);
    expect(events[0].start).toBe(localTs(2026, 5, 10, 8, 0));
    expect(events[7].start).toBe(localTs(2026, 5, 10, 22, 0));
  });

  it("expands day-repeat within range", () => {
    const task = makeTask({
      nextRunAt: localTs(2026, 5, 10, 14, 0),
      repeatEvery: 1,
      repeatUnit: "day",
      scheduleConfig: null,
    });
    const rangeStart = localMidnight(2026, 5, 10);
    const rangeEnd = localMidnight(2026, 5, 15) - 1;

    const events = getCalendarEvents([task], rangeStart, rangeEnd);

    // 5 days (Jun 10-14)
    expect(events).toHaveLength(5);
  });

  it("caps at MAX_OCCURRENCES_PER_TASK (500)", () => {
    const task = makeTask({
      nextRunAt: localTs(2026, 5, 10, 0, 0),
      repeatEvery: 1,
      repeatUnit: "minute",
      scheduleConfig: null,
    });
    // Range is huge (far more than 500 minutes)
    const rangeStart = localMidnight(2026, 5, 10);
    const rangeEnd = localMidnight(2026, 6, 10); // 30 days = 43,200 minutes

    const events = getCalendarEvents([task], rangeStart, rangeEnd);

    expect(events.length).toBeLessThanOrEqual(500);
  });

  it("uses runAt when nextRunAt is null", () => {
    const task = makeTask({
      runAt: localTs(2026, 5, 10, 14, 0),
      nextRunAt: null,
      repeatEvery: 1,
      repeatUnit: "hour",
      scheduleConfig: null,
    });
    const rangeStart = localTs(2026, 5, 10, 14, 0);
    const rangeEnd = localTs(2026, 5, 10, 16, 0);

    const events = getCalendarEvents([task], rangeStart, rangeEnd);

    // 14:00, 15:00, 16:00
    expect(events).toHaveLength(3);
  });

  it("skips occurrences before rangeStart", () => {
    const task = makeTask({
      nextRunAt: localTs(2026, 5, 10, 8, 0),
      repeatEvery: 1,
      repeatUnit: "hour",
      scheduleConfig: null,
    });
    // Range starts at 10:00 → 8:00 and 9:00 are skipped
    const rangeStart = localTs(2026, 5, 10, 10, 0);
    const rangeEnd = localTs(2026, 5, 10, 12, 0);

    const events = getCalendarEvents([task], rangeStart, rangeEnd);

    // 10:00, 11:00, 12:00
    expect(events).toHaveLength(3);
    expect(events[0].start).toBe(localTs(2026, 5, 10, 10, 0));
  });

  it("falls back to once-task when repeatEvery is invalid (0)", () => {
    // repeatEvery: 0 is falsy → isIntervalTask returns false → treated as once task
    const task = makeTask({
      runAt: localTs(2026, 5, 10, 14, 0),
      repeatEvery: 0,
      repeatUnit: "minute",
      scheduleConfig: null,
    });
    const rangeStart = localMidnight(2026, 5, 10);
    const rangeEnd = localMidnight(2026, 5, 11) - 1;

    const events = getCalendarEvents([task], rangeStart, rangeEnd);
    expect(events).toHaveLength(1);
    expect(events[0].isRepeating).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Month view (getMonthCellEvents)
// ---------------------------------------------------------------------------

describe("getMonthCellEvents", () => {
  it("groups events by day of month", () => {
    const tasks = [
      makeTask({
        id: "a",
        title: "Task A",
        scheduleConfig: { kind: "daily", times: ["09:00"] },
        nextRunAt: null,
        repeatEvery: null,
        repeatUnit: null,
      }),
      makeTask({
        id: "b",
        title: "Task B",
        runAt: localTs(2026, 5, 10, 14, 0),
        scheduleConfig: null,
      }),
    ];

    const cells = getMonthCellEvents(tasks, 2026, 5); // June 2026

    // June has 30 days; Task A appears every day, Task B only on the 10th
    expect(cells.size).toBe(30);

    // Day 10 should have 2 events (Task A + Task B)
    const day10 = cells.get(10);
    expect(day10).toBeDefined();
    expect(day10!.totalCount).toBe(2);
    expect(day10!.events).toHaveLength(2);

    // Day 11 should have 1 event (Task A only)
    const day11 = cells.get(11);
    expect(day11).toBeDefined();
    expect(day11!.totalCount).toBe(1);
  });

  it("marks disabled events in month cells", () => {
    const tasks = [
      makeTask({
        id: "a",
        title: "Disabled Task",
        runAt: localTs(2026, 5, 15, 10, 0),
        enabled: false,
        scheduleConfig: null,
      }),
    ];

    const cells = getMonthCellEvents(tasks, 2026, 5);
    const day15 = cells.get(15);

    expect(day15).toBeDefined();
    expect(day15!.events[0].enabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("edge cases", () => {
  it("handles empty task list", () => {
    const events = getCalendarEvents([], 0, Date.now());
    expect(events).toHaveLength(0);
  });

  it("handles empty times in schedule config", () => {
    const task = makeTask({
      scheduleConfig: { kind: "daily", times: [] },
      nextRunAt: null,
    });
    const events = getCalendarEvents(
      [task],
      localMidnight(2026, 5, 10),
      localMidnight(2026, 5, 11) - 1,
    );
    expect(events).toHaveLength(0);
  });

  it("handles invalid time format gracefully", () => {
    const task = makeTask({
      scheduleConfig: {
        kind: "daily",
        times: ["25:00", "not-a-time", "14:00"],
      },
      nextRunAt: null,
    });
    const rangeStart = localMidnight(2026, 5, 10);
    const rangeEnd = localMidnight(2026, 5, 11) - 1;

    const events = getCalendarEvents([task], rangeStart, rangeEnd);

    // Only "14:00" is valid
    expect(events).toHaveLength(1);
    expect(events[0].start).toBe(localTs(2026, 5, 10, 14, 0));
  });

  it('empty title falls back to "Untitled"', () => {
    const task = makeTask({
      title: "",
      runAt: localTs(2026, 5, 10, 14, 0),
    });
    const rangeStart = localMidnight(2026, 5, 10);
    const rangeEnd = localMidnight(2026, 5, 11) - 1;

    const events = getCalendarEvents([task], rangeStart, rangeEnd);

    expect(events).toHaveLength(1);
    expect(events[0].title).toBe("Untitled");
  });

  it("events are sorted by start time", () => {
    const tasks = [
      makeTask({
        id: "b",
        title: "B",
        runAt: localTs(2026, 5, 10, 16, 0),
      }),
      makeTask({
        id: "a",
        title: "A",
        runAt: localTs(2026, 5, 10, 9, 0),
      }),
    ];

    const rangeStart = localMidnight(2026, 5, 10);
    const rangeEnd = localMidnight(2026, 5, 11) - 1;

    const events = getCalendarEvents(tasks, rangeStart, rangeEnd);

    expect(events[0].start).toBe(localTs(2026, 5, 10, 9, 0));
    expect(events[1].start).toBe(localTs(2026, 5, 10, 16, 0));
  });

  it("weekly task deduplicates duplicate weekdays", () => {
    const task = makeTask({
      scheduleConfig: {
        kind: "weekly",
        weekdays: [3, 3, 5], // duplicate Wed
        times: ["10:00"],
      },
      nextRunAt: null,
    });
    const rangeStart = localMidnight(2026, 5, 10); // Wed
    const rangeEnd = localMidnight(2026, 5, 13) - 1; // Fri end

    const events = getCalendarEvents([task], rangeStart, rangeEnd);

    // Wed (Jun 10) + Fri (Jun 12) = 2 events only
    expect(events).toHaveLength(2);
  });
});
