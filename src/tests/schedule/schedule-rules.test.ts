import { describe, expect, it } from "vitest";
import {
  computeNextRunAt,
  countSlotsBetween,
  type ScheduleRule,
} from "../../main/schedule/schedule-rules";

const MIN = 60_000;
const T = new Date(2026, 10, 1, 8, 0, 0, 0).getTime();

function rule(overrides: Partial<ScheduleRule> = {}): ScheduleRule {
  return {
    runAt: T,
    nextRunAt: T,
    scheduleConfig: null,
    repeatEvery: null,
    repeatUnit: null,
    ...overrides,
  };
}

describe("computeNextRunAt", () => {
  it("skips past intervals to the next future slot", () => {
    const r = rule({ repeatEvery: 30, repeatUnit: "minute" });
    expect(computeNextRunAt(r, T + 95 * MIN)).toBe(T + 120 * MIN);
  });

  it("picks the next daily time later today", () => {
    const r = rule({
      scheduleConfig: { kind: "daily", times: ["09:00", "20:00"] },
    });
    const now = new Date(2026, 10, 1, 10, 0).getTime();
    expect(computeNextRunAt(r, now)).toBe(
      new Date(2026, 10, 1, 20, 0).getTime(),
    );
  });

  it("returns null for an empty rule", () => {
    expect(computeNextRunAt(rule(), T)).toBeNull();
  });
});

describe("countSlotsBetween", () => {
  it("counts interval slots in the half-open range", () => {
    const r = rule({ repeatEvery: 30, repeatUnit: "minute" });
    expect(countSlotsBetween(r, T, T + 95 * MIN)).toBe(3);
  });

  it("counts daily slots across days", () => {
    const r = rule({ scheduleConfig: { kind: "daily", times: ["09:00"] } });
    const from = new Date(2026, 10, 1, 10, 0).getTime();
    const to = new Date(2026, 10, 4, 10, 0).getTime();
    expect(countSlotsBetween(r, from, to)).toBe(3);
  });

  it("stops at the cap", () => {
    const r = rule({ repeatEvery: 30, repeatUnit: "minute" });
    expect(countSlotsBetween(r, T, T + 95 * MIN, 2)).toBe(2);
  });

  it("returns 0 for an empty rule", () => {
    expect(countSlotsBetween(rule(), T, T + 95 * MIN)).toBe(0);
  });
});
