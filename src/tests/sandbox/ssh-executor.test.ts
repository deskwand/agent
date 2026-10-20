import { Readable, Writable } from "stream";
import { describe, expect, it, vi } from "vitest";
import { SshPathGuard } from "../../main/sandbox/ssh-path-guard";
import {
  SshExecutor,
  buildRemoteCommand,
} from "../../main/sandbox/ssh-executor";
import type { SshConnection } from "../../main/sandbox/ssh-connection";

function fakeSftp(overrides: Record<string, unknown> = {}) {
  return {
    stat: vi.fn(async () => ({ isDirectory: () => true, size: 3 })),
    readdir: vi.fn(async () => [
      { filename: "b.txt", attrs: { isDirectory: () => false, size: 2 } },
      { filename: "a", attrs: { isDirectory: () => true, size: 0 } },
    ]),
    createReadStream: vi.fn(() => Readable.from(["hey"])),
    createWriteStream: vi.fn(
      () => new Writable({ write: (_c, _e, cb) => cb() }),
    ),
    unlink: vi.fn(async () => undefined),
    mkdir: vi.fn(async () => undefined),
    ...overrides,
  };
}

function fakeConnection(overrides: Record<string, unknown> = {}) {
  return {
    ensureConnected: vi.fn(async () => undefined),
    exec: vi.fn(async () => ({
      success: true,
      stdout: "",
      stderr: "",
      exitCode: 0,
    })),
    sftp: vi.fn(async () => fakeSftp()),
    close: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as SshConnection;
}

describe("buildRemoteCommand", () => {
  it("在子 shell 里 cd 并注入 env，保留命令退出码", () => {
    expect(buildRemoteCommand("pwd", "/srv/app")).toBe(
      "cd '/srv/app' && (pwd)",
    );
    expect(buildRemoteCommand("pwd", "/srv app", { A: "b c" })).toBe(
      "cd '/srv app' && (export A='b c'; pwd)",
    );
  });
});

describe("SshPathGuard", () => {
  const guard = new SshPathGuard("/srv/app");

  it("允许工作区内路径", () => {
    expect(guard.assertInside("/srv/app/src/a.ts")).toBe("/srv/app/src/a.ts");
    expect(guard.assertInside("/srv/app")).toBe("/srv/app");
  });

  it("拒绝越界与 .. 穿越", () => {
    expect(() => guard.assertInside("/srv/other")).toThrow(/outside workspace/);
    expect(() => guard.assertInside("/srv/app/../other")).toThrow(
      /outside workspace/,
    );
  });
});

describe("SshExecutor", () => {
  it("initialize 在目录不存在时报 SSH_WORKSPACE_MISSING", async () => {
    const conn = fakeConnection({
      sftp: vi.fn(async () =>
        fakeSftp({
          stat: vi.fn(async () => {
            throw Object.assign(new Error("No such file"), { code: 2 });
          }),
        }),
      ),
    });
    const executor = new SshExecutor(conn, "/srv/app");
    await expect(
      executor.initialize({ workspacePath: "/srv/app" }),
    ).rejects.toMatchObject({ code: "SSH_WORKSPACE_MISSING" });
  });

  it("executeCommand 使用工作区根作为默认 cwd", async () => {
    const conn = fakeConnection();
    const executor = new SshExecutor(conn, "/srv/app");
    await executor.initialize({ workspacePath: "/srv/app" });
    await executor.executeCommand("ls");
    expect(conn.exec).toHaveBeenCalledWith("cd '/srv/app' && (ls)", 120000);
  });

  it("listDirectory 目录优先、名称升序", async () => {
    const conn = fakeConnection();
    const executor = new SshExecutor(conn, "/srv/app");
    await executor.initialize({ workspacePath: "/srv/app" });
    expect(await executor.listDirectory("/srv/app")).toEqual([
      { name: "a", isDirectory: true, size: 0 },
      { name: "b.txt", isDirectory: false, size: 2 },
    ]);
  });

  it("fileExists 对 ENOENT 返回 false", async () => {
    const conn = fakeConnection({
      sftp: vi.fn(async () =>
        fakeSftp({
          stat: vi.fn(async () => {
            throw Object.assign(new Error("no file"), { code: 2 });
          }),
        }),
      ),
    });
    const executor = new SshExecutor(conn, "/srv/app");
    await executor.initialize({ workspacePath: "/srv/app" }).catch(() => {});
    expect(await executor.fileExists("/srv/app/x")).toBe(false);
  });

  it("子目录工作区不能读父工作区的文件", async () => {
    const parent = new SshExecutor(fakeConnection(), "/srv/app");
    const child = new SshExecutor(fakeConnection(), "/srv/app/src");
    await parent.initialize({ workspacePath: "/srv/app" });
    await child.initialize({ workspacePath: "/srv/app/src" });
    await expect(child.readFile("/srv/app/package.json")).rejects.toThrow(
      /outside workspace/,
    );
  });

  it("越界路径被拒绝，且不触及远端", async () => {
    const conn = fakeConnection();
    const executor = new SshExecutor(conn, "/srv/app");
    await executor.initialize({ workspacePath: "/srv/app" });
    await expect(executor.readFile("/etc/passwd")).rejects.toThrow(
      /outside workspace/,
    );
    expect(conn.exec).not.toHaveBeenCalled();
  });
});
