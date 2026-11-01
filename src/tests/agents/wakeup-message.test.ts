import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildWakeupMessage } from "../../main/agents/wakeup-message";
import { setLocale } from "../../main/i18n";
import type { PersistentAgentWakeup } from "../../shared/persistent-agent";

const NOW = new Date(2026, 10, 1, 20, 0).getTime(); // 周日
const schedule = { kind: "interval", every: 30, unit: "minute" } as const;

function upcoming(i: number): PersistentAgentWakeup {
  return {
    id: `w${i}`,
    agentId: "a1",
    runAt: new Date(2026, 10, 2, 9, i).getTime(),
    reason: `检查 ${i}`,
    createdAt: 0,
  };
}

beforeEach(() => setLocale("zh"));
afterEach(() => setLocale(undefined));

describe("buildWakeupMessage", () => {
  it("renders the full zh message", () => {
    const text = buildWakeupMessage({
      now: NOW,
      schedule,
      triggers: [
        { type: "periodic" },
        { type: "scheduled", reason: "发布今晚的话题帖" },
      ],
      upcoming: [
        {
          id: "w",
          agentId: "a1",
          runAt: new Date(2026, 10, 2, 9, 0).getTime(),
          reason: "早间互动检查",
          createdAt: 0,
        },
      ],
      missedCount: 0,
    });
    expect(text).toBe(
      [
        "<agent_wakeup>",
        "[自动唤醒] 2026-11-01 20:00（周日）",
        "触发原因：",
        "- 周期唤醒（每 30 分钟）",
        "- 预约：发布今晚的话题帖",
        "待执行预约：11-02 09:00 早间互动检查",
        "</agent_wakeup>",
      ].join("\n"),
    );
  });

  it("lists repeated periodic triggers once and omits empty upcoming", () => {
    const text = buildWakeupMessage({
      now: NOW,
      schedule,
      triggers: [{ type: "periodic" }, { type: "periodic" }],
      upcoming: [],
      missedCount: 0,
    });
    expect(text.match(/周期唤醒/g)).toHaveLength(1);
    expect(text).not.toContain("待执行预约");
  });

  it("mentions missed wakeups", () => {
    const text = buildWakeupMessage({
      now: NOW,
      schedule,
      triggers: [{ type: "periodic" }],
      upcoming: [],
      missedCount: 3,
    });
    expect(text).toContain("应用未运行期间错过 3 次唤醒");
  });

  it("lists at most five upcoming wakeups", () => {
    const text = buildWakeupMessage({
      now: NOW,
      schedule,
      triggers: [{ type: "manual" }],
      upcoming: [1, 2, 3, 4, 5, 6, 7].map(upcoming),
      missedCount: 0,
    });
    expect(text).toContain("检查 5");
    expect(text).not.toContain("检查 6");
  });

  it("describes weekly rules and renders en", () => {
    setLocale("en");
    const text = buildWakeupMessage({
      now: NOW,
      schedule: { kind: "weekly", weekdays: [1, 3], times: ["09:00"] },
      triggers: [{ type: "periodic" }],
      upcoming: [],
      missedCount: 0,
    });
    expect(text.split("\n")[1]).toBe("[Auto wakeup] 2026-11-01 20:00 (Sun)");
    expect(text).toContain("weekly on Mon, Wed at 09:00");
  });
});
