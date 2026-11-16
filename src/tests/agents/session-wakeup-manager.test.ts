import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, initDatabase } from "../../main/db/database";
import { setLocale } from "../../main/i18n";
import {
  createSessionWakeupStore,
  type SessionWakeupStore,
} from "../../main/agents/session-wakeup-store";
import {
  SessionWakeupManager,
  type SessionWakeupEvent,
} from "../../main/agents/session-wakeup-manager";
import { MAX_SELF_WAKE_CHAIN } from "../../shared/session-wakeup";

const MIN = 60_000;
const T = new Date(2026, 10, 1, 8, 0).getTime();

let dir: string;
let store: SessionWakeupStore;
let clock: number;
let running: Set<string>;
let existing: Set<string>;
let ordinary: Set<string>;
let prompts: { sessionId: string; prompt: string }[];
let deliveryFails: boolean;
let events: SessionWakeupEvent[];
let manager: SessionWakeupManager;

/** 推进虚拟时钟并跑到期的定时器。 */
async function advance(ms: number): Promise<void> {
  clock += ms;
  await vi.advanceTimersByTimeAsync(ms);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  setLocale("zh");
  dir = mkdtempSync(join(tmpdir(), "session-wakeup-manager-"));
  store = createSessionWakeupStore(initDatabase(join(dir, "cowork.db")));
  clock = T;
  running = new Set();
  existing = new Set(["s1"]);
  ordinary = new Set(["s1"]);
  prompts = [];
  deliveryFails = false;
  events = [];
  manager = new SessionWakeupManager({
    store,
    sessions: {
      continueSession: async (sessionId, prompt) => {
        if (deliveryFails) throw new Error("rewind in progress");
        prompts.push({ sessionId, prompt });
      },
      isSessionRunning: (id) => running.has(id),
      sessionExists: (id) => existing.has(id),
      isOrdinarySession: (id) => ordinary.has(id),
    },
    onEvent: (event) => events.push(event),
    now: () => clock,
  });
  manager.start();
});

afterEach(() => {
  manager.stop();
  vi.useRealTimers();
  closeDatabase();
  rmSync(dir, { recursive: true, force: true });
});

