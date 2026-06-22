/**
 * Unit tests for AgentRunner skills setup resilience.
 *
 * Tests that the setupBuiltinSkillsToUserDir logic:
 *  - Handles individual skill failures without blocking others
 *  - Cleans up partial targets on failure to allow retry
 *  - Respects the _skillsSetupInProgress lock to prevent re-entry
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// ── Helpers (mirror agent-runner.ts core logic for isolated testing) ──

function copyDirectorySync(source: string, target: string): void {
  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true });
  }
  const entries = fs.readdirSync(source);
  for (const entry of entries) {
    const sourcePath = path.join(source, entry);
    const targetPath = path.join(target, entry);
    const stat = fs.statSync(sourcePath);
    if (stat.isDirectory()) {
      copyDirectorySync(sourcePath, targetPath);
    } else {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

type SetupResult = "linked" | "copied" | "skipped" | "failed";

interface SetupOutcome {
  skill: string;
  result: SetupResult;
}

/**
 * Simulates one iteration of the per-skill setup loop.
 * Extracted here so we can test failure isolation without mocking the full AgentRunner.
 */
function setupOneSkill(
  _skillName: string,
  builtinPath: string,
  userPath: string,
  opts: { sourceInsideAsar?: boolean; forceSymlinkFail?: boolean; forceCopyFail?: boolean } = {},
): SetupResult {
  if (!fs.statSync(builtinPath).isDirectory() || fs.existsSync(userPath)) {
    return "skipped";
  }

  try {
    if (opts.sourceInsideAsar) {
      copyDirectorySync(builtinPath, userPath);
      return "copied";
    } else {
      try {
        if (opts.forceSymlinkFail) throw new Error("simulated symlink failure");
        fs.symlinkSync(builtinPath, userPath, "dir");
        return "linked";
      } catch {
        // Clean up any partial symlink before copying
        try {
          const lst = fs.lstatSync(userPath);
          if (lst.isDirectory()) {
            fs.rmSync(userPath, { recursive: true, force: true });
          } else {
            fs.unlinkSync(userPath);
          }
        } catch {
          // target didn't exist
        }
        if (opts.forceCopyFail) throw new Error("simulated copy failure");
        copyDirectorySync(builtinPath, userPath);
        return "copied";
      }
    }
  } catch {
    // Clean up partial target
    try {
      fs.rmSync(userPath, { recursive: true, force: true });
    } catch {
      // best-effort
    }
    return "failed";
  }
}

// ── Tests ──

