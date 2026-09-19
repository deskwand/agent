import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  cleanupRetiredSkillLinks,
  RETIRED_SKILL_NAMES,
} from "../../main/skills/retired-skills";
import { RETIRED_SKILL_MANIFESTS } from "../../main/skills/retired-skill-manifests";

function supportsDirectorySymlinks(): boolean {
  const probeDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "cowork-symlink-probe-"),
  );
  try {
    fs.mkdirSync(path.join(probeDir, "target"));
    fs.symlinkSync(
      path.join(probeDir, "target"),
      path.join(probeDir, "link"),
      "dir",
    );
    return true;
  } catch {
    return false;
  } finally {
    fs.rmSync(probeDir, { recursive: true, force: true });
  }
}

const itIfSymlinks = supportsDirectorySymlinks() ? it : it.skip;

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

describe("cleanupRetiredSkillLinks", () => {
  let root: string;
  let skillsDir: string;
  let builtinDir: string;

  // A tiny synthetic manifest: the logic only cares about path/hash agreement,
  // and a small tree keeps these tests readable. A separate case below checks
  // the real generated manifest against real shipped bytes.
  const MANIFESTS = {
    docx: {
      "LICENSE.txt": sha256("licence"),
      "SKILL.md": sha256("skill"),
      "scripts/run.py": sha256("script"),
    },
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "retired-skills-test-"));
    skillsDir = path.join(root, "skills");
    builtinDir = path.join(root, "builtin");
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.mkdirSync(builtinDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const opts = (overrides: Record<string, unknown> = {}) => ({
    skillsDir,
    builtinSkillsDir: builtinDir,
    retiredNames: ["docx"],
    manifests: MANIFESTS,
    ...overrides,
  });

  /** Writes the exact tree described by MANIFESTS.docx. */
  const placeShippedCopy = (): string => {
    const dir = path.join(skillsDir, "docx");
    fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(dir, "LICENSE.txt"), "licence");
    fs.writeFileSync(path.join(dir, "SKILL.md"), "skill");
    fs.writeFileSync(path.join(dir, "scripts/run.py"), "script");
    return dir;
  };

  it("ignores names that are not present", () => {
    expect(cleanupRetiredSkillLinks(opts())).toEqual({ removed: [], kept: [] });
  });

  // --- symlinks (macOS / Linux packaged layout) -----------------------------

  itIfSymlinks("removes a dangling symlink", () => {
    const link = path.join(skillsDir, "docx");
    fs.symlinkSync(path.join(root, "gone"), link, "dir");

    const report = cleanupRetiredSkillLinks(opts());

    expect(report.removed).toEqual([link]);
    expect(fs.existsSync(link)).toBe(false);
  });

  itIfSymlinks(
    "removes a symlink pointing into the built-in skills dir",
    () => {
      const target = path.join(builtinDir, "docx");
      fs.mkdirSync(target);
      const link = path.join(skillsDir, "docx");
      fs.symlinkSync(target, link, "dir");

      const report = cleanupRetiredSkillLinks(opts());

      expect(report.removed).toEqual([link]);
      expect(fs.existsSync(link)).toBe(false);
    },
  );

  itIfSymlinks("keeps a symlink the user pointed somewhere else", () => {
    const outside = path.join(root, "my-own-docx");
    fs.mkdirSync(outside);
    const link = path.join(skillsDir, "docx");
    fs.symlinkSync(outside, link, "dir");

    const report = cleanupRetiredSkillLinks(opts());

    expect(report.removed).toEqual([]);
    expect(report.kept).toEqual([link]);
    expect(fs.existsSync(link)).toBe(true);
  });

  // --- real directory copies (Windows, and asar-archived sources) -----------

  it("removes an untouched copy the app installed", () => {
    const dir = placeShippedCopy();

    const report = cleanupRetiredSkillLinks(opts());

    expect(report.removed).toEqual([dir]);
    expect(fs.existsSync(dir)).toBe(false);
  });

  it("keeps a copy whose SKILL.md the user edited", () => {
    const dir = placeShippedCopy();
    fs.writeFileSync(path.join(dir, "SKILL.md"), "my customised docx skill");

    const report = cleanupRetiredSkillLinks(opts());

    expect(report.removed).toEqual([]);
    expect(report.kept).toEqual([dir]);
    expect(fs.readFileSync(path.join(dir, "SKILL.md"), "utf8")).toBe(
      "my customised docx skill",
    );
  });

  it("keeps a copy whose script the user edited", () => {
    const dir = placeShippedCopy();
    fs.writeFileSync(path.join(dir, "scripts/run.py"), "print('patched')");

    const report = cleanupRetiredSkillLinks(opts());

    expect(report.kept).toEqual([dir]);
    expect(fs.readFileSync(path.join(dir, "scripts/run.py"), "utf8")).toBe(
      "print('patched')",
    );
  });

  it("keeps a copy the user added a file to", () => {
    const dir = placeShippedCopy();
    fs.writeFileSync(path.join(dir, "NOTES.md"), "my notes about this skill");

    const report = cleanupRetiredSkillLinks(opts());

    expect(report.removed).toEqual([]);
    expect(report.kept).toEqual([dir]);
    expect(fs.existsSync(path.join(dir, "NOTES.md"))).toBe(true);
  });

  it("keeps a copy the user added a nested file to", () => {
    const dir = placeShippedCopy();
    fs.writeFileSync(path.join(dir, "scripts/extra.py"), "print('mine')");

    const report = cleanupRetiredSkillLinks(opts());

    expect(report.kept).toEqual([dir]);
    expect(fs.existsSync(path.join(dir, "scripts/extra.py"))).toBe(true);
  });

  it("keeps a copy with a shipped file removed", () => {
    const dir = placeShippedCopy();
    fs.rmSync(path.join(dir, "scripts/run.py"));

    const report = cleanupRetiredSkillLinks(opts());

    expect(report.kept).toEqual([dir]);
    expect(fs.existsSync(dir)).toBe(true);
  });

  it("keeps a real directory the user created", () => {
    const dir = path.join(skillsDir, "docx");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "SKILL.md"), "my own docx skill");

    const report = cleanupRetiredSkillLinks(opts());

    expect(report.removed).toEqual([]);
    expect(report.kept).toEqual([dir]);
  });

  it("keeps a name that has no manifest entry at all", () => {
    const dir = placeShippedCopy();

    const report = cleanupRetiredSkillLinks(
      opts({ retiredNames: ["docx"], manifests: {} }),
    );

    expect(report.kept).toEqual([dir]);
  });

  it("is idempotent", () => {
    placeShippedCopy();

    expect(cleanupRetiredSkillLinks(opts()).removed).toHaveLength(1);
    expect(cleanupRetiredSkillLinks(opts())).toEqual({ removed: [], kept: [] });
  });
});

describe("RETIRED_SKILL_MANIFESTS", () => {
  it("covers every retired skill", () => {
    for (const name of RETIRED_SKILL_NAMES) {
      expect(
        Object.keys(RETIRED_SKILL_MANIFESTS[name] ?? {}).length,
      ).toBeGreaterThan(0);
    }
  });

  it("records the real hashes of the shipped files", () => {
    // Guards against a bad regeneration: compare two entries against the actual
    // bytes of the released skills (fixtures taken from git history).
    const license = fs.readFileSync(
      path.join(__dirname, "fixtures", "anthropic-skill-LICENSE.txt"),
    );
    expect(RETIRED_SKILL_MANIFESTS.docx["LICENSE.txt"]).toBe(
      crypto.createHash("sha256").update(license).digest("hex"),
    );
    expect(RETIRED_SKILL_MANIFESTS.pptx["LICENSE.txt"]).toBe(
      crypto.createHash("sha256").update(license).digest("hex"),
    );
  });
});