describe("SessionWakeupManager", () => {
  it("delivers at the scheduled time", async () => {
    manager.schedule("s1", T + 10 * MIN, "看构建结果");
    await advance(10 * MIN);
    expect(prompts).toHaveLength(1);
    expect(prompts[0].sessionId).toBe("s1");
    expect(prompts[0].prompt).toContain("- 预约：看构建结果");
  });

  it("queues while the session is running and merges reasons", async () => {
    running.add("s1");
    manager.schedule("s1", T + 10 * MIN, "看构建结果");
    await advance(10 * MIN);
    expect(prompts).toHaveLength(0);

    // 预约行已从库里取走：渲染层必须被告知「下一次」变了，否则提示条停在旧值
    expect(events.at(-1)).toEqual({
      type: "updated",
      sessionId: "s1",
      next: null,
    });

    running.delete("s1");
    manager.onTurnFinished("s1");
    await vi.advanceTimersByTimeAsync(0);
    expect(prompts).toHaveLength(1);
    expect(prompts[0].prompt).toContain("- 预约：看构建结果");
    expect(manager.getNext("s1")).toBeNull();
  });

  it("reports missed wakeups when the app was not running", async () => {
    manager.schedule("s1", T + 10 * MIN, "看构建结果");
    clock = T + 60 * MIN;
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(prompts).toHaveLength(1);
    expect(prompts[0].prompt).toContain("错过 1 次唤醒");
  });

  it("drops the wakeup when the session is gone", async () => {
    manager.schedule("s1", T + 10 * MIN, "看构建结果");
    existing.delete("s1");
    await advance(10 * MIN);
    expect(prompts).toHaveLength(0);
    expect(store.count("s1")).toBe(0);
  });

  it("drops the wakeup when the session is no longer ordinary", async () => {
    manager.schedule("s1", T + 10 * MIN, "看构建结果");
    ordinary.delete("s1");
    await advance(10 * MIN);
    expect(prompts).toHaveLength(0);
    expect(store.count("s1")).toBe(0);
  });

  it("rejects wakeups that break the delay, lookahead and pending limits", () => {
    expect(() => manager.schedule("s1", T + 30_000, "太近")).toThrow(
      "at least 1 minute",
    );
    expect(() => manager.schedule("s1", T + 8 * 24 * 60 * MIN, "太远")).toThrow(
      "within 7 days",
    );
    for (const [index, reason] of ["a", "b", "c"].entries()) {
      manager.schedule("s1", T + (index + 1) * 5 * MIN, reason);
    }
    expect(() => manager.schedule("s1", T + 60 * MIN, "d")).toThrow(
      "Too many pending wakeups",
    );
  });

  it("counts the chain on a delivered wakeup turn and resets on a user turn", async () => {
    manager.schedule("s1", T + 10 * MIN, "第一次");
    await advance(10 * MIN);
    manager.beginRun("s1", prompts[0].prompt); // 这一轮是唤醒触发的
    manager.schedule("s1", T + 20 * MIN, "第二次");
    expect(store.getChain("s1")).toBe(1);

    manager.beginRun("s1", "用户自己发消息");
    expect(store.getChain("s1")).toBe(0);
  });

  it("stops the model after the chain limit", async () => {
    manager.schedule("s1", T + 10 * MIN, "第一次");
    await advance(10 * MIN);
    manager.beginRun("s1", prompts[0].prompt); // 先建立唤醒轮，否则下一步会被当成用户轮并清零
    store.setChain("s1", MAX_SELF_WAKE_CHAIN);
    expect(() => manager.schedule("s1", T + 20 * MIN, "超限")).toThrow(
      "limit of consecutive self-wakeups",
    );
  });

  it("attributes a queued user turn and the later wakeup turn separately", async () => {
    manager.schedule("s1", T + 10 * MIN, "第一次");
    await advance(10 * MIN);
    const delivered = prompts[0].prompt;

    // 用户消息排在唤醒消息之前：先跑的是用户轮，链要清零
    manager.beginRun("s1", "用户自己的消息");
    expect(store.getChain("s1")).toBe(0);

    // 随后跑唤醒轮，在这一轮里排的新唤醒才延长链
    manager.beginRun("s1", delivered);
    manager.schedule("s1", T + 20 * MIN, "第二次");
    expect(store.getChain("s1")).toBe(1);
  });

  it("merges every overdue wakeup into one message after a restart", async () => {
    manager.schedule("s1", T + 10 * MIN, "看构建结果");
    manager.schedule("s1", T + 20 * MIN, "发版本");
    manager.schedule("s1", T + 30 * MIN, "看反馈");
    manager.stop();

    clock = T + 120 * MIN;
    manager.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(prompts).toHaveLength(1);
    expect(prompts[0].prompt).toContain("- 预约：看构建结果");
    expect(prompts[0].prompt).toContain("- 预约：发版本");
    expect(prompts[0].prompt).toContain("- 预约：看反馈");
    expect(prompts[0].prompt).toContain("错过 3 次唤醒");
  });

  it("prunes wakeups whose session no longer exists on start", async () => {
    store.insert({
      id: "w-orphan",
      sessionId: "gone",
      runAt: T + 10 * MIN,
      reason: "孤儿",
      createdAt: T,
    });
    existing.delete("gone");
    manager.stop();
    manager.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(store.count("gone")).toBe(0);
    expect(prompts).toHaveLength(0);
  });

  it("ignores turn ends for sessions it does not track", async () => {
    // agent / voice 会话的失败轮也会走到这里；不能借机放行排队投递
    manager.onTurnFinished("agent-session");
    expect(manager.getNext("agent-session")).toBeNull();
  });

  it("reschedules instead of losing the wakeup when delivery fails", async () => {
    deliveryFails = true;
    manager.schedule("s1", T + 10 * MIN, "看构建结果");
    await advance(10 * MIN);

    expect(prompts).toHaveLength(0);
    // 一分钟后再排一次（10 分钟到期 + 1 分钟重试），而不是悄悄没了
    expect(store.count("s1")).toBe(1);
    expect(manager.getNext("s1")).toMatchObject({
      at: T + 11 * MIN,
      reason: "看构建结果",
    });
  });

  it("re-arms instead of firing early when the clock jumps backwards", async () => {
    manager.schedule("s1", T + 10 * MIN, "看构建结果");
    // 系统时钟回拨 15 分钟，而定时器照样到点触发
    clock = T - 5 * MIN;
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(prompts).toHaveLength(0);
    // 重挂后的延迟按 now 计算：T+10 - (T-5) = 15 分钟
    await advance(15 * MIN);
    expect(prompts).toHaveLength(1);
  });

  it("cleans up when the session is deleted", () => {
    manager.schedule("s1", T + 10 * MIN, "看构建结果");
    manager.onSessionDeleted("s1");
    expect(store.count("s1")).toBe(0);
    expect(events.at(-1)).toEqual({ type: "removed", sessionId: "s1" });
  });
});
