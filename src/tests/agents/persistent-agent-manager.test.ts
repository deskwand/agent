import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, initDatabase } from "../../main/db/database";
import { setLocale } from "../../main/i18n";
import {
  createPersistentAgentStore,
  type PersistentAgentStore,
} from "../../main/agents/persistent-agent-store";
import {
  PersistentAgentManager,
  type AgentSessionPort,
  type PersistentAgentEvent,
} from "../../main/agents/persistent-agent-manager";
import type {
  AgentScheduleConfig,
  PersistentAgentCreateInput,
} from "../../shared/persistent-agent";

const MIN = 60_000;
const T = new Date(2026, 10, 1, 8, 0).getTime();

let dir: string;
let store: PersistentAgentStore;
let clock: number;
let running: Set<string>;
let existing: Set<string>;
let prompts: { sessionId: string; prompt: string }[];
let events: PersistentAgentEvent[];
let workspaceError: string | null;
let sessions: AgentSessionPort & {
  renameSession: Mock<(sessionId: string, title: string) => void>;
  releaseSession: Mock<(sessionId: string) => void>;
  deleteSession: Mock<(sessionId: string) => Promise<void>>;
};
let manager: PersistentAgentManager;
let sessionSeq: number;

function input(
  overrides: Partial<PersistentAgentCreateInput> = {},
): PersistentAgentCreateInput {
  return {
    name: "推特运营",
    instructions: "运营推特号",
    cwd: "/tmp/agent",
    schedule: { kind: "interval", every: 30, unit: "minute" },
    wakeImmediately: false,
    ...overrides,
  };
}

/** 推进虚拟时钟并跑到期的定时器。 */
async function advance(ms: number): Promise<void> {
  clock += ms;
  await vi.advanceTimersByTimeAsync(ms);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  setLocale("zh");
  dir = mkdtempSync(join(tmpdir(), "persistent-agent-manager-"));
  store = createPersistentAgentStore(initDatabase(join(dir, "cowork.db")));
  clock = T;
  running = new Set();
  existing = new Set();
  prompts = [];
  events = [];
  workspaceError = null;
  sessionSeq = 0;
  sessions = {
    createAgentSession: () => {
      sessionSeq += 1;
      const id = `s${sessionSeq}`;
      existing.add(id);
      return id;
    },
    continueSession: async (sessionId, prompt) => {
      prompts.push({ sessionId, prompt });
    },
    isSessionRunning: (id) => running.has(id),
    sessionExists: (id) => existing.has(id),
    renameSession: vi.fn<(sessionId: string, title: string) => void>(),
    releaseSession: vi.fn<(sessionId: string) => void>(),
    deleteSession: vi.fn(async (_sessionId: string) => undefined),
  };
  manager = new PersistentAgentManager({
    store,
    sessions,
    checkWorkspace: () => workspaceError,
    onEvent: (event) => events.push(event),
    now: () => clock,
  });
  manager.start();
});

afterEach(() => {
  manager.stop();
  vi.useRealTimers();
  setLocale(undefined);
  closeDatabase();
  rmSync(dir, { recursive: true, force: true });
});

