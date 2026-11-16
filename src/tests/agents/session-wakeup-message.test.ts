import { beforeEach, describe, expect, it } from "vitest";
import { setLocale } from "../../main/i18n";
import { buildSessionWakeupMessage } from "../../main/agents/session-wakeup-message";

const NOW = new Date(2026, 10, 1, 8, 0).getTime();

beforeEach(() => {
  setLocale("zh");
});

describe("buildSessionWakeupMessage", () => {
  it("wraps the reasons in the agent wakeup tag", () => {
    const text = buildSessionWakeupMessage({
      now: NOW,
      reasons: ["看构建结果"],
      upcoming: [],
      missedCount: 0,
    });
    expect(text.startsWith("<agent_wakeup>")).toBe(true);
    expect(text.trimEnd().endsWith("</agent_wakeup>")).toBe(true);
    expect(text).toContain("- 预约：看构建结果");
    expect(text).not.toContain("待执行预约");
  });

  it("dedupes identical reasons", () => {
    const text = buildSessionWakeupMessage({
      now: NOW,
      reasons: ["看一眼", "看一眼"],
      upcoming: [],
      missedCount: 0,
    });
    expect(text.match(/- 预约：看一眼/g)).toHaveLength(1);
  });

  it("lists upcoming wakeups and the missed count", () => {
    const text = buildSessionWakeupMessage({
      now: NOW,
      reasons: ["看构建结果"],
      upcoming: [
        {
          id: "w1",
          sessionId: "s1",
          runAt: new Date(2026, 10, 1, 9, 0).getTime(),
          reason: "发版本",
          createdAt: 1,
        },
      ],
      missedCount: 2,
    });
    expect(text).toContain("待执行预约：11-01 09:00 发版本");
    expect(text).toContain("错过 2 次唤醒");
  });
});
