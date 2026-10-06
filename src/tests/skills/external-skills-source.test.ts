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

import { SkillsManager } from "../../main/skills/skills-manager";
import type { DatabaseInstance } from "../../main/db/database";

interface Row {
  id: string;
  enabled: number;
}

/** `all()` 服务预载查询；`get()` 服务逐行查询。 */
function createDbMock(rows: Row[] = []) {
  const statement = {
    run: vi.fn(),
    get: vi.fn((id: string) => rows.find((r) => r.id === id)),
    all: vi.fn(() => rows),
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

const record = (name: string) => ({
  name,
  description: `${name} desc`,
  filePath: `/home/u/.pi/agent/skills/${name}/SKILL.md`,
});

describe("SkillsManager 的第三方技能来源", () => {
  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "deskwand-external-"));
  });

  afterEach(() => {
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  it("默认全部禁用：没有 external- 行时一个都不启用", () => {
    const { db } = createDbMock([]);
    const manager = new SkillsManager(db);
    manager.recordExternalSkills([
      record("writing-plans"),
      record("weather-lookup"),
    ]);

    const policy = manager.getSkillPolicy();
    expect(policy.isExternalSkillEnabled("writing-plans")).toBe(false);
    expect(policy.enabledExternalSkillNames()).toEqual([]);
  });

  it("有 enabled=1 的行时启用，并进入签名用的名字列表", () => {
    const { db } = createDbMock([
      { id: "external-deskwand-release", enabled: 1 },
    ]);
    const manager = new SkillsManager(db);
    manager.recordExternalSkills([record("deskwand-release")]);

    const policy = manager.getSkillPolicy();
    expect(policy.isExternalSkillEnabled("deskwand-release")).toBe(true);
    expect(policy.enabledExternalSkillNames()).toEqual(["deskwand-release"]);
  });

  it("上报的第三方技能出现在 listSkills 里，但不进产品技能路径", async () => {
    const { db } = createDbMock([]);
    const manager = new SkillsManager(db);
    manager.recordExternalSkills([record("writing-plans")]);

    const listed = await manager.listSkills({ type: "external" });
    expect(listed.map((s) => s.id)).toEqual(["external-writing-plans"]);
    expect(listed[0].enabled).toBe(false);

    // 第三方技能不参与「交给 pi 的目录列表」——pi 自己能发现它们。
    const paths = await manager.getSkillPaths();
    expect(paths.some((p) => p.includes(".pi/agent/skills"))).toBe(false);
  });

  it("策略读实时状态：同一个策略对象要反映后续的开关", () => {
    // 策略对象会被 PiExtensionHost 按 cwd 缓存（构造参数只在首次生效），
    // 所以快照式的实现会把产品技能的开关冻住——这条就是钉它的。
    const { db } = createDbMock([]);
    const manager = new SkillsManager(db);
    const policy = manager.getSkillPolicy();
    expect(policy.isProductSkillEnabled("officecli")).toBe(true);

    manager.setSkillEnabled("builtin-officecli", false);
    expect(policy.isProductSkillEnabled("officecli")).toBe(false);

    manager.setSkillEnabled("builtin-ponytail", true);
    expect(policy.isProductSkillEnabled("ponytail")).toBe(true);
  });

  it("上报即替换：目录消失后列表跟着收缩", () => {
    const { db } = createDbMock([]);
    const manager = new SkillsManager(db);
    manager.recordExternalSkills([
      record("writing-plans"),
      record("old-skill"),
    ]);
    expect(manager.getExternalSkills()).toHaveLength(2);

    manager.recordExternalSkills([record("writing-plans")]);
    expect(manager.getExternalSkills().map((s) => s.name)).toEqual([
      "writing-plans",
    ]);
  });

  it("开关写入 DB 行并立即反映到策略里", () => {
    const { db, statement } = createDbMock([]);
    const manager = new SkillsManager(db);
    manager.recordExternalSkills([record("writing-plans")]);

    manager.setSkillEnabled("external-writing-plans", true);
    expect(
      manager.getSkillPolicy().isExternalSkillEnabled("writing-plans"),
    ).toBe(true);
    expect(statement.run).toHaveBeenCalled();

    manager.setSkillEnabled("external-writing-plans", false);
    expect(
      manager.getSkillPolicy().isExternalSkillEnabled("writing-plans"),
    ).toBe(false);
  });
});
