import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let testRoot = "";

vi.mock("electron", () => ({
  app: {
    getAppPath: () => testRoot,
    getVersion: () => "0.0.0-test",
    getPath: (name: string) => {
      if (name === "userData") return path.join(testRoot, "userData");
      if (name === "home") return path.join(testRoot, "home");
      return testRoot;
    },
  },
}));

vi.mock("../../main/utils/logger", () => ({
  log: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

import { SkillsManager } from "../../main/skills/skills-manager";
import type { DatabaseInstance } from "../../main/db/database";

function createDbMock(): DatabaseInstance {
  const statement = { run: vi.fn(), get: vi.fn(), all: vi.fn() };
  return {
    raw: {} as never,
    sessions: {} as never,
    messages: {} as never,
    traceSteps: {} as never,
    scheduledTasks: {} as never,
    prepare: vi.fn(() => statement as never),
    exec: vi.fn(),
    pragma: vi.fn(),
    close: vi.fn(),
  } as unknown as DatabaseInstance;
}

describe("SkillsManager vault source", () => {
  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "deskwand-vault-src-"));
  });

  afterEach(() => {
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  /** 技能密库的默认位置，与 SkillsManager.getVaultSkillsPath() 解析出的路径一致。 */
  function defaultVaultSkillsDir(): string {
    return path.join(testRoot, "home", ".deskwand", "vault", "skills");
  }

  function createVaultSkill(name: string, description: string): string {
    const vaultSkills = defaultVaultSkillsDir();
    fs.mkdirSync(path.join(vaultSkills, name), { recursive: true });
    fs.writeFileSync(
      path.join(vaultSkills, name, "SKILL.md"),
      `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n`,
    );
    return vaultSkills;
  }

  it("loads vault skills with a distinct id prefix and type", async () => {
    const vaultSkills = createVaultSkill("foo", "from the vault");
    const manager = new SkillsManager(createDbMock());

    const skills = await manager.loadVaultSkillsFrom(vaultSkills);

    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({
      id: "vault-foo",
      type: "vault",
      name: "foo",
    });
  });

  it("returns nothing when the vault directory does not exist", async () => {
    const manager = new SkillsManager(createDbMock());

    await expect(
      manager.loadVaultSkillsFrom(path.join(testRoot, "missing")),
    ).resolves.toEqual([]);
  });

  it("refuses to uninstall a vault skill through the global path", async () => {
    const vaultSkills = createVaultSkill("foo", "from the vault");
    const manager = new SkillsManager(createDbMock());
    await manager.loadVaultSkillsFrom(vaultSkills);

    await expect(manager.uninstallSkill("vault-foo")).rejects.toThrow(
      "Cannot delete vault skills here",
    );
    // 关键：密库副本必须原封不动
    expect(fs.existsSync(path.join(vaultSkills, "foo", "SKILL.md"))).toBe(true);
  });

  it("lists a vault skill without any explicit load (regression)", async () => {
    createVaultSkill("foo", "from the vault");
    const manager = new SkillsManager(createDbMock());

    // 不调用 loadVaultSkills / loadVaultSkillsFrom —— 模拟「用户刚上传完」的场景，
    // 此时只有启动时那次（空目录）加载发生过。
    const skills = await manager.listSkills();

    expect(skills.map((s) => s.id)).toContain("vault-foo");
  });

  // 特征化测试（characterization）：改动之前它就会通过 —— loadedSkills 的插入顺序
  // 天然是 global 在前。它锁住的是「本地胜出」这个结果，防止以后有人调整加载顺序
  // 时静默改变优先级；`deduplicateSkills` 从隐式顺序改成显式规则这件事本身无法用
  // 「先失败后通过」验证。
  it("prefers the local skill when a name exists in both sources", async () => {
    createVaultSkill("foo", "from the vault");
    // 同名技能也放在全局目录里
    const globalDir = path.join(testRoot, "home", ".deskwand", "skills");
    fs.mkdirSync(path.join(globalDir, "foo"), { recursive: true });
    fs.writeFileSync(
      path.join(globalDir, "foo", "SKILL.md"),
      "---\nname: foo\ndescription: local\n---\n# foo\n",
    );
    const manager = new SkillsManager(createDbMock());

    const skills = await manager.listSkills();
    const foo = skills.filter((s) => s.name === "foo");

    expect(foo).toHaveLength(1);
    expect(foo[0].id).toBe("global-foo");
  });

  it("keeps listing when the vault directory does not exist", async () => {
    const manager = new SkillsManager(createDbMock());

    const skills = await manager.listSkills();

    expect(Array.isArray(skills)).toBe(true);
    expect(skills.some((s) => s.id.startsWith("vault-"))).toBe(false);
  });
});
