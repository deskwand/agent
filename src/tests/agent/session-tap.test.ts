import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSubagentTap,
  diffRegistryEntries,
  releaseManagerRegistryEntry,
} from "../../main/agent/subagent/session-tap";

interface FakeRecord {
  id?: string;
  toolCallId?: string;
  status?: string;
  toolUses?: number;
  startedAt?: number;
  completedAt?: number;
  session?: { subscribe: (listener: (event: unknown) => void) => () => void };
}

function makeRecord(overrides: Partial<FakeRecord> = {}) {
  const listeners: Array<(event: unknown) => void> = [];
  const unsubscribe = vi.fn();
  const record: FakeRecord = {
    id: "a1",
    toolCallId: "call-1",
    status: "running",
    toolUses: 0,
    startedAt: 0,
    session: {
      subscribe: (listener) => {
        listeners.push(listener);
        // 真实的 session.subscribe 返回的 unsub 会真的解绑；假对象也必须如此，
        // 否则「dispose 后不再收到事件」这类断言测不出来。
        return () => {
          const index = listeners.indexOf(listener);
          if (index >= 0) listeners.splice(index, 1);
          unsubscribe();
        };
      },
    },
    ...overrides,
  };
  return {
    record,
    emit: (event: unknown) => listeners.forEach((l) => l(event)),
    unsubscribe,
  };
}

function registryOf(records: FakeRecord[]) {
  return [{ listAgents: () => records }];
}

