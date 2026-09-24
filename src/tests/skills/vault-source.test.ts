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

  function createVaultSkill(name: string, description: string): string {
    const vaultSkills = path.join(testRoot, "vault-skills");
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
});
