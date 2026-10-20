import { describe, expect, it, vi } from "vitest";

vi.mock("../../main/config/config-store", () => ({
  configStore: { get: () => undefined, update: () => undefined },
}));
vi.mock("../../main/sandbox/sandbox-bootstrap", () => ({
  getSandboxBootstrap: () => ({
    getCachedWSLStatus: () => undefined,
    getCachedLimaStatus: () => undefined,
    reset: () => undefined,
  }),
}));

const connStub = {
  ensureConnected: vi.fn(async () => undefined),
  sftp: vi.fn(async () => ({
    stat: vi.fn(async () => ({ isDirectory: () => true })),
    close: vi.fn(async () => undefined),
  })),
  close: vi.fn(async () => undefined),
  isClosed: false,
};
const getSpy = vi.fn(async (_host: { id: string }) => connStub);
vi.mock("../../main/sandbox/ssh-config-service", () => ({
  SshConnectionPool: class {
    get = getSpy;
    activeHostIds = () => ["h1"];
    closeAll = vi.fn(async () => undefined);
  },
  SshConfigService: class {
    getHost = (id: string) =>
      id === "h1"
        ? {
            id: "h1",
            label: "z",
            host: "1.2.3.4",
            port: 22,
            username: "root",
            authMode: "password",
          }
        : undefined;
    listHosts = () => [];
  },
}));

const { getSandboxAdapter } = await import(
  "../../main/sandbox/sandbox-adapter"
);
const { SshExecutor } = await import("../../main/sandbox/ssh-executor");

describe("resolveExecutor", () => {
  it("ssh:// 交给 SshExecutor，并复用同一 host 的连接", async () => {
    const adapter = getSandboxAdapter();
    const executor = await adapter.resolveExecutor("ssh://h1/srv/app");
    expect(executor).toBeInstanceOf(SshExecutor);
    await adapter.resolveExecutor("ssh://h1/srv/app/src");
    // 两个工作区各自一个执行器，但都向同一个 host 取连接
    expect(getSpy).toHaveBeenCalledTimes(2);
    expect(getSpy.mock.calls.map((call) => call[0].id)).toEqual(["h1", "h1"]);
  });

  it("本地路径仍走全局 executor", async () => {
    const adapter = getSandboxAdapter();
    const local = { executeCommand: vi.fn() };
    (adapter as unknown as { executor: unknown }).executor = local;
    expect(await adapter.resolveExecutor("/Users/a/proj")).toBe(local);
  });

  it("未登记的 hostId 报 SSH_UNKNOWN", async () => {
    const adapter = getSandboxAdapter();
    await expect(
      adapter.resolveExecutor("ssh://missing/srv"),
    ).rejects.toMatchObject({ code: "SSH_UNKNOWN" });
  });

  it("activeSshHostIds 暴露在用主机", () => {
    expect(getSandboxAdapter().activeSshHostIds).toEqual(["h1"]);
  });
});
