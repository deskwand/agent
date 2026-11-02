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
    trustedRecipients: [],
    riskyCapabilities: { shell: false, browser: false, computer: false },
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
});

describe("formatAgentStatus hides the system heartbeat", () => {
  const t = i18n.t.bind(i18n);
  const at = new Date(2026, 10, 1, 20, 0).getTime();

  it("shows a plain sleeping status when only the system is scheduled", () => {
    // view() 默认的 nextWakeup 就是 periodic（老 daily / weekly 伙伴）
    expect(formatAgentStatus(view(), false, t, NOW)).toBe("休眠中");
    expect(formatAgentStatus(view({ nextWakeup: null }), false, t, NOW)).toBe(
      "休眠中",
    );
    const watchdog = view({
      nextWakeup: { at, kind: "watchdog", reason: null },
    });
    expect(formatAgentStatus(watchdog, false, t, NOW)).toBe("休眠中");
  });

  it("still shows what the teammate scheduled for itself", () => {
    const checkIn = view({
      nextWakeup: { at, kind: "check_in", reason: "看 CI" },
    });
    expect(formatAgentStatus(checkIn, false, t, NOW)).toBe(
      "休眠中 · 下次 20:00 看 CI",
    );
    const appointment = view({
      nextWakeup: {
        at: new Date(2026, 10, 2, 9, 0).getTime(),
        kind: "appointment",
        reason: "早间检查",
      },
    });
    expect(formatAgentStatus(appointment, false, t, NOW)).toBe(
      "休眠中 · 下次 11-02 09:00 早间检查",
    );
    expect(formatAgentStatus(appointment, false, t, NOW, false)).toBe(
      "休眠中 · 下次 11-02 09:00",
    );
  });
});
