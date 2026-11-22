import { afterEach, describe, expect, it, vi } from "vitest";
import { BackgroundShellTaskManager } from "../../main/agent/background-shell-task-manager";

function makeManager(
  overrides: Partial<
    ConstructorParameters<typeof BackgroundShellTaskManager>[0]
  > = {},
) {
  const events: string[] = [];
  const manager = new BackgroundShellTaskManager({
    now: () => 1_000,
    onEvent: (task) => events.push(`${task.id}:${task.status}`),
    ...overrides,
  });
  return { manager, events };
}

const base = {
  sessionId: "s1",
  toolCallId: "call-1",
  toolName: "bash" as const,
  command: "npm ci",
  cwd: "/tmp/project",
  startedAt: 1_000,
  kill: () => undefined,
};

describe("BackgroundShellTaskManager", () => {
  afterEach(() => vi.useRealTimers());

  it("promote 分配递增 id，进入 detached，detachedAt 取当前时间", () => {
    const { manager, events } = makeManager();
    const first = manager.promote(base)!;
    expect(first.id).toBe("1");
    expect(first.status).toBe("detached");
    expect(first.startedAt).toBe(1_000);
    expect(first.detachedAt).toBe(1_000);
    expect(manager.promote({ ...base, toolCallId: "call-2" })?.id).toBe("2");
    expect(events).toEqual(["1:detached", "2:detached"]);
  });

  it("每会话默认最多 3 条 detached，超限返回 null", () => {
    const { manager } = makeManager();
    manager.promote(base);
    manager.promote({ ...base, toolCallId: "call-2" });
    manager.promote({ ...base, toolCallId: "call-3" });
    expect(manager.promote({ ...base, toolCallId: "call-4" })).toBeNull();
    expect(manager.list("s1")).toHaveLength(3);
  });

  it("settle 后腾出名额", () => {
    const { manager } = makeManager();
    manager.promote(base);
    manager.promote({ ...base, toolCallId: "call-2" });
    manager.promote({ ...base, toolCallId: "call-3" });
    manager.settle("s1", "call-1", { exitCode: 0, output: "ok" });
    expect(manager.promote({ ...base, toolCallId: "call-4" })).not.toBeNull();
  });

  it("setTail 只保留最后 tailBytes 个字符，bytesOut 记快照长度", () => {
    const { manager } = makeManager({ tailBytes: 8 });
    manager.promote(base);
    manager.setTail("s1", "call-1", "0123456789abc");
    expect(manager.list("s1")[0].tail).toBe("56789abc");
    expect(manager.list("s1")[0].bytesOut).toBe(13);
  });

  it("exitCode 0 → completed，非 0 → failed；durationMs 从命令开始算", () => {
    let now = 1_000;
    const { manager } = makeManager({ now: () => now });
    manager.promote({ ...base, startedAt: 500 });
    now = 4_500;
    const done = manager.settle("s1", "call-1", { exitCode: 0, output: "" })!;
    expect(done.status).toBe("completed");
    expect(done.durationMs).toBe(4_000);

    manager.promote({ ...base, toolCallId: "call-2" });
    const failed = manager.settle("s1", "call-2", { exitCode: 2, output: "" })!;
    expect(failed.status).toBe("failed");
    expect(failed.exitCode).toBe(2);
  });

  it("settle 带 timedOut 时状态记 timeout（pi 自己的 1800s 超时走这条）", () => {
    const { manager } = makeManager();
    manager.promote(base);
    const settled = manager.settle("s1", "call-1", {
      exitCode: null,
      output: "Command timed out after 1800 seconds",
      timedOut: true,
    })!;
    expect(settled.status).toBe("timeout");
  });

  it("管理器自己的超时：标记 timeout、调用 kill，随后 settle 不改状态", () => {
    vi.useFakeTimers();
    const kill = vi.fn();
    const { manager, events } = makeManager({ timeoutMs: 1_000 });
    manager.promote({ ...base, kill });
    vi.advanceTimersByTime(1_000);
    expect(kill).toHaveBeenCalledTimes(1);
    expect(events.at(-1)).toBe("1:timeout");
    expect(
      manager.settle("s1", "call-1", { exitCode: null, output: "" })!.status,
    ).toBe("timeout");
  });

  it("cancel 触发 kill 并置 killed；settle 不改状态；重复 cancel 返回 false", () => {
    const kill = vi.fn();
    const { manager } = makeManager();
    manager.promote({ ...base, kill });
    expect(manager.cancel("s1", "1")).toBe(true);
    expect(kill).toHaveBeenCalledTimes(1);
    expect(
      manager.settle("s1", "call-1", { exitCode: 143, output: "" })!.status,
    ).toBe("killed");
    expect(manager.cancel("s1", "1")).toBe(false);
  });

  it("同一 taskCall 重复 settle 只产出一次事件（避免二次回填）", () => {
    const { manager, events } = makeManager();
    manager.promote(base);
    manager.settle("s1", "call-1", { exitCode: 0, output: "" });
    expect(
      manager.settle("s1", "call-1", { exitCode: 0, output: "" }),
    ).toBeNull();
    expect(events.filter((e) => e.endsWith(":completed"))).toHaveLength(1);
  });

  it("killAll 与 disposeSession 会 kill 在跑的任务", () => {
    const kill1 = vi.fn();
    const kill2 = vi.fn();
    const { manager } = makeManager();
    manager.promote({ ...base, kill: kill1 });
    manager.promote({
      ...base,
      sessionId: "s2",
      toolCallId: "call-9",
      kill: kill2,
    });
    manager.disposeSession("s1");
    expect(kill1).toHaveBeenCalledTimes(1);
    expect(manager.list("s1")).toHaveLength(0);
    manager.killAll();
    expect(kill2).toHaveBeenCalledTimes(1);
    expect(manager.list("s2")).toHaveLength(0);
  });

  it("settle 记录 pi 交回的完整输出路径", () => {
    const { manager } = makeManager();
    manager.promote(base);
    const settled = manager.settle("s1", "call-1", {
      exitCode: 0,
      output: "",
      outputPath: "/tmp/pi-bash-abc.log",
    })!;
    expect(settled.outputPath).toBe("/tmp/pi-bash-abc.log");
  });
});
