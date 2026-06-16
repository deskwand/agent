import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  bumpSkillUsage,
  getSkillUsage,
  getAllUsageStats,
  setSkillStatus,
} from "../src/main/skills/skill-usage-tracker";

describe("skill-usage-tracker", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "omagt-usage-"));
  });

  afterEach(() => {
    if (testDir && fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("returns empty stats for unknown skills", () => {
    expect(getSkillUsage(testDir, "nonexistent")).toBeNull();
  });

  it("returns empty array when no usage tracked", () => {
    expect(getAllUsageStats(testDir)).toEqual([]);
  });

  it("bumps usage for a new skill", () => {
    bumpSkillUsage(testDir, "pdf-reader");

    const entry = getSkillUsage(testDir, "pdf-reader");
    expect(entry).not.toBeNull();
    expect(entry!.useCount).toBe(1);
    expect(entry!.lastUsed).toBe("active");
    expect(entry!.lastUsedAt).toBeGreaterThan(0);
  });

  it("increments useCount on multiple bumps", () => {
    bumpSkillUsage(testDir, "pdf-reader");
    bumpSkillUsage(testDir, "pdf-reader");
    bumpSkillUsage(testDir, "pdf-reader");

    const entry = getSkillUsage(testDir, "pdf-reader");
    expect(entry!.useCount).toBe(3);
  });

  it("reactivates stale skill on bump", () => {
    // First create and set stale
    bumpSkillUsage(testDir, "old-skill");
    setSkillStatus(testDir, "old-skill", "stale");

    // Bump again — should reactivate
    bumpSkillUsage(testDir, "old-skill");

    const entry = getSkillUsage(testDir, "old-skill");
    expect(entry!.useCount).toBe(2);
    expect(entry!.lastUsed).toBe("active");
  });

  it("sets skill status explicitly", () => {
    bumpSkillUsage(testDir, "test-skill");
    setSkillStatus(testDir, "test-skill", "archived");

    const entry = getSkillUsage(testDir, "test-skill");
    expect(entry!.lastUsed).toBe("archived");
  });

  it("setSkillStatus creates entry for unknown skill", () => {
    setSkillStatus(testDir, "new-skill", "stale");

    const entry = getSkillUsage(testDir, "new-skill");
    expect(entry).not.toBeNull();
    expect(entry!.lastUsed).toBe("stale");
    expect(entry!.useCount).toBe(0);
  });

  it("gets all usage stats sorted", () => {
    bumpSkillUsage(testDir, "skill-a");
    bumpSkillUsage(testDir, "skill-a");
    bumpSkillUsage(testDir, "skill-b");

    const all = getAllUsageStats(testDir);
    expect(all.length).toBe(2);
    expect(all[0].name).toBe("skill-a");
    expect(all[0].useCount).toBe(2);
  });
});
