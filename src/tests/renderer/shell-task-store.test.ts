import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "../../renderer/store";
import type { ShellTask } from "../../shared/shell-task";

const task: ShellTask = {
  id: "2",
  sessionId: "s1",
  toolCallId: "call-1",
  toolName: "bash",
  command: "npm ci",
  cwd: "/tmp",
  startedAt: 1,
  status: "detached",
  tail: "",
  bytesOut: 0,
};

describe("shellTasks store", () => {
  beforeEach(() => useAppStore.setState(useAppStore.getInitialState(), true));

  it("upsert 按 toolCallId 落库，并按会话隔离", () => {
    useAppStore.getState().upsertShellTask("s1", task);
    expect(
      useAppStore.getState().sessionStates.s1?.shellTasks?.["call-1"].status,
    ).toBe("detached");

    useAppStore
      .getState()
      .upsertShellTask("s1", { ...task, status: "completed", exitCode: 0 });
    expect(
      useAppStore.getState().sessionStates.s1?.shellTasks?.["call-1"].status,
    ).toBe("completed");

    expect(useAppStore.getState().sessionStates.s2?.shellTasks ?? {}).toEqual(
      {},
    );
  });

  it("clearSessionShellTasks 只清该会话", () => {
    useAppStore.getState().upsertShellTask("s1", task);
    useAppStore
      .getState()
      .upsertShellTask("s2", {
        ...task,
        sessionId: "s2",
        toolCallId: "call-9",
      });
    useAppStore.getState().clearSessionShellTasks("s1");
    expect(useAppStore.getState().sessionStates.s1?.shellTasks).toEqual({});
    expect(
      useAppStore.getState().sessionStates.s2?.shellTasks?.["call-9"],
    ).toBeTruthy();
  });
});