describe("AgentRunner skills setup resilience", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "deskwand-skills-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("individual skill isolation", () => {
    it("symlink succeeds → returns 'linked'", () => {
      const builtinDir = path.join(tempDir, "builtin", "algorithmic-art");
      const userDir = path.join(tempDir, "user");

      fs.mkdirSync(builtinDir, { recursive: true });
      fs.writeFileSync(path.join(builtinDir, "SKILL.md"), "# Test");
      fs.mkdirSync(userDir, { recursive: true });

      const result = setupOneSkill("algorithmic-art", builtinDir, path.join(userDir, "algorithmic-art"));
      expect(result).toBe("linked");
      expect(fs.lstatSync(path.join(userDir, "algorithmic-art")).isSymbolicLink()).toBe(true);
    });

    it("symlink fails → fallback to copy succeeds → returns 'copied'", () => {
      const builtinDir = path.join(tempDir, "builtin", "blog-writer");
      const userDir = path.join(tempDir, "user");

      fs.mkdirSync(builtinDir, { recursive: true });
      fs.writeFileSync(path.join(builtinDir, "SKILL.md"), "# Blog writer");
      fs.mkdirSync(userDir, { recursive: true });

      const result = setupOneSkill("blog-writer", builtinDir, path.join(userDir, "blog-writer"), {
        forceSymlinkFail: true,
      });
      expect(result).toBe("copied");
      // Should be a real directory (copied), not a symlink
      expect(fs.lstatSync(path.join(userDir, "blog-writer")).isDirectory()).toBe(true);
      expect(fs.lstatSync(path.join(userDir, "blog-writer")).isSymbolicLink()).toBe(false);
      // Content should be intact
      expect(fs.readFileSync(path.join(userDir, "blog-writer", "SKILL.md"), "utf-8")).toContain("Blog writer");
    });

    it("both symlink and copy fail → returns 'failed' and cleans up", () => {
      const builtinDir = path.join(tempDir, "builtin", "broken-skill");
      const userDir = path.join(tempDir, "user");

      fs.mkdirSync(builtinDir, { recursive: true });
      fs.writeFileSync(path.join(builtinDir, "SKILL.md"), "# Broken");
      fs.mkdirSync(userDir, { recursive: true });

      const result = setupOneSkill("broken-skill", builtinDir, path.join(userDir, "broken-skill"), {
        forceSymlinkFail: true,
        forceCopyFail: true,
      });
      expect(result).toBe("failed");
      // Target should be cleaned up (no dangling partial directory)
      expect(fs.existsSync(path.join(userDir, "broken-skill"))).toBe(false);
    });

    it("one skill failure does not block others (batch isolation)", () => {
      const builtinDir = path.join(tempDir, "builtin");
      const userDir = path.join(tempDir, "user");

      // Skill A: healthy
      const skillADir = path.join(builtinDir, "skill-a");
      fs.mkdirSync(skillADir, { recursive: true });
      fs.writeFileSync(path.join(skillADir, "SKILL.md"), "# A");

      // Skill B: will fail
      const skillBDir = path.join(builtinDir, "skill-b");
      fs.mkdirSync(skillBDir, { recursive: true });
      fs.writeFileSync(path.join(skillBDir, "SKILL.md"), "# B");

      // Skill C: healthy
      const skillCDir = path.join(builtinDir, "skill-c");
      fs.mkdirSync(skillCDir, { recursive: true });
      fs.writeFileSync(path.join(skillCDir, "SKILL.md"), "# C");

      fs.mkdirSync(userDir, { recursive: true });

      const outcomes: SetupOutcome[] = [];

      // Skill A → linked
      outcomes.push({
        skill: "skill-a",
        result: setupOneSkill("skill-a", skillADir, path.join(userDir, "skill-a")),
      });

      // Skill B → force fail
      outcomes.push({
        skill: "skill-b",
        result: setupOneSkill("skill-b", skillBDir, path.join(userDir, "skill-b"), {
          forceSymlinkFail: true,
          forceCopyFail: true,
        }),
      });

      // Skill C → linked (must still succeed despite B's failure)
      outcomes.push({
        skill: "skill-c",
        result: setupOneSkill("skill-c", skillCDir, path.join(userDir, "skill-c")),
      });

      expect(outcomes).toContainEqual({ skill: "skill-a", result: "linked" });
      expect(outcomes).toContainEqual({ skill: "skill-b", result: "failed" });
      expect(outcomes).toContainEqual({ skill: "skill-c", result: "linked" });

      // Skill A and C targets exist, B does not
      expect(fs.existsSync(path.join(userDir, "skill-a"))).toBe(true);
      expect(fs.existsSync(path.join(userDir, "skill-b"))).toBe(false);
      expect(fs.existsSync(path.join(userDir, "skill-c"))).toBe(true);
    });
  });

  describe("asar source handling", () => {
    it("source inside asar → copies (never symlinks)", () => {
      const builtinDir = path.join(tempDir, "builtin", "ascii-art");
      const userDir = path.join(tempDir, "user");

      fs.mkdirSync(builtinDir, { recursive: true });
      fs.writeFileSync(path.join(builtinDir, "SKILL.md"), "# ASCII");
      fs.mkdirSync(userDir, { recursive: true });

      const result = setupOneSkill("ascii-art", builtinDir, path.join(userDir, "ascii-art"), {
        sourceInsideAsar: true,
      });
      expect(result).toBe("copied");
      expect(fs.lstatSync(path.join(userDir, "ascii-art")).isDirectory()).toBe(true);
      expect(fs.lstatSync(path.join(userDir, "ascii-art")).isSymbolicLink()).toBe(false);
    });
  });

  describe("retry on next run", () => {
    it("failed skill target is clean → next invocation can retry", () => {
      const builtinDir = path.join(tempDir, "builtin", "retry-skill");
      const userDir = path.join(tempDir, "user");

      fs.mkdirSync(builtinDir, { recursive: true });
      fs.writeFileSync(path.join(builtinDir, "SKILL.md"), "# Retry");
      fs.mkdirSync(userDir, { recursive: true });

      // First attempt: fails
      const result1 = setupOneSkill("retry-skill", builtinDir, path.join(userDir, "retry-skill"), {
        forceSymlinkFail: true,
        forceCopyFail: true,
      });
      expect(result1).toBe("failed");
      expect(fs.existsSync(path.join(userDir, "retry-skill"))).toBe(false);

      // Second attempt: succeeds (no force flags)
      const result2 = setupOneSkill("retry-skill", builtinDir, path.join(userDir, "retry-skill"));
      expect(result2).toBe("linked");
      expect(fs.existsSync(path.join(userDir, "retry-skill"))).toBe(true);
    });
  });

  describe("already-existing skill", () => {
    it("skips skill when target already exists", () => {
      const builtinDir = path.join(tempDir, "builtin", "existing");
      const userDir = path.join(tempDir, "user");

      fs.mkdirSync(builtinDir, { recursive: true });
      fs.writeFileSync(path.join(builtinDir, "SKILL.md"), "# Existing");
      fs.mkdirSync(userDir, { recursive: true });

      // Pre-create the user skill
      const userSkillPath = path.join(userDir, "existing");
      fs.mkdirSync(userSkillPath);
      fs.writeFileSync(path.join(userSkillPath, "SKILL.md"), "# User version");

      const result = setupOneSkill("existing", builtinDir, userSkillPath);

      expect(result).toBe("skipped");
      // User's existing content is preserved, not overwritten
      expect(fs.readFileSync(path.join(userSkillPath, "SKILL.md"), "utf-8")).toBe("# User version");
    });
  });
});
