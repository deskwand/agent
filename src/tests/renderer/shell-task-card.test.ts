import { describe, expect, it } from "vitest";
import {
  shellTaskCardState,
  splitShellTaskRows,
} from "../../renderer/utils/shell-task-card";
import { isSessionBusy } from "../../renderer/utils/sidebar-session-groups";
import type { ShellTask } from "../../shared/shell-task";

const base: ShellTask = {
  id: "1",
  sessionId: "s1",
  toolCallId: "call-1",
  toolName: "bash",
  command: "npm ci",
  cwd: "/tmp",
  startedAt: 0,
  status: "detached",
  tail: "",
  bytesOut: 0,
};

describe("shellTaskCardState", () => {
  it("没有任务时按是否有结果分前台运行 / 已完成", () => {
    expect(shellTaskCardState({ hasResult: false })).toBe("front");
    expect(shellTaskCardState({ hasResult: true })).toBe("completed");
  });

  it("有任务时跟随任务状态", () => {
    expect(shellTaskCardState({ task: base, hasResult: false })).toBe(
      "detached",
    );
    expect(
      shellTaskCardState({
        task: { ...base, status: "failed" },
        hasResult: false,
      }),
    ).toBe("failed");
    expect(
      shellTaskCardState({
        task: { ...base, status: "killed" },
        hasResult: false,
      }),
    ).toBe("killed");
  });
});

describe("splitShellTaskRows", () => {
  it("按 detached / finished 分组，逐条不丢", () => {
    const rows = splitShellTaskRows({
      a: { ...base, toolCallId: "a" },
      b: { ...base, toolCallId: "b", status: "completed" },
    });
    expect(rows.detached.map((t) => t.toolCallId)).toEqual(["a"]);
    expect(rows.finished.map((t) => t.toolCallId)).toEqual(["b"]);
  });
});

describe("isSessionBusy", () => {
  const session = { status: "idle" } as never;
  it("有后台终端任务也算运行中", () => {
    expect(isSessionBusy(session, [], false, [base])).toBe(true);
    expect(
      isSessionBusy(session, [], false, [{ ...base, status: "completed" }]),
    ).toBe(false);
  });
});
