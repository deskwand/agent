import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let testRoot = "";

vi.mock("electron", () => ({
  app: {
    getAppPath: () => path.join(testRoot, "app"),
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

import {
  DEFAULT_DISABLED_BUILTINS,
  resolveBuiltinSkillEnabled,
} from "../../main/skills/default-disabled-skills";
import { SkillsManager } from "../../main/skills/skills-manager";
import type { DatabaseInstance } from "../../main/db/database";

/**
 * 注意：`SkillsManager.getBuiltinSkillsPath()` 的第一个候选是 `__dirname` 往上三层的
 * `.deskwand/skills`，在 vitest 里就是**仓库自己的内置技能目录**，所以这里不造 fixture，
 * 直接拿两个真实存在的内置技能对账（officecli 默认启用，ponytail 默认禁用）。
 */

/** `get(id)` 的行为由 rowById 决定：返回 undefined 表示「用户没改过这个技能」。 */
function createDbMock(rowById: Record<string, { enabled: number }>) {
  const statement = {
    run: vi.fn(),
    get: vi.fn((id: string) => rowById[id]),
    all: vi.fn(),
  };
  const db = {
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
  return { db, statement };
}

describe("resolveBuiltinSkillEnabled", () => {
  it("uses the curated default when the user never touched the skill", () => {
    expect(resolveBuiltinSkillEnabled("ponytail", undefined)).toBe(false);
    expect(resolveBuiltinSkillEnabled("officecli", undefined)).toBe(true);
  });

  it("lets a stored row win in both directions", () => {
    // 用户在技能页里打开过默认禁用的技能，或关掉过默认启用的技能。
    expect(resolveBuiltinSkillEnabled("ponytail", true)).toBe(true);
    expect(resolveBuiltinSkillEnabled("officecli", false)).toBe(false);
  });

  it("keeps the list lowercase and de-duplicated", () => {
    for (const name of DEFAULT_DISABLED_BUILTINS) {
      expect(name).toBe(name.toLowerCase());
    }
    expect(new Set(DEFAULT_DISABLED_BUILTINS).size).toBe(
      DEFAULT_DISABLED_BUILTINS.size,
    );
  });
});

describe("SkillsManager builtin defaults", () => {
  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "deskwand-builtin-"));
  });

  afterEach(() => {
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  it("disables the curated list and enables the rest on a fresh install", () => {
    const { db } = createDbMock({});
    const manager = new SkillsManager(db);
    const byId = new Map(manager.getAllSkills().map((s) => [s.id, s]));

    expect(byId.get("builtin-officecli")?.enabled).toBe(true);
    expect(byId.get("builtin-ponytail")?.enabled).toBe(false);
  });

  it("honours a stored row from the skill page", () => {
    const { db } = createDbMock({
      "builtin-ponytail": { enabled: 1 },
      "builtin-officecli": { enabled: 0 },
    });
    const manager = new SkillsManager(db);
    const byId = new Map(manager.getAllSkills().map((s) => [s.id, s]));

    expect(byId.get("builtin-ponytail")?.enabled).toBe(true);
    expect(byId.get("builtin-officecli")?.enabled).toBe(false);
  });

  it("does not write rows while loading", () => {
    // 「行存在 = 用户选过」这条不变式靠它守住。
    const { db, statement } = createDbMock({});
    new SkillsManager(db);
    expect(statement.run).not.toHaveBeenCalled();
  });
});
