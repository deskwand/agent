import { beforeAll, describe, expect, it } from "vitest";
import i18n from "../../renderer/i18n/config";
import { formatAgentStatus } from "../../renderer/utils/persistent-agent-status";
import type { PersistentAgentView } from "../../shared/persistent-agent";

const NOW = new Date(2026, 10, 1, 10, 0).getTime();

function view(
  overrides: Partial<PersistentAgentView> = {},
): PersistentAgentView {
  return {
    id: "a1",
    name: "推特运营",
    instructions: "",
    cwd: "/tmp",
    sessionId: "s1",
    avatarSeed: "seed",
    schedule: { kind: "interval", every: 30, unit: "minute" },
    enabled: true,
    nextPeriodicAt: null,
    nextCheckInAt: null,
    checkInNote: null,
    consecutiveFailures: 0,
    lastWakeupAt: null,
    lastError: null,
    createdAt: 0,
    updatedAt: 0,
    status: "sleeping",
    nextWakeup: {
      at: new Date(2026, 10, 1, 20, 0).getTime(),
      kind: "periodic",
      reason: null,
    },
    pendingWakeupCount: 0,
    ...overrides,
  };
}

beforeAll(async () => {
  await i18n.changeLanguage("zh");
});

describe("formatAgentStatus", () => {
  const t = i18n.t.bind(i18n);

  it("prefers running when the session is running", () => {
    expect(formatAgentStatus(view(), true, t, NOW)).toBe("运行中");
  });

  it("renders paused, session lost, and error", () => {
    expect(formatAgentStatus(view({ status: "paused" }), false, t, NOW)).toBe(
      "已暂停",
    );
    expect(
      formatAgentStatus(
        view({ status: "paused", lastError: "session_lost" }),
        false,
        t,
        NOW,
      ),
    ).toBe("会话丢失");
    expect(
      formatAgentStatus(
        view({ status: "error", lastError: "x" }),
        false,
        t,
        NOW,
      ),
    ).toBe("上次出错");
  });

  it("renders the next wakeup with and without a reason", () => {
    expect(formatAgentStatus(view(), false, t, NOW)).toBe(
      "休眠中 · 下次 20:00",
    );
    const scheduled = view({
      nextWakeup: {
        at: new Date(2026, 10, 2, 9, 0).getTime(),
        kind: "appointment",
        reason: "早间检查",
      },
    });
    expect(formatAgentStatus(scheduled, false, t, NOW)).toBe(
      "休眠中 · 下次 11-02 09:00 早间检查",
    );
    expect(formatAgentStatus(scheduled, false, t, NOW, false)).toBe(
      "休眠中 · 下次 11-02 09:00",
    );
  });
});

describe("formatAgentStatus by wake kind", () => {
  const t = i18n.t.bind(i18n);
  const at = new Date(2026, 10, 1, 20, 0).getTime();

  it("shows the watchdog deadline as the latest wake time", () => {
    const watchdog = view({
      nextWakeup: { at, kind: "watchdog", reason: null },
    });
    expect(formatAgentStatus(watchdog, false, t, NOW)).toBe(
      "休眠中 · 最晚 20:00",
    );
  });

  it("shows a check-in note and a plain periodic wakeup", () => {
    const checkIn = view({
      nextWakeup: { at, kind: "check_in", reason: "看 CI" },
    });
    expect(formatAgentStatus(checkIn, false, t, NOW)).toBe(
      "休眠中 · 下次 20:00 看 CI",
    );
    const periodic = view({
      nextWakeup: { at, kind: "periodic", reason: null },
    });
    expect(formatAgentStatus(periodic, false, t, NOW)).toBe(
      "休眠中 · 下次 20:00",
    );
  });
});
