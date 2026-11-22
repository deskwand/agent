import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { BackgroundShellTaskManager } from "../../main/agent/background-shell-task-manager";

const base = {
  sessionId: "s1",
  toolCallId: "call-1",
  toolName: "bash" as const,
  command: "npm ci",
  cwd: "/tmp",
  startedAt: 0,
  kill: () => undefined,
};

describe("后台任务清理契约", () => {
  it("会话删除时 kill 且不再出现在 list 里", () => {
    const kill = vi.fn();
    const manager = new BackgroundShellTaskManager({
      onEvent: () => undefined,
    });
    manager.promote({ ...base, kill });
    manager.disposeSession("s1");
    expect(kill).toHaveBeenCalledTimes(1);
    expect(manager.list("s1")).toEqual([]);
  });

  it("killAll 覆盖所有会话且幂等", () => {
    const kill = vi.fn();
    const manager = new BackgroundShellTaskManager({
      onEvent: () => undefined,
    });
    manager.promote({ ...base, kill });
    manager.promote({ ...base, sessionId: "s2", toolCallId: "call-2", kill });
    manager.killAll();
    manager.killAll();
    expect(kill).toHaveBeenCalledTimes(2);
  });

  it("deleteSession 会 dispose 该会话的后台任务", () => {
    const src = readFileSync(
      join(process.cwd(), "src/main/session/session-manager.ts"),
      "utf8",
    );
    const start = src.indexOf("async deleteSession(");
    const end = src.indexOf("\n  async ", start + 10);
    expect(src.slice(start, end)).toContain("disposeShellTasks(");
  });
});