describe("PersistentAgentManager", () => {
  it("create with wakeImmediately delivers one manual wakeup", async () => {
    const agent = await manager.create(input({ wakeImmediately: true }));
    expect(prompts).toHaveLength(1);
    expect(prompts[0].sessionId).toBe(agent.sessionId);
    expect(prompts[0].prompt).toContain("- 手动唤醒");
    expect(agent.nextPeriodicAt).toBe(T + 30 * MIN);
  });

  it("fires at the earlier of periodic and scheduled wakeup", async () => {
    const agent = await manager.create(input());
    manager.scheduleWakeup(agent.id, T + 10 * MIN, "看互动数据");
    await advance(10 * MIN);
    expect(prompts).toHaveLength(1);
    expect(prompts[0].prompt).toContain("- 预约：看互动数据");
    expect(prompts[0].prompt).not.toContain("周期唤醒");
  });

  it("merges triggers that fall due while the session is busy", async () => {
    const agent = await manager.create(input());
    running.add(agent.sessionId);
    manager.scheduleWakeup(agent.id, T + 10 * MIN, "看互动数据");
    await advance(30 * MIN);
    expect(prompts).toHaveLength(0);
    manager.onTurnFinished(agent.sessionId, "success");
    await vi.advanceTimersByTimeAsync(0);
    expect(prompts).toHaveLength(1);
    expect(prompts[0].prompt).toContain("- 预约：看互动数据");
    expect(prompts[0].prompt).not.toContain("兜底唤醒");
  });

  it("delivers once with missed count when the timer fires late", async () => {
    const agent = await manager.create(
      input({ schedule: { kind: "daily", times: ["08:30"] } }),
    );
    clock = new Date(2026, 10, 3, 9, 35).getTime(); // 机器睡眠：时钟跳过去了，定时器还没跑
    await vi.advanceTimersByTimeAsync(30 * MIN);
    expect(prompts).toHaveLength(1);
    expect(prompts[0].prompt).toContain("应用未运行期间错过 2 次唤醒");
    expect(manager.get(agent.id)!.nextPeriodicAt).toBe(
      new Date(2026, 10, 4, 8, 30).getTime(),
    );
  });

  it("interval wakes once without a missed count after sleep", async () => {
    const agent = await manager.create(input());
    clock = T + 95 * MIN;
    await vi.advanceTimersByTimeAsync(30 * MIN);
    expect(prompts).toHaveLength(1);
    expect(prompts[0].prompt).toContain("兜底唤醒");
    expect(prompts[0].prompt).not.toContain("错过");
    expect(manager.get(agent.id)!.nextPeriodicAt).toBe(T + 125 * MIN);
  });

  it("update recomputes next periodic time from now without firing", async () => {
    const agent = await manager.create(input());
    clock = T + 45 * MIN;
    const schedule: AgentScheduleConfig = {
      kind: "interval",
      every: 1,
      unit: "hour",
    };
    const updated = manager.update(agent.id, { schedule });
    await vi.advanceTimersByTimeAsync(0);
    expect(prompts).toHaveLength(0);
    expect(updated!.nextPeriodicAt).toBe(T + 105 * MIN);
  });

  it("clamps long delays and re-arms instead of firing", async () => {
    // 30 天后才到点，超过 setTimeout 上限（约 24.8 天）
    const agent = await manager.create(
      input({ schedule: { kind: "interval", every: 30, unit: "day" } }),
    );
    expect(agent.nextPeriodicAt).toBe(T + 30 * 24 * 60 * MIN);
    await advance(2_147_483_647);
    expect(prompts).toHaveLength(0);
    await advance(30 * 24 * 60 * MIN - 2_147_483_647);
    expect(prompts).toHaveLength(1);
  });

  it("auto pauses after five consecutive failed wakeup turns", async () => {
    const agent = await manager.create(input());
    for (let i = 0; i < 4; i += 1) {
      await manager.wakeNow(agent.id);
      manager.onTurnFinished(agent.sessionId, "failure", "boom");
    }
    await manager.wakeNow(agent.id);
    manager.onTurnFinished(agent.sessionId, "success");
    expect(manager.get(agent.id)!.consecutiveFailures).toBe(0);

    for (let i = 0; i < 5; i += 1) {
      await manager.wakeNow(agent.id);
      manager.onTurnFinished(agent.sessionId, "failure", "boom");
    }
    expect(manager.get(agent.id)!.enabled).toBe(false);
    expect(events.some((e) => e.type === "auto-paused")).toBe(true);
  });

  it("does not count failures of user-driven turns", async () => {
    const agent = await manager.create(input());
    manager.onTurnFinished(agent.sessionId, "failure", "boom");
    expect(manager.get(agent.id)!.consecutiveFailures).toBe(0);
  });

  it("ignores turn results for sessions with no agent", () => {
    expect(() => manager.onTurnFinished("unknown", "failure")).not.toThrow();
    expect(() => manager.onSessionLost("unknown")).not.toThrow();
  });

  it("clears a stale in-flight mark when the session is no longer running", async () => {
    const agent = await manager.create(input());
    await manager.wakeNow(agent.id); // 在途，但轮次结果永远没来
    await manager.wakeNow(agent.id);
    expect(prompts).toHaveLength(2);
  });

  it("pause drops pending and keeps scheduled wakeups", async () => {
    const agent = await manager.create(input());
    running.add(agent.sessionId);
    await manager.wakeNow(agent.id);
    manager.scheduleWakeup(agent.id, T + 10 * MIN, "稍后");
    manager.pause(agent.id);
    manager.onTurnFinished(agent.sessionId, "success");
    await vi.advanceTimersByTimeAsync(60 * MIN);
    expect(prompts).toHaveLength(0);
    expect(manager.listWakeups(agent.id)).toHaveLength(1);
    expect(manager.get(agent.id)!.status).toBe("paused");
  });

  it("resume rebinds a lost session", async () => {
    const agent = await manager.create(input());
    existing.delete(agent.sessionId);
    manager.onSessionLost(agent.sessionId);
    expect(manager.get(agent.id)!.lastError).toBe("session_lost");
    const resumed = manager.resume(agent.id)!;
    expect(resumed.sessionId).not.toBe(agent.sessionId);
    expect(resumed.enabled).toBe(true);
    expect(resumed.lastError).toBeNull();
  });

  it("skips delivery and records error when workspace is unavailable", async () => {
    const agent = await manager.create(input());
    workspaceError = "Workspace missing";
    await manager.wakeNow(agent.id);
    expect(prompts).toHaveLength(0);
    expect(manager.get(agent.id)!.status).toBe("error");
  });

  it("scheduleWakeup rejects too-soon times and the 51st wakeup", async () => {
    const agent = await manager.create(input());
    expect(() => manager.scheduleWakeup(agent.id, T + 30_000, "x")).toThrow(
      "Wakeup must be at least 1 minute in the future.",
    );
    for (let i = 0; i < 50; i += 1) {
      manager.scheduleWakeup(agent.id, T + (i + 2) * MIN, `w${i}`);
    }
    expect(() => manager.scheduleWakeup(agent.id, T + 99 * MIN, "x")).toThrow(
      "Too many pending wakeups (max 50). Cancel some first.",
    );
  });

  it("start delivers overdue agents once with missed count", async () => {
    await manager.create(
      input({ schedule: { kind: "daily", times: ["08:30"] } }),
    );
    manager.stop();
    clock = new Date(2026, 10, 2, 9, 0).getTime();
    const restarted = new PersistentAgentManager({
      store,
      sessions,
      checkWorkspace: () => null,
      onEvent: () => undefined,
      now: () => clock,
    });
    restarted.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(prompts).toHaveLength(1);
    expect(prompts[0].prompt).toContain("错过 1 次唤醒");
    restarted.stop();
  });

  it("start delivers an overdue interval agent once without a missed count", async () => {
    await manager.create(input());
    manager.stop();
    clock = T + 65 * MIN;
    const restarted = new PersistentAgentManager({
      store,
      sessions,
      checkWorkspace: () => null,
      onEvent: () => undefined,
      now: () => clock,
    });
    restarted.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(prompts).toHaveLength(1);
    expect(prompts[0].prompt).not.toContain("错过");
    restarted.stop();
  });

  it("generates an avatar seed unless one is given", async () => {
    const generated = await manager.create(input());
    expect(generated.avatarSeed).not.toBe("");
    expect(generated.avatarSeed).not.toBe(generated.name);
    const given = await manager.create(input({ avatarSeed: "s" }));
    expect(given.avatarSeed).toBe("s");
    expect(manager.update(given.id, { avatarSeed: "t" })!.avatarSeed).toBe("t");
  });

  it("renames the bound session when the agent is renamed", async () => {
    const agent = await manager.create(input());
    manager.update(agent.id, { name: "X 运营" });
    expect(sessions.renameSession).toHaveBeenCalledWith(
      agent.sessionId,
      "X 运营",
    );
  });

  it("emits every agent on start so a renderer that loaded early sees them", async () => {
    const agent = await manager.create(input());
    manager.stop();
    const seen: PersistentAgentEvent[] = [];
    const restarted = new PersistentAgentManager({
      store,
      sessions,
      checkWorkspace: () => null,
      onEvent: (event) => seen.push(event),
      now: () => clock,
    });
    restarted.start();
    expect(seen).toContainEqual(
      expect.objectContaining({
        type: "updated",
        agent: expect.objectContaining({ id: agent.id }),
      }),
    );
    restarted.stop();
  });

  it("delete releases the session by default and deletes it when asked", async () => {
    const a = await manager.create(input());
    const b = await manager.create(input({ name: "b" }));
    await manager.delete(a.id, { deleteSession: false });
    await manager.delete(b.id, { deleteSession: true });
    expect(sessions.releaseSession).toHaveBeenCalledWith(a.sessionId);
    expect(sessions.deleteSession).toHaveBeenCalledWith(b.sessionId);
    expect(manager.list()).toHaveLength(0);
  });
});

