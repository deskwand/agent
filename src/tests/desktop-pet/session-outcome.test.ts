import * as fs from "fs";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseInstance } from "../../main/db/database";
import type { Session } from "../../renderer/types";
import { SessionManager } from "../../main/session/session-manager";
import {
  TurnOutcomeTracker,
  type AgentTurnOutcome,
} from "../../main/agent/agent-runner";
import type { PetState } from "../../main/desktop-pet/pet-state";

// ---------------------------------------------------------------------------
// 1) SDK 终局事件流 → 本轮结果
// ---------------------------------------------------------------------------

describe("TurnOutcomeTracker (SDK event stream)", () => {
  it("does not report failure while the SDK will retry the turn", () => {
    const tracker = new TurnOutcomeTracker();
    tracker.setTerminalError("socket hang up");
    tracker.observeEvent({ type: "agent_end", willRetry: true });

    expect(tracker.resolve(false)).not.toBe("failure");
    expect(tracker.resolve(false)).toBe("unknown");
  });

  it("reports success once the retried turn finishes without a terminal error", () => {
    const tracker = new TurnOutcomeTracker();
    tracker.setTerminalError("socket hang up");
    tracker.observeEvent({ type: "agent_end", willRetry: true });

    // 重试成功后 message_end 带回正常回复：之前的错误不再是终局错误。
    tracker.setTerminalError(undefined);
    tracker.observeEvent({ type: "agent_end", willRetry: false });

    expect(tracker.resolve(false)).toBe("success");
  });

  it("reports failure for a terminal error the SDK stops retrying", () => {
    const tracker = new TurnOutcomeTracker();
    tracker.setTerminalError("insufficient balance");
    tracker.observeEvent({ type: "agent_end", willRetry: false });

    expect(tracker.resolve(false)).toBe("failure");
  });

  it("reports cancelled when the user stopped the run", () => {
    const tracker = new TurnOutcomeTracker();
    tracker.setTerminalError("insufficient balance");
    tracker.observeEvent({ type: "agent_end", willRetry: false });

    expect(tracker.resolve(true)).toBe("cancelled");
  });

  it("reports failure when run() threw", () => {
    const tracker = new TurnOutcomeTracker();
    tracker.markThrown(new Error("boom"));

    expect(tracker.resolve(false)).toBe("failure");
  });

  it("reports unknown when the terminal end event never arrived", () => {
    const tracker = new TurnOutcomeTracker();

    expect(tracker.resolve(false)).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// 2) SessionManager 每轮接线（活体 SessionManager + 假 runner）
// ---------------------------------------------------------------------------

const SESSION_ROW = {
  id: "s-1",
  title: "Existing title",
  status: "idle",
  cwd: "",
  deskwand_session_id: null,
  openai_thread_id: null,
  mounted_paths: "[]",
  allowed_tools: "[]",
  memory_enabled: 0,
  is_project_mode: 0,
  provider_profile_key: null,
  model: null,
  thinking_level: "medium",
  archived: 0,
  archived_at: null,
  pi_session_file: null,
  created_at: 1,
  updated_at: 1,
};

function makeDb(): DatabaseInstance {
  return {
    sessions: {
      get: (id: string) =>
        id === SESSION_ROW.id ? { ...SESSION_ROW } : undefined,
      update: () => {},
    },
    traceSteps: { create: () => {}, update: () => {} },
  } as unknown as DatabaseInstance;
}

type FakeRunner = {
  run: (
    session: Session,
    prompt: string,
    ...rest: unknown[]
  ) => Promise<AgentTurnOutcome>;
  calls: number;
};

function makeHarness() {
  const sm = new SessionManager(makeDb(), () => {});
  const tracker = sm.getPetStateTracker();
  const states: PetState[] = [];
  tracker.subscribe((state) => states.push(state));

  const resolvers: Array<(outcome: AgentTurnOutcome) => void> = [];
  const runner: FakeRunner = {
    calls: 0,
    run: () => {
      runner.calls += 1;
      return new Promise<AgentTurnOutcome>((resolve) => {
        resolvers.push(resolve);
      });
    },
  };
  (sm as unknown as { agentRunner: FakeRunner }).agentRunner = runner;

  return { sm, tracker, states, resolvers };
}

/** 让 processQueue 的微任务链推进到下一个等待点。 */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await vi.advanceTimersByTimeAsync(0);
  }
}

describe("SessionManager per-turn pet wiring", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports running during the turn and a success notice when run() returns success", async () => {
    const { sm, tracker, states, resolvers } = makeHarness();

    sm.enqueuePromptForSession(SESSION_ROW.id, "hello");
    await flush();

    expect(resolvers).toHaveLength(1);
    expect(tracker.snapshot()).toBe("running");

    resolvers[0]("success");
    await flush();

    expect(tracker.snapshot()).toBe("success");

    await vi.advanceTimersByTimeAsync(2_000);
    expect(tracker.snapshot()).toBe("idle");
    expect(states.at(-1)).toBe("idle");
  });

  it("never flashes success when run() cannot tell what happened", async () => {
    const { sm, tracker, states, resolvers } = makeHarness();

    sm.enqueuePromptForSession(SESSION_ROW.id, "hello");
    await flush();

    expect(tracker.snapshot()).toBe("running");

    resolvers[0]("unknown");
    await flush();

    // session.status 已经回到 idle，但这既不是成功也不是失败。
    expect(tracker.snapshot()).toBe("idle");
    expect(states).not.toContain("success");
    expect(states).not.toContain("failure");
  });

  it("never flashes success when the user cancelled the turn", async () => {
    const { sm, tracker, states, resolvers } = makeHarness();

    sm.enqueuePromptForSession(SESSION_ROW.id, "hello");
    await flush();

    resolvers[0]("cancelled");
    await flush();

    expect(tracker.snapshot()).toBe("idle");
    expect(states).not.toContain("success");
  });

  it("stays running while a second queued turn is still pending", async () => {
    const { sm, tracker, states, resolvers } = makeHarness();

    sm.enqueuePromptForSession(SESSION_ROW.id, "first");
    sm.enqueuePromptForSession(SESSION_ROW.id, "second");
    await flush();

    expect(resolvers).toHaveLength(1);

    // 第一轮被取消：没有结果提示，但队列里还有第二轮，不能掉回 idle。
    resolvers[0]("cancelled");
    await flush();

    expect(resolvers).toHaveLength(2);
    expect(states).not.toContain("idle");

    resolvers[1]("success");
    await flush();

    expect(tracker.snapshot()).toBe("success");

    await vi.advanceTimersByTimeAsync(2_000);
    expect(tracker.snapshot()).toBe("idle");
    expect(states.filter((state) => state === "success")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 3) 接线守卫（订阅回调是 run() 内的闭包，单测驱动不到，与仓库既有做法一致）
// ---------------------------------------------------------------------------

describe("runner/manager pet wiring (source guard)", () => {
  const runnerSrc = fs.readFileSync(
    path.join(process.cwd(), "src/main/agent/agent-runner.ts"),
    "utf8",
  );
  const managerSrc = fs.readFileSync(
    path.join(process.cwd(), "src/main/session/session-manager.ts"),
    "utf8",
  );

  it("AgentRunner feeds the SDK event stream into the outcome tracker", () => {
    expect(runnerSrc).toContain("outcomeTracker.observeEvent(event)");
    expect(runnerSrc).toContain("outcomeTracker.setTerminalError(");
    expect(runnerSrc).toContain("outcomeTracker.markThrown(");
  });

  it("AgentRunner.run() resolves its outcome after the turn settled", () => {
    const resolveCall = runnerSrc.indexOf(
      "return outcomeTracker.resolve(controller.signal.aborted);",
    );
    const finallyAfterRun = runnerSrc.lastIndexOf(
      "this.activeControllers.delete(session.id);",
    );
    expect(resolveCall).toBeGreaterThan(finallyAfterRun);
  });

  it("SessionManager brackets the runner call with start/finish per turn", () => {
    const runCall = managerSrc.indexOf("await this.agentRunner.run(");
    const startCall = managerSrc.lastIndexOf(
      "this.petTracker.start(session.id);",
      runCall,
    );
    const finishCall = managerSrc.indexOf(
      "this.petTracker.finish(session.id, petOutcome);",
      runCall,
    );
    expect(runCall).toBeGreaterThan(-1);
    expect(startCall).toBeGreaterThan(-1);
    expect(startCall).toBeLessThan(runCall);
    expect(finishCall).toBeGreaterThan(runCall);
  });

  it("processQueue only cleans up running state in its finally block", () => {
    expect(managerSrc).toContain(
      'this.petTracker.finish(session.id, "unknown")',
    );
    // 不能出现「会话 idle 就当成功」这类推断。
    expect(managerSrc).not.toMatch(
      /petTracker\.finish\(\s*session\.id,\s*"success"\s*\)/,
    );
  });
});