describe("createSubagentTap", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("轮询找到 record 后订阅，并把工具事件节流成快照", () => {
    const { record, emit } = makeRecord();
    const sent: unknown[] = [];
    const tap = createSubagentTap({
      send: (activity) => sent.push(activity),
      registry: () => registryOf([record]),
      now: () => 1000,
    });

    tap.observeAgentToolCall("s1", "call-1");
    vi.advanceTimersByTime(100);

    emit({
      type: "tool_execution_start",
      toolCallId: "t1",
      toolName: "read",
      args: { path: "a.ts" },
    });
    emit({
      type: "tool_execution_start",
      toolCallId: "t2",
      toolName: "bash",
      args: { command: "npm test" },
    });
    expect(sent).toHaveLength(0);

    vi.advanceTimersByTime(150);
    expect(sent).toHaveLength(1);
    const activity = sent[0] as {
      parentToolCallId: string;
      current?: { toolName: string };
      steps: unknown[];
    };
    expect(activity.parentToolCallId).toBe("call-1");
    expect(activity.current?.toolName).toBe("bash");
    expect(activity.steps).toHaveLength(2);
  });

  it("record.session 还没就绪时继续轮询，就绪后才订阅", () => {
    const { record } = makeRecord({ session: undefined });
    const sent: unknown[] = [];
    const tap = createSubagentTap({
      send: (activity) => sent.push(activity),
      registry: () => registryOf([record]),
      now: () => 1000,
    });

    tap.observeAgentToolCall("s1", "call-1");
    vi.advanceTimersByTime(500); // 第一轮重试：找到 record 但没 session → 继续等
    expect(sent).toHaveLength(0);

    const ready = makeRecord();
    record.session = ready.record.session;
    vi.advanceTimersByTime(500); // 下一轮重试：绑定成功 → 订阅 + 排一次 flush
    vi.advanceTimersByTime(150); // 节流窗口到点：先发一帧空快照
    expect(sent).toHaveLength(1);

    ready.emit({
      type: "tool_execution_start",
      toolCallId: "t1",
      toolName: "read",
      args: { path: "a.ts" },
    });
    vi.advanceTimersByTime(150);
    expect(sent).toHaveLength(2);
  });

  it("找不到 record 时轮询到上限就放弃，且不抛错", () => {
    const tap = createSubagentTap({
      send: () => {
        throw new Error("不应该发事件");
      },
      registry: () => [],
      now: () => 1000,
    });
    tap.observeAgentToolCall("s1", "missing");
    vi.advanceTimersByTime(100 * 25);
    expect(vi.getTimerCount()).toBe(0); // 已放弃，不再空转
  });

  it("record 存在但会话长时间未建（排队）时不放弃，会话就绪后仍能流式", () => {
    const { record } = makeRecord({ session: undefined });
    const sent: unknown[] = [];
    const tap = createSubagentTap({
      send: (activity) => sent.push(activity),
      registry: () => registryOf([record]),
      now: () => 1000,
    });

    tap.observeAgentToolCall("s1", "call-1");
    vi.advanceTimersByTime(5000); // 远超旧的 2s 上限
    expect(sent).toHaveLength(0);
    expect(vi.getTimerCount()).toBeGreaterThan(0); // 仍在等

    const ready = makeRecord();
    record.session = ready.record.session;
    vi.advanceTimersByTime(500);
    vi.advanceTimersByTime(150);
    expect(sent).toHaveLength(1);

    ready.emit({
      type: "tool_execution_start",
      toolCallId: "t1",
      toolName: "bash",
      args: { command: "npm test" },
    });
    vi.advanceTimersByTime(150);
    expect(sent).toHaveLength(2);
  });

  it("等待中 record 已进入终态时立即收工，不再空等", () => {
    const { record } = makeRecord({ session: undefined, status: "aborted" });
    const tap = createSubagentTap({
      send: () => {
        throw new Error("不应该发事件");
      },
      registry: () => registryOf([record]),
      now: () => 1000,
    });
    tap.observeAgentToolCall("s1", "call-1");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("finishAgent 传 agentId（而不是 toolCallId）也能收尾并退订", () => {
    const { record, unsubscribe } = makeRecord({ id: "a1" });
    const sent: Array<{ status: string }> = [];
    const tap = createSubagentTap({
      send: (activity) => sent.push(activity as { status: string }),
      registry: () => registryOf([record]),
      now: () => 1000,
    });

    tap.observeAgentToolCall("s1", "call-1");
    vi.advanceTimersByTime(100);
    record.status = "completed";
    tap.finishAgent("a1", "completed");
    expect(sent.at(-1)?.status).toBe("completed");
    expect(unsubscribe).toHaveBeenCalled();
  });

  it("finishAgent 发最后一帧并退订", () => {
    const { record, unsubscribe } = makeRecord();
    const sent: Array<{ status: string }> = [];
    const tap = createSubagentTap({
      send: (activity) => sent.push(activity as { status: string }),
      registry: () => registryOf([record]),
      now: () => 1000,
    });

    tap.observeAgentToolCall("s1", "call-1");
    vi.advanceTimersByTime(100);
    tap.finishAgent("a1", "completed");
    expect(sent.at(-1)?.status).toBe("completed");
    expect(unsubscribe).toHaveBeenCalled();
  });

  it("disposeSession 清掉该会话的定时器", () => {
    const { record, emit } = makeRecord();
    const sent: unknown[] = [];
    const tap = createSubagentTap({
      send: (activity) => sent.push(activity),
      registry: () => registryOf([record]),
      now: () => 1000,
    });

    tap.observeAgentToolCall("s1", "call-1");
    vi.advanceTimersByTime(100);
    sent.length = 0;
    tap.disposeSession("s1");
    emit({
      type: "tool_execution_start",
      toolCallId: "t1",
      toolName: "read",
      args: {},
    });
    vi.advanceTimersByTime(1000);
    expect(sent).toHaveLength(0);
  });

  // C1 的回归：补丁把 entry 的摘除挂在 session_shutdown，而本宿主不发它，
  // 所以改成「激活时用差集捕获 + 会话释放时主动摘」。
  it("diffRegistryEntries 认出新增条目，release 把它摘掉", () => {
    const key = Symbol.for("pi-subagents:manager-list");
    const globalStore = globalThis as unknown as Record<PropertyKey, unknown>;
    const original = globalStore[key];
    try {
      const before = [{ listAgents: () => [] }];
      globalStore[key] = new Set(before);
      const added = { listAgents: () => [] };
      (globalStore[key] as Set<unknown>).add(added);

      expect(diffRegistryEntries(new Set(before))).toBe(added);
      releaseManagerRegistryEntry(added);
      expect([...(globalStore[key] as Set<unknown>)]).toEqual(before);
    } finally {
      if (original === undefined) delete globalStore[key];
      else globalStore[key] = original;
    }
  });
});