describe("PersistentAgentManager adaptive wakeup", () => {
  it("turn end resets the watchdog deadline", async () => {
    const agent = await manager.create(input());
    clock = T + 20 * MIN;
    manager.onTurnFinished(agent.sessionId, "success");
    expect(manager.get(agent.id)!.nextPeriodicAt).toBe(T + 50 * MIN);
    await advance(29 * MIN);
    expect(prompts).toHaveLength(0);
    await advance(1 * MIN);
    expect(prompts).toHaveLength(1);
    expect(prompts[0].prompt).toContain("兜底唤醒");
  });

  it("a user chat turn also resets the watchdog", async () => {
    const agent = await manager.create(input());
    clock = T + 10 * MIN;
    manager.onTurnFinished(agent.sessionId, "success");
    expect(manager.get(agent.id)!.nextPeriodicAt).toBe(T + 40 * MIN);
  });

  it("fires a check-in before the watchdog and clears it", async () => {
    const agent = await manager.create(input());
    manager.setCheckIn(agent.id, T + 5 * MIN, "看 CI");
    await advance(5 * MIN);
    expect(prompts).toHaveLength(1);
    expect(prompts[0].prompt).toContain("- 签到：看 CI");
    expect(manager.get(agent.id)!.nextCheckInAt).toBeNull();
  });

  it("caps a check-in at the watchdog", async () => {
    const agent = await manager.create(input());
    expect(manager.setCheckIn(agent.id, T + 90 * MIN, null)).toMatchObject({
      runAt: T + 30 * MIN,
      capped: true,
    });
  });

  it("does not cap check-ins for daily rules", async () => {
    const agent = await manager.create(
      input({ schedule: { kind: "daily", times: ["23:00"] } }),
    );
    expect(manager.setCheckIn(agent.id, T + 600 * MIN, null).capped).toBe(
      false,
    );
  });

  it("rejects a check-in under one minute", async () => {
    const agent = await manager.create(input());
    expect(() => manager.setCheckIn(agent.id, T + 30_000, null)).toThrow(
      "Check-in must be at least 1 minute in the future.",
    );
  });

  it("check-in due with watchdog suppresses the watchdog line", async () => {
    const agent = await manager.create(input());
    manager.setCheckIn(agent.id, T + 30 * MIN, "x");
    await advance(30 * MIN);
    expect(prompts).toHaveLength(1);
    expect(prompts[0].prompt).toContain("- 签到：x");
    expect(prompts[0].prompt).not.toContain("兜底唤醒");
  });

  it("drops a queued watchdog trigger when a chat turn ends", async () => {
    const agent = await manager.create(input());
    running.add(agent.sessionId);
    await advance(30 * MIN);
    expect(prompts).toHaveLength(0);
    running.delete(agent.sessionId);
    manager.onTurnFinished(agent.sessionId, "success");
    await vi.advanceTimersByTimeAsync(0);
    expect(prompts).toHaveLength(0);
  });

  it("update clamps an existing check-in to the new deadline", async () => {
    const agent = await manager.create(
      input({ schedule: { kind: "interval", every: 1, unit: "hour" } }),
    );
    manager.setCheckIn(agent.id, T + 50 * MIN, null);
    manager.update(agent.id, {
      schedule: { kind: "interval", every: 10, unit: "minute" },
    });
    expect(manager.get(agent.id)!.nextCheckInAt).toBe(T + 10 * MIN);
  });

  it("keeps a deadline armed when watchdog delivery throws", async () => {
    const agent = await manager.create(input());
    const send = vi.fn(async (_sessionId: string, _prompt: string) => {
      throw new Error("boom");
    });
    sessions.continueSession = send;
    await advance(30 * MIN);
    expect(send).toHaveBeenCalledTimes(1);
    expect(manager.get(agent.id)!.nextPeriodicAt).toBe(T + 60 * MIN);
    await advance(30 * MIN);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("view reports the next wakeup kind", async () => {
    const agent = await manager.create(input());
    expect(manager.get(agent.id)!.nextWakeup).toMatchObject({
      kind: "watchdog",
      reason: null,
    });
    manager.setCheckIn(agent.id, T + 20 * MIN, "看 CI");
    expect(manager.get(agent.id)!.nextWakeup).toMatchObject({
      kind: "check_in",
      reason: "看 CI",
    });
    manager.scheduleWakeup(agent.id, T + 10 * MIN, "发帖");
    expect(manager.get(agent.id)!.nextWakeup).toMatchObject({
      kind: "appointment",
      reason: "发帖",
    });
  });

  it("resume clears a stale check-in", async () => {
    const agent = await manager.create(input());
    manager.setCheckIn(agent.id, T + 5 * MIN, "x");
    manager.pause(agent.id);
    manager.resume(agent.id);
    expect(manager.get(agent.id)!.nextCheckInAt).toBeNull();
  });
});
