import { describe, expect, it, vi } from "vitest";
import {
  globRemote,
  grepRemote,
  scanRemoteWorkspace,
} from "../../main/sandbox/ssh-remote-query";

const output = (stdout: string, exitCode = 0) => ({
  success: exitCode === 0,
  stdout,
  stderr: "",
  exitCode,
});

function executorWith(stdout: string) {
  return { executeCommand: vi.fn(async (_cmd: string) => output(stdout)) };
}

describe("scanRemoteWorkspace", () => {
  it("解析 stat 输出为相对路径与大小，按 mtime 倒序", async () => {
    const executor = executorWith(
      "1700000000\t12\t/srv/app/a.ts\n1700000100\t3\t/srv/app/b/c.md\n",
    );
    const result = await scanRemoteWorkspace(executor as never, "/srv/app");
    expect(result.files).toEqual([
      { relPath: "b/c.md", size: 3 },
      { relPath: "a.ts", size: 12 },
    ]);
    expect(result.truncated).toBe(false);
  });

  it("超过 2000 条时截断并标记", async () => {
    const lines = Array.from(
      { length: 2001 },
      (_, i) => `1\t1\t/srv/app/f${i}.ts`,
    ).join("\n");
    const result = await scanRemoteWorkspace(
      executorWith(lines) as never,
      "/srv/app",
    );
    expect(result.truncated).toBe(true);
    expect(result.files).toHaveLength(2000);
  });

  it("命令里对 root 做了引号转义", async () => {
    const executor = executorWith("");
    await scanRemoteWorkspace(executor as never, "/srv/my app");
    const cmd = executor.executeCommand.mock.calls[0][0] as string;
    expect(cmd).toContain("'/srv/my app'");
  });
});

describe("globRemote / grepRemote", () => {
  it("glob 让远端 shell 展开，并带 globstar", async () => {
    const executor = executorWith("src/a.ts\nsrc/b.ts");
    const files = await globRemote(
      executor as never,
      "/srv/app",
      "src/**/*.ts",
    );
    const cmd = executor.executeCommand.mock.calls[0][0] as string;
    expect(cmd).toContain("shopt -s globstar nullglob");
    expect(cmd).toContain("/srv/app");
    expect(files).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("grep 走远端 grep 并截断到 50 行", async () => {
    const executor = executorWith("/srv/app/a.ts:2:needle");
    const result = await grepRemote(executor as never, "/srv/app", "needle");
    const cmd = executor.executeCommand.mock.calls[0][0] as string;
    expect(cmd).toContain("grep -rIn");
    expect(cmd).toContain("head -n 50");
    expect(result).toContain("needle");
  });
});
