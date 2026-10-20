import { beforeEach, describe, expect, it, vi } from "vitest";

const memory = new Map<string, unknown>();
vi.mock("../../main/config/config-store", () => ({
  configStore: {
    get: (key: string) => memory.get(key),
    update: (patch: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(patch)) memory.set(k, v);
    },
  },
}));

const { SshConfigService } = await import(
  "../../main/sandbox/ssh-config-service"
);

beforeEach(() => memory.clear());

function hostInput(overrides: Record<string, unknown> = {}) {
  return {
    label: "z",
    host: "1.2.3.4",
    port: 22,
    username: "root",
    authMode: "password" as const,
    ...overrides,
  };
}

describe("SshConfigService", () => {
  it("保存后能按 id 取回，密码不写入配置", () => {
    const service = new SshConfigService();
    const saved = service.saveHost(hostInput());
    expect(service.getHost(saved.id)?.host).toBe("1.2.3.4");
    const stored = memory.get("sshHosts") as Array<Record<string, unknown>>;
    expect(stored[0]).not.toHaveProperty("password");
  });

  it("删除被工作区引用的主机被拒绝", () => {
    const service = new SshConfigService();
    const saved = service.saveHost(hostInput());
    expect(() =>
      service.deleteHost(saved.id, [`ssh://${saved.id}/srv/app`]),
    ).toThrow(/still used/i);
    expect(service.listHosts()).toHaveLength(1);
  });

  it("只保存白名单字段，password 不会进配置", () => {
    const service = new SshConfigService();
    const saved = service.saveHost({
      ...hostInput(),
      password: "hunter2",
    } as never);
    expect(JSON.stringify(memory.get("sshHosts"))).not.toContain("hunter2");
    expect(Object.keys(saved)).not.toContain("password");
  });

  it("未引用的主机可以删除", () => {
    const service = new SshConfigService();
    const saved = service.saveHost(hostInput());
    service.deleteHost(saved.id, []);
    expect(service.listHosts()).toHaveLength(0);
  });
});
