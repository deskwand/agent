import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildSkillWriteTools, type SkillWriteToolsOptions } from "../src/main/skills/skill-write-tools";
import {
  addManifestEntry,
  isAgentCreated,
} from "../src/main/skills/agent-manifest";

let tmpDir = "";
let skillCreate: any;
let skillPatch: any;
let skillAddReference: any;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "omagt-skill-write-tools-test-"));
  const opts: SkillWriteToolsOptions = { globalSkillsPath: tmpDir };
  const tools = buildSkillWriteTools(opts);
  skillCreate = tools[0];
  skillPatch = tools[1];
  skillAddReference = tools[2];
});

afterEach(() => {
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// Helper: execute a tool with minimal params
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function exec(tool: any, params: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return tool.execute("test-call-id", params, undefined, undefined, { cwd: tmpDir } as any);
}

describe("skill-write-tools", () => {
  // ── skill_create ──────────────────────────────────────────────────

  describe("skill_create", () => {
    it("creates a SKILL.md with agent source marker", async () => {
      const result = await exec(skillCreate, {
        name: "my-test-skill",
        content: "---\nname: my-test-skill\ndescription: A test skill\n---\n\n## When to use\nTest things.",
      });

      expect(result.content[0].text).toContain("created successfully");
      expect(isAgentCreated(tmpDir, "my-test-skill")).toBe(true);

      const skillMd = fs.readFileSync(
        path.join(tmpDir, "my-test-skill", "SKILL.md"),
        "utf-8",
      );
      expect(skillMd).toContain("source: agent");
      expect(skillMd).toContain("## When to use");
    });

    it("rejects invalid skill names", async () => {
      await expect(
        exec(skillCreate, { name: "../escape", content: "x" }),
      ).rejects.toThrow("Invalid skill name");
      await expect(
        exec(skillCreate, { name: "a/b", content: "x" }),
      ).rejects.toThrow("Invalid skill name");
      await expect(
        exec(skillCreate, { name: "", content: "x" }),
      ).rejects.toThrow("Invalid skill name");
    });

    it("rejects duplicate skill names", async () => {
      await exec(skillCreate, {
        name: "dupe-skill",
        content: "---\nname: dupe-skill\n---\n\nok",
      });
      await expect(
        exec(skillCreate, { name: "dupe-skill", content: "x" }),
      ).rejects.toThrow("already exists");
    });

    it("injects agent source marker into content without metadata", async () => {
      await exec(skillCreate, {
        name: "bare-skill",
        content: "Just markdown, no frontmatter.",
      });
      const skillMd = fs.readFileSync(
        path.join(tmpDir, "bare-skill", "SKILL.md"),
        "utf-8",
      );
      expect(skillMd).toContain("source: agent");
    });
  });

  // ── skill_patch ───────────────────────────────────────────────────

  describe("skill_patch", () => {
    beforeEach(async () => {
      // Create an agent-owned skill to patch
      await exec(skillCreate, {
        name: "patchable-skill",
        content:
          "---\nname: patchable-skill\ndescription: For patch tests\n---\n\n## When to use\nOriginal text.\n\n## Constraints\nDon't do X.",
      });
    });

    it("replaces a section", async () => {
      const result = await exec(skillPatch, {
        name: "patchable-skill",
        section: "When to use",
        operation: "replace",
        content: "New text.",
      });
      expect(result.content[0].text).toContain("updated");

      const skillMd = fs.readFileSync(
        path.join(tmpDir, "patchable-skill", "SKILL.md"),
        "utf-8",
      );
      expect(skillMd).toContain("New text.");
      expect(skillMd).not.toContain("Original text.");
      expect(skillMd).toContain("## Constraints");
    });

    it("appends to a section", async () => {
      await exec(skillPatch, {
        name: "patchable-skill",
        section: "When to use",
        operation: "append",
        content: "Appended text.",
      });
      const skillMd = fs.readFileSync(
        path.join(tmpDir, "patchable-skill", "SKILL.md"),
        "utf-8",
      );
      expect(skillMd).toContain("Original text.");
      expect(skillMd).toContain("Appended text.");
    });

    it("creates a new section if not found (prepend)", async () => {
      await exec(skillPatch, {
        name: "patchable-skill",
        section: "New Section",
        operation: "prepend",
        content: "Brand new content.",
      });
      const skillMd = fs.readFileSync(
        path.join(tmpDir, "patchable-skill", "SKILL.md"),
        "utf-8",
      );
      expect(skillMd).toContain("## New Section");
      expect(skillMd).toContain("Brand new content.");
    });

    it("rejects patching non-agent-created skills", async () => {
      // Create a skill manually (not via skill_create, so no manifest entry)
      const manualDir = path.join(tmpDir, "manual-skill");
      fs.mkdirSync(manualDir);
      fs.writeFileSync(
        path.join(manualDir, "SKILL.md"),
        "---\nname: manual-skill\n---\n\n## When to use\nx",
      );
      await expect(
        exec(skillPatch, {
          name: "manual-skill",
          section: "When to use",
          operation: "replace",
          content: "y",
        }),
      ).rejects.toThrow("not created by the agent");
    });

    it("creates backup before patching", async () => {
      await exec(skillPatch, {
        name: "patchable-skill",
        section: "Constraints",
        operation: "replace",
        content: "Updated constraints.",
      });
      const backupDir = path.join(tmpDir, ".archive", ".backup", "patchable-skill");
      expect(fs.existsSync(backupDir)).toBe(true);
      const backups = fs.readdirSync(backupDir);
      expect(backups.length).toBe(1);
    });
  });

  // ── skill_add_reference ───────────────────────────────────────────

  describe("skill_add_reference", () => {
    beforeEach(async () => {
      await exec(skillCreate, {
        name: "ref-skill",
        content: "---\nname: ref-skill\n---\n\n## When to use\nStuff.",
      });
    });

    it("creates a reference file in the skill directory", async () => {
      const result = await exec(skillAddReference, {
        name: "ref-skill",
        topic: "error-codes",
        content: "| Code | Meaning |\n|------|--------|\n| E001 | Bad |",
      });
      expect(result.content[0].text).toContain("created");

      const refFile = path.join(tmpDir, "ref-skill", "references", "error-codes.md");
      expect(fs.existsSync(refFile)).toBe(true);
      expect(fs.readFileSync(refFile, "utf-8")).toContain("E001");
    });

    it("creates references in scripts directory", async () => {
      await exec(skillAddReference, {
        name: "ref-skill",
        topic: "helper",
        content: "#!/bin/bash\necho hi",
        directory: "scripts",
      });
      const scriptFile = path.join(tmpDir, "ref-skill", "scripts", "helper.md");
      expect(fs.existsSync(scriptFile)).toBe(true);
    });

    it("rejects non-agent-created skills", async () => {
      const manualDir = path.join(tmpDir, "manual-ref-skill");
      fs.mkdirSync(manualDir);
      fs.writeFileSync(
        path.join(manualDir, "SKILL.md"),
        "---\nname: manual-ref-skill\n---\n\nok",
      );
      await expect(
        exec(skillAddReference, {
          name: "manual-ref-skill",
          topic: "notes",
          content: "some notes",
        }),
      ).rejects.toThrow("not created by the agent");
    });

    it("rejects invalid directory values", async () => {
      await expect(
        exec(skillAddReference, {
          name: "ref-skill",
          topic: "bad",
          content: "x",
          directory: "../escape",
        }),
      ).rejects.toThrow("Invalid directory");
    });
  });
});
