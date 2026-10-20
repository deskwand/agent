import { beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (...args: unknown[]) => void;

const { FakeClient, clients, flow } = vi.hoisted(() => {
  const flow = { failNextConnect: false };
  class Emitter {
    private handlers = new Map<string, Handler[]>();

    on(event: string, fn: Handler) {
      const list = this.handlers.get(event) ?? [];
      list.push(fn);
      this.handlers.set(event, list);
      return this;
    }

    once(event: string, fn: Handler) {
      const wrap: Handler = (...args) => {
        this.off(event, wrap);
        fn(...args);
      };
      return this.on(event, wrap);
    }

    off(event: string, fn: Handler) {
      const list = this.handlers.get(event) ?? [];
      this.handlers.set(
        event,
        list.filter((item) => item !== fn),
      );
      return this;
    }

    emit(event: string, ...args: unknown[]) {
      for (const fn of [...(this.handlers.get(event) ?? [])]) fn(...args);
      return true;
    }
  }

  class FakeClient extends Emitter {
    options: Record<string, unknown> = {};
    ended = false;
    failExecOnce = false;
    connect(opts: Record<string, unknown>) {
      this.options = opts;
      if (flow.failNextConnect) {
        flow.failNextConnect = false;
        this.emit("error", new Error("Not connected"));
        return;
      }
      const verify = opts.hostVerifier as (key: Buffer) => boolean;
      if (!verify(Buffer.from("host-key"))) {
        this.emit("error", new Error("Host fingerprint verification failed"));
        return;
      }
      this.emit("ready");
    }
    hang = false;
    exec(_cmd: string, cb: (err: Error | null, stream: unknown) => void) {
      if (this.hang) {
        const stream = new Emitter() as Emitter & {
          stderr: Emitter;
          close: () => void;
          signal: () => void;
        };
        stream.stderr = new Emitter();
        stream.close = () => stream.emit("close", 0);
        stream.signal = () => {};
        cb(null, stream);
        return;
      }
      if (this.failExecOnce) {
        this.failExecOnce = false;
        cb(new Error("Not connected"), null);
        return;
      }
      const stream = new Emitter() as Emitter & {
        stderr: Emitter;
        close: () => void;
        signal: () => void;
      };
      stream.stderr = new Emitter();
      stream.close = () => stream.emit("close", 0);
      stream.signal = () => {};
      cb(null, stream);
      setImmediate(() => {
        stream.emit("data", Buffer.from("ok"));
        stream.emit("exit", 0);
        stream.emit("close", 0);
      });
    }
    sftp(cb: (err: Error | null, sftp: unknown) => void) {
      cb(null, { stat: vi.fn() });
    }
    end() {
      this.ended = true;
      this.emit("close");
    }
  }
  const clients: InstanceType<typeof FakeClient>[] = [];
  return { FakeClient, clients, flow };
});

vi.mock("ssh2", () => ({
  Client: class extends FakeClient {
    constructor() {
      super();
      clients.push(this);
    }
  },
}));

const { SshConnection, SshError, sha256Fingerprint } =
  await import("../../main/sandbox/ssh-connection");

function makeStore(decision: "trusted" | "unknown" | "mismatch") {
  return {
    check: vi.fn(() => decision),
    trust: vi.fn(),
  };
}

beforeEach(() => clients.splice(0));

describe("sha256Fingerprint", () => {
  it("输出 OpenSSH 风格的 SHA256 base64", () => {
    expect(sha256Fingerprint(Buffer.from("k"))).toMatch(
      /^SHA256:[A-Za-z0-9+/]{43}$/,
    );
  });
});

describe("SshConnection", () => {
  it("已信任的主机可以连上", async () => {
    const conn = new SshConnection({
      host: "h",
      port: 22,
      username: "u",
      auth: { kind: "password", password: "p" },
      knownHosts: makeStore("trusted"),
    });
    await conn.ensureConnected();
    expect(conn.isConnected).toBe(true);
  });

  it("未信任的主机报 SSH_HOST_KEY_UNKNOWN，且不建连", async () => {
    const conn = new SshConnection({
      host: "h",
      port: 22,
      username: "u",
      auth: { kind: "password", password: "p" },
      knownHosts: makeStore("unknown"),
    });
    await expect(conn.ensureConnected()).rejects.toMatchObject({
      code: "SSH_HOST_KEY_UNKNOWN",
    });
    expect(conn.isConnected).toBe(false);
  });

  it("指纹变化报 SSH_HOST_KEY_MISMATCH", async () => {
    const conn = new SshConnection({
      host: "h",
      port: 22,
      username: "u",
      auth: { kind: "password", password: "p" },
      knownHosts: makeStore("mismatch"),
    });
    await expect(conn.ensureConnected()).rejects.toMatchObject({
      code: "SSH_HOST_KEY_MISMATCH",
    });
  });

  it("并发 ensureConnected 只建一条连接", async () => {
    const conn = new SshConnection({
      host: "h",
      port: 22,
      username: "u",
      auth: { kind: "password", password: "p" },
      knownHosts: makeStore("trusted"),
    });
    await Promise.all([1, 2, 3, 4, 5].map(() => conn.ensureConnected()));
    expect(clients).toHaveLength(1);
  });

  it("exec 返回 stdout 与退出码", async () => {
    const conn = new SshConnection({
      host: "h",
      port: 22,
      username: "u",
      auth: { kind: "password", password: "p" },
      knownHosts: makeStore("trusted"),
    });
    const res = await conn.exec("echo ok");
    expect(res).toEqual({
      success: true,
      stdout: "ok",
      stderr: "",
      exitCode: 0,
    });
  });

  it("exec 遇到 Not connected 重连一次后重试", async () => {
    const conn = new SshConnection({
      host: "h",
      port: 22,
      username: "u",
      auth: { kind: "password", password: "p" },
      knownHosts: makeStore("trusted"),
    });
    await conn.ensureConnected();
    clients[0].failExecOnce = true;
    const res = await conn.exec("echo ok");
    expect(res.success).toBe(true);
    expect(clients).toHaveLength(2);
  });

  it("命令超时返回 124 并关闭通道", async () => {
    const conn = new SshConnection({
      host: "h",
      port: 22,
      username: "u",
      auth: { kind: "password", password: "p" },
      knownHosts: makeStore("trusted"),
    });
    await conn.ensureConnected();
    clients[0].hang = true;
    const res = await conn.exec("sleep 999", 10);
    expect(res.exitCode).toBe(124);
    expect(res.stderr).toContain("timed out");
  });

  it("重连失败一次仍失败时抛 SSH_DISCONNECTED", async () => {
    const conn = new SshConnection({
      host: "h",
      port: 22,
      username: "u",
      auth: { kind: "password", password: "p" },
      knownHosts: makeStore("trusted"),
    });
    await conn.ensureConnected();
    clients[0].failExecOnce = true;
    flow.failNextConnect = true;
    await expect(conn.exec("echo ok")).rejects.toMatchObject({
      code: "SSH_DISCONNECTED",
    });
  });

  it("连接关闭后标记为未连接", async () => {
    const conn = new SshConnection({
      host: "h",
      port: 22,
      username: "u",
      auth: { kind: "password", password: "p" },
      knownHosts: makeStore("trusted"),
    });
    await conn.ensureConnected();
    await conn.close();
    expect(conn.isConnected).toBe(false);
    expect(conn.isClosed).toBe(true);
  });
});

describe("SshError", () => {
  it("保留错误码", () => {
    expect(new SshError("SSH_DISCONNECTED", "x").code).toBe("SSH_DISCONNECTED");
  });
});
