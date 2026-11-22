import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(
  join(process.cwd(), "src/main/agent/agent-runner.ts"),
  "utf8",
);

describe("AgentRunner 的后台终端任务接线", () => {
  it("持有 manager 与按会话的 detach hub", () => {
    expect(src).toContain("BackgroundShellTaskManager");
    expect(src).toContain("createShellDetachHub");
    expect(src).toContain("shellDetachHubs");
  });

  it("包装在 sudo 包装之后接入（bash 仍走原有链路）", () => {
    const sudo = src.indexOf("this.wrapBashToolForSudo(");
    const background = src.indexOf("withShellBackground(");
    expect(sudo).toBeGreaterThan(-1);
    expect(background).toBeGreaterThan(sudo);
  });

  it("暴露五个方法", () => {
    expect(src).toContain(
      "detachShellTask(sessionId: string, toolCallId: string): boolean",
    );
    expect(src).toContain(
      "cancelShellTask(sessionId: string, taskId: string): boolean",
    );
    expect(src).toContain("listShellTasks(sessionId: string): ShellTask[]");
    expect(src).toContain("killAllShellTasks(): void");
    expect(src).toContain("disposeShellTasks(sessionId: string): void");
  });

  it("停整轮（cancel）不会 dispose 后台任务 —— Esc 不该杀后台", () => {
    const start = src.indexOf("  cancel(sessionId: string): void {");
    const end = src.indexOf("\n  /**", start);
    expect(src.slice(start, end)).not.toContain("disposeShellTasks(");
  });
});
