import { describe, expect, it, vi } from "vitest";
import type { AskUserQuestion } from "../../shared/ask-user";
import type { DatabaseInstance } from "../../main/db/database";
import { SessionManager } from "../../main/session/session-manager";

const questions: AskUserQuestion[] = [
  {
    question: "数据库用哪个？",
    header: "技术栈",
    type: "choice",
    options: [{ label: "PostgreSQL" }, { label: "SQLite" }],
  },
];

// SessionManager 在测试环境用桩 db + noop 渲染通道即可构造（构造期不触碰 db）。
// stopSession 会经 updateSessionStatus 写 db.sessions，需要最小桩。
function makeSessionManager(): SessionManager {
  const db = {
    sessions: { update: () => {} },
  } as unknown as DatabaseInstance;
  return new SessionManager(db, () => {});
}

// sendToRenderer 是 private，用桥接 spy 观察出站事件。
function spySend(sm: SessionManager) {
  const inner = sm as unknown as {
    sendToRenderer: (e: { type: string; payload: unknown }) => void;
  };
  return vi.spyOn(inner, "sendToRenderer");
}

describe("session-manager ask_user", () => {
  it("requestAskUser 挂起并在 handleAskUserResponse 时 resolve 答案", async () => {
    const sm = makeSessionManager();
    const send = spySend(sm);
    const promise = sm.requestAskUser("s-1", "t-1", questions);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "askUser.request",
        payload: { sessionId: "s-1", toolCallId: "t-1", questions },
      }),
    );
    sm.handleAskUserResponse("s-1", "t-1", { "0": "PostgreSQL" });
    await expect(promise).resolves.toEqual({
      status: "answered",
      answers: { "0": "PostgreSQL" },
    });
  });

  it("answers 结构非法时忽略并保持 pending", async () => {
    const sm = makeSessionManager();
    const promise = sm.requestAskUser("s-1", "t-1", questions);
    sm.handleAskUserResponse("s-1", "t-1", { "0": 42 as unknown as string });
    sm.handleAskUserResponse("s-1", "t-1", { "0": "PostgreSQL" });
    await expect(promise).resolves.toEqual({
      status: "answered",
      answers: { "0": "PostgreSQL" },
    });
  });

  it("response 的 sessionId 不匹配时忽略（防串会话）", async () => {
    const sm = makeSessionManager();
    const promise = sm.requestAskUser("s-1", "t-1", questions);
    sm.handleAskUserResponse("s-OTHER", "t-1", { "0": "x" });
    sm.handleAskUserResponse("s-1", "t-1", { "0": "PostgreSQL" });
    await expect(promise).resolves.toEqual({
      status: "answered",
      answers: { "0": "PostgreSQL" },
    });
  });

  it("二次 response 无效（取出即删）", async () => {
    const sm = makeSessionManager();
    const promise = sm.requestAskUser("s-1", "t-1", questions);
    sm.handleAskUserResponse("s-1", "t-1", { "0": "A" });
    sm.handleAskUserResponse("s-1", "t-1", { "0": "B" });
    await expect(promise).resolves.toEqual({
      status: "answered",
      answers: { "0": "A" },
    });
  });

  it("cancelPendingAskUsers 以 cancelled resolve 并发 dismiss 事件", async () => {
    const sm = makeSessionManager();
    const send = spySend(sm);
    const promise = sm.requestAskUser("s-1", "t-1", questions);
    sm.cancelPendingAskUsers("s-1");
    await expect(promise).resolves.toEqual({
      status: "cancelled",
      reason: "stopped",
    });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "askUser.dismiss",
        payload: { toolCallId: "t-1" },
      }),
    );
  });

  it("可按 userReplied 解提问：用户在对话里回复了", async () => {
    const sm = makeSessionManager();
    const send = spySend(sm);
    const promise = sm.requestAskUser("s-1", "t-1", questions);
    sm.cancelPendingAskUsers("s-1", "userReplied");
    await expect(promise).resolves.toEqual({
      status: "cancelled",
      reason: "userReplied",
    });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "askUser.dismiss",
        payload: { toolCallId: "t-1" },
      }),
    );
  });

  it("stopSession 经 cancelPendingAskUsers 清理本会话的挂起提问", async () => {
    const sm = makeSessionManager();
    const send = spySend(sm);
    const promise = sm.requestAskUser("s-1", "t-1", questions);
    sm.stopSession("s-1");
    await expect(promise).resolves.toEqual({
      status: "cancelled",
      reason: "stopped",
    });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "askUser.dismiss",
        payload: { toolCallId: "t-1" },
      }),
    );
  });
});

describe("session-manager steerSession 与挂起提问", () => {
  type SteerInternals = {
    loadSession: (sessionId: string) => unknown;
    agentRunner: { steer: (...args: unknown[]) => Promise<boolean> };
  };

  it("先确认 steer 入队，再把提问解成 userReplied", async () => {
    const sm = makeSessionManager();
    const promise = sm.requestAskUser("s-1", "t-1", questions);
    let resolvedAlready = false;
    void promise.then(() => {
      resolvedAlready = true;
    });

    let resolvedWhenQueued: boolean | null = null;
    const internals = sm as unknown as SteerInternals;
    internals.loadSession = () => ({ id: "s-1" });
    internals.agentRunner = {
      steer: vi.fn(async () => {
        await Promise.resolve();
        resolvedWhenQueued = resolvedAlready;
        return true;
      }),
    };

    await sm.steerSession("s-1", "就用 SQLite 吧", "r-1");
    await expect(promise).resolves.toEqual({
      status: "cancelled",
      reason: "userReplied",
    });
    // 入队那一刻提问还没被解掉 —— 顺序反了会丢消息
    expect(resolvedWhenQueued).toBe(false);
  });

  it("steer 没入队时不解提问（消息不能两头空）", async () => {
    const sm = makeSessionManager();
    const promise = sm.requestAskUser("s-1", "t-1", questions);

    const internals = sm as unknown as SteerInternals;
    internals.loadSession = () => ({ id: "s-1" });
    internals.agentRunner = { steer: vi.fn(async () => false) };

    await sm.steerSession("s-1", "就用 SQLite 吧", "r-1");
    // 仍挂起：只有显式作答才 resolve
    sm.handleAskUserResponse("s-1", "t-1", { "0": "SQLite" });
    await expect(promise).resolves.toEqual({
      status: "answered",
      answers: { "0": "SQLite" },
    });
  });

  it("只解本会话的提问：别的会话挂着的卡片不动", async () => {
    const sm = makeSessionManager();
    const first = sm.requestAskUser("s-1", "t-1", questions);
    const second = sm.requestAskUser("s-2", "t-2", questions);

    const internals = sm as unknown as SteerInternals;
    internals.loadSession = () => ({ id: "s-1" });
    internals.agentRunner = { steer: vi.fn(async () => true) };

    await sm.steerSession("s-1", "就用 SQLite 吧", "r-1");
    await expect(first).resolves.toEqual({
      status: "cancelled",
      reason: "userReplied",
    });

    // s-2 仍挂起：只有它自己的回答能 resolve 它
    let secondResolved = false;
    void second.then(() => {
      secondResolved = true;
    });
    await Promise.resolve();
    expect(secondResolved).toBe(false);
    sm.handleAskUserResponse("s-2", "t-2", { "0": "PostgreSQL" });
    await expect(second).resolves.toEqual({
      status: "answered",
      answers: { "0": "PostgreSQL" },
    });
  });
});
