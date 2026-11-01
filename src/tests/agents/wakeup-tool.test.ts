import { describe, expect, it, vi } from "vitest";
import {
  createWakeupTools,
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
