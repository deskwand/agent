import { describe, expect, it, vi } from "vitest";
import {
  createWakeupTools,
  formatIntervalForModel,
  parseWakeupTime,
} from "../../main/agents/wakeup-tool";
import type { PersistentAgentManager } from "../../main/agents/persistent-agent-manager";

const NOW = new Date(2026, 10, 1, 8, 0).getTime();

function textOf(result: unknown): string {
  return (result as { content: { text: string }[] }).content[0].text;
}

describe("parseWakeupTime", () => {
  it("interprets offset-less ISO as local time", () => {
    expect(parseWakeupTime({ at: "2026-11-01T20:00" }, NOW)).toEqual({
      ok: true,
      runAt: new Date(2026, 10, 1, 20, 0).getTime(),
    });
    expect(parseWakeupTime({ at: "2026-11-01T20:00:00Z" }, NOW)).toEqual({
      ok: true,
      runAt: Date.UTC(2026, 10, 1, 20, 0),
    });
  });

  it("treats a date-only 'at' as local midnight", () => {
    expect(parseWakeupTime({ at: "2026-11-02" }, NOW)).toEqual({
      ok: true,
      runAt: new Date(2026, 10, 2, 0, 0).getTime(),
    });
  });

  it("converts in_minutes", () => {
    expect(parseWakeupTime({ in_minutes: 5 }, NOW)).toEqual({
      ok: true,
      runAt: NOW + 300_000,
    });
  });

  it("rejects missing, doubled, and unparsable input", () => {
    const exactlyOne = {
      ok: false,
      error: "Provide exactly one of 'at' or 'in_minutes'.",
    };
    expect(parseWakeupTime({}, NOW)).toEqual(exactlyOne);
    expect(
      parseWakeupTime({ at: "2026-11-01T20:00", in_minutes: 5 }, NOW),
    ).toEqual(exactlyOne);
    expect(parseWakeupTime({ at: "tonight" }, NOW)).toEqual({
      ok: false,
      error: "Could not parse 'at' as an ISO 8601 time.",
    });
  });
});

describe("wakeup tools", () => {
  it("returns manager errors as tool text", async () => {
    const manager = {
      scheduleWakeup: vi.fn(() => {
        throw new Error("Wakeup must be at least 1 minute in the future.");
      }),
      cancelWakeup: vi.fn(() => false),
    } as unknown as PersistentAgentManager;
    const [schedule, cancel] = createWakeupTools(manager, "a1", () => NOW);
    const signal = new AbortController().signal;
    const scheduled = await schedule.execute(
      "c1",
      { in_minutes: 0, reason: "x" },
      signal,
      undefined,
      undefined as never,
    );
    expect(textOf(scheduled)).toBe(
      "Wakeup must be at least 1 minute in the future.",
    );
    const cancelled = await cancel.execute(
      "c2",
      { wakeup_id: "nope" },
      signal,
      undefined,
      undefined as never,
    );
    expect(textOf(cancelled)).toBe("No pending wakeup with that id.");
  });
});

describe("set_next_check_in", () => {
  const signal = new AbortController().signal;
  const run = (manager: PersistentAgentManager, params: object) => {
    const tool = createWakeupTools(manager, "a1", () => NOW).find(
      (candidate) => candidate.name === "set_next_check_in",
    )!;
    return tool.execute("c1", params, signal, undefined, undefined as never);
  };

  it("reports a capped time", async () => {
    const runAt = NOW + 60 * 60_000;
    const manager = {
      setCheckIn: vi.fn(() => ({
        runAt,
        capped: true,
        schedule: { kind: "interval", every: 60, unit: "minute" },
      })),
    } as unknown as PersistentAgentManager;
    const text = textOf(await run(manager, { in_minutes: 120 }));
    expect(text).toBe(
      "Check-in set for 2026-11-01 09:00 (capped at your 60 minutes maximum).",
    );
  });

  it("passes the note and returns errors as text", async () => {
    const setCheckIn = vi.fn(() => ({
      runAt: NOW + 300_000,
      capped: false,
      schedule: { kind: "daily", times: ["23:00"] },
    }));
    const manager = {
      setCheckIn,
    } as unknown as PersistentAgentManager;
    expect(textOf(await run(manager, { in_minutes: 5, note: " 看 CI " }))).toBe(
      "Check-in set for 2026-11-01 08:05.",
    );
    expect(setCheckIn).toHaveBeenCalledWith("a1", NOW + 300_000, "看 CI");

    const failing = {
      setCheckIn: vi.fn(() => {
        throw new Error("Check-in must be at least 1 minute in the future.");
      }),
    } as unknown as PersistentAgentManager;
    expect(textOf(await run(failing, { in_minutes: 0 }))).toBe(
      "Check-in must be at least 1 minute in the future.",
    );
  });
});

describe("formatIntervalForModel", () => {
  it("pluralises and ignores non-interval rules", () => {
    expect(
      formatIntervalForModel({ kind: "interval", every: 1, unit: "hour" }),
    ).toBe("1 hour");
    expect(
      formatIntervalForModel({ kind: "interval", every: 30, unit: "minute" }),
    ).toBe("30 minutes");
    expect(
      formatIntervalForModel({ kind: "daily", times: ["09:00"] }),
    ).toBeNull();
  });
});
