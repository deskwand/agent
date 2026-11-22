import { describe, expect, it } from "vitest";
import {
  buildShellTaskPrompt,
  shouldAutoContinue,
} from "../../main/agent/shell-task-prompt";
import type { ShellTask } from "../../shared/shell-task";

const task: ShellTask = {
  id: "2",
  sessionId: "s1",
  toolCallId: "call-1",
  toolName: "bash",
  command: "npm ci --include=dev",
  cwd: "/tmp/project",
  startedAt: 0,
  detachedAt: 0,
  settledAt: 161_000,
  status: "completed",
  tail: "added 812 packages in 2m38s",
  bytesOut: 41_000,
  exitCode: 0,
  durationMs: 161_000,
  outputPath: "/tmp/pi-bash-abc.log",
};

describe("buildShellTaskPrompt", () => {
  it("带任务 id、命令、退出码、耗时、尾巴与落盘路径", () => {
    const prompt = buildShellTaskPrompt(task);
    expect(prompt).toContain("#2");
    expect(prompt).toContain("npm ci --include=dev");
    expect(prompt).toContain("Exit code: 0");
    expect(prompt).toContain("2m41s");
    expect(prompt).toContain("added 812 packages in 2m38s");
    expect(prompt).toContain("/tmp/pi-bash-abc.log");
  });

  it("超长尾巴截到 4000 字符并标注截断", () => {
    const prompt = buildShellTaskPrompt({ ...task, tail: "x".repeat(9_000) });
    expect(prompt.length).toBeLessThan(5_000);
    expect(prompt).toContain("truncated");
  });

  it("无落盘路径时不出现空路径行", () => {
    const prompt = buildShellTaskPrompt({ ...task, outputPath: undefined });
    expect(prompt).not.toContain("Full output");
  });
});

describe("shouldAutoContinue", () => {
  it("completed / failed / timeout 续跑，killed 不续跑", () => {
    expect(shouldAutoContinue("completed")).toBe(true);
    expect(shouldAutoContinue("failed")).toBe(true);
    expect(shouldAutoContinue("timeout")).toBe(true);
    expect(shouldAutoContinue("killed")).toBe(false);
  });
});
