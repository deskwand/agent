import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it, vi } from "vitest";

type Handler = (...args: unknown[]) => void;

let keyAttempts = 0;

const { FakeClient, clients, execState } = vi.hoisted(() => {
  class Emitter {
    private handlers = new Map<string, Handler[]>();
    on(event: string, fn: Handler) {
      const list = this.handlers.get(event) ?? [];
      list.push(fn);
      this.handlers.set(event, list);
      return this;
    }
    once(event: string, fn: Handler) {
      const wrap: Handler = (...args: unknown[]) => {
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

  const execState = { exitCode: 0 };

  class FakeClient extends Emitter {
    connect(opts: Record<string, unknown>) {
      const verify = opts.hostVerifier as (key: Buffer) => boolean;
      if (!verify(Buffer.from("k"))) {
        this.emit("error", new Error("Host verification failed"));
        return;
      }
      if (opts.password) {
        this.emit("ready");
        return;
      }
      // 第一次纯密钥登录失败，引导后的验证连接成功
      keyAttempts += 1;
      if (keyAttempts >= 2) this.emit("ready");
      else
        this.emit(
          "error",
          new Error("All configured authentication methods failed"),
        );
    }
    exec(_cmd: string, cb: (err: Error | null, stream: unknown) => void) {
      const stream = new Emitter() as Emitter & {
        stderr: Emitter;
        close: () => void;
        signal: () => void;
      };
      stream.stderr = new Emitter();
      stream.close = () => stream.emit("close", execState.exitCode);
      stream.signal = () => {};
      cb(null, stream);
      setImmediate(() => {
        stream.emit("exit", execState.exitCode);
        stream.emit("close", execState.exitCode);
      });
    }
    end() {
      this.emit("close");
    }
  }
  const clients: InstanceType<typeof FakeClient>[] = [];
  return { FakeClient, clients, execState };
});

vi.mock("ssh2", () => ({
  Client: class extends FakeClient {
    constructor() {
      super();
      clients.push(this);
    }
  },
}));

const { testSshConnection } = await import(
  "../../main/sandbox/ssh-test-connection"
);

const host = {
  id: "h1",
  label: "z",
  host: "1.2.3.4",
  port: 22,
  username: "root",
  authMode: "password" as const,
};

function trustedStore() {
  return { check: () => "trusted" as const, trust: () => undefined };
}

function keyDir() {
  return mkdtempSync(join(tmpdir(), "deskwand-key-"));
}

describe("testSshConnection", () => {
  it("没有密码时只走密钥阶段，报 SSH_AUTH_FAILED", async () => {
    keyAttempts = 0;
    const stages: string[] = [];
    await expect(
      testSshConnection({
        host,
        knownHosts: trustedStore(),
        keyDir: keyDir(),
        onStage: (stage) => stages.push(stage),
      }),
    ).rejects.toMatchObject({ code: "SSH_AUTH_FAILED" });
    expect(stages).toEqual(["key"]);
  });

  it("密码 → 写入公钥 → 密钥验证，三个阶段按序上报", async () => {
    keyAttempts = 0;
    const stages: string[] = [];
    const result = await testSshConnection({
      host,
      password: "p",
      knownHosts: trustedStore(),
      keyDir: keyDir(),
      onStage: (stage) => stages.push(stage),
    });
    expect(result.passwordless).toBe(true);
    expect(stages).toEqual(["key", "password", "bootstrap"]);
  });

  it("写入公钥失败时报 SSH_BOOTSTRAP_FAILED，且停在 password 阶段", async () => {
    keyAttempts = 0;
    execState.exitCode = 1;
    const stages: string[] = [];
    await expect(
      testSshConnection({
        host,
        password: "p",
        knownHosts: trustedStore(),
        keyDir: keyDir(),
        onStage: (stage) => stages.push(stage),
      }),
    ).rejects.toMatchObject({ code: "SSH_BOOTSTRAP_FAILED" });
    expect(stages).toEqual(["key", "password"]);
    execState.exitCode = 0;
  });
});
