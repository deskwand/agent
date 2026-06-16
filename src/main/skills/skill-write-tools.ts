/**
 * @module main/skills/skill-write-tools
 *
 * Agent-facing tools for creating, patching, and extending skills.
 *
 * These tools write to the global skills directory (~/.omagt/skills/) and
 * enforce strict safety boundaries:
 * - Only agent-created skills can be modified (skill_patch)
 * - All writes are atomic (tmp → rename)
 * - Path traversal is blocked (validateSkillName)
 * - Built-in skills are never touched (separate directory)
 *
 * Adapted from Hermes Agent's skill_manage tool family.
 */

import * as fs from "fs";
import * as path from "path";
import { Type } from "@sinclair/typebox";
import { log } from "../utils/logger";
import { isPathWithinRoot } from "../tools/path-containment";
import {
  isAgentCreated,
  addManifestEntry,
  updateManifestHash,
} from "./agent-manifest";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** kebab-case, 1-64 chars, no path separators or traversal */
const SKILL_NAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

function validateSkillName(name: string): void {
  if (!name || name.length > 64 || !SKILL_NAME_RE.test(name)) {
    throw new Error(
      `Invalid skill name "${name}". Must be kebab-case, 1-64 chars, lowercase alphanumeric with hyphens.`,
    );
  }
}

/**
 * Ensure the target path is within the global skills root.
 */
function ensurePathWithinRoot(
  globalSkillsPath: string,
  targetPath: string,
): void {
  if (!isPathWithinRoot(targetPath, globalSkillsPath)) {
    throw new Error(
      `Path traversal blocked: "${targetPath}" is outside skills root "${globalSkillsPath}"`,
    );
  }
}

// ---------------------------------------------------------------------------
// Atomic file write
// ---------------------------------------------------------------------------

function atomicWrite(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = filePath + ".tmp";
  fs.writeFileSync(tmp, content, "utf-8");
  fs.renameSync(tmp, filePath);
}

// ---------------------------------------------------------------------------
// SKILL.md frontmatter injection
// ---------------------------------------------------------------------------

const AGENT_SOURCE_MARKER = "\nmetadata:\n  source: agent\n";

/**
 * Ensure the SKILL.md content has the agent source marker in its YAML frontmatter.
 * If frontmatter exists but no source metadata, inject it.
 * If no frontmatter yet, prepend a minimal one.
 */
function ensureAgentSourceMarker(content: string): string {
  // Already has source: agent (any indentation)
  if (/^metadata:\s*\n(?:\s+.*\n)*\s+source:\s*agent/m.test(content)) {
    return content;
  }

  const frontmatterEnd = content.indexOf("---", 3); // skip first ---
  if (content.startsWith("---") && frontmatterEnd !== -1) {
    // Has frontmatter — inject source: agent into metadata
    const fm = content.substring(0, frontmatterEnd);
    if (fm.includes("metadata:")) {
      // Append source: agent after existing metadata fields
      const lines = content.split("\n");
      // Find the last metadata line before next top-level key
      let metadataStart = -1;
      let metadataEnd = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim() === "metadata:") {
          metadataStart = i;
        } else if (metadataStart >= 0 && /^\w[\w-]*:/.test(lines[i])) {
          metadataEnd = i;
          break;
        }
      }
      if (metadataStart >= 0) {
        if (metadataEnd < 0) metadataEnd = frontmatterEnd;
        // Already has source: agent?
        const metadataBlock = lines
          .slice(metadataStart, metadataEnd)
          .join("\n");
        if (!metadataBlock.includes("source: agent")) {
          lines.splice(metadataEnd, 0, "  source: agent");
        }
        return lines.join("\n");
      }
    }
    // No metadata block yet — add one before closing ---
    return (
      content.substring(0, frontmatterEnd) +
      AGENT_SOURCE_MARKER +
      content.substring(frontmatterEnd)
    );
  }

  // No frontmatter — prepend minimal frontmatter
  return `---${AGENT_SOURCE_MARKER}---\n\n${content}`;
}

// ---------------------------------------------------------------------------
// Section patching
// ---------------------------------------------------------------------------

/**
 * Find a Markdown heading section (## Title) in content and return its line range.
 * Returns null if not found.
 */
function findSection(
  content: string,
  sectionTitle: string,
): { start: number; end: number } | null {
  const lines = content.split("\n");
  const headingLine = lines.findIndex(
    (l) => l.trim().toLowerCase() === `## ${sectionTitle}`.toLowerCase(),
  );
  if (headingLine === -1) return null;

  // Find the end: next ## heading or end of file
  let end = lines.length;
  for (let i = headingLine + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return { start: headingLine, end };
}

function patchSection(
  content: string,
  sectionTitle: string,
  operation: "replace" | "append" | "prepend",
  newContent: string,
): string {
  const section = findSection(content, sectionTitle);
  const lines = content.split("\n");

  if (!section) {
    // Section doesn't exist — append at end
    const trimmed = content.trimEnd();
    return `${trimmed}\n\n## ${sectionTitle}\n\n${newContent}\n`;
  }

  switch (operation) {
    case "replace": {
      // Replace everything between heading (exclusive) and next ## (exclusive)
      const before = lines.slice(0, section.start + 1);
      const after = lines.slice(section.end);
      return [...before, "", newContent, ...after].join("\n");
    }
    case "append": {
      // Append after existing content, before next ##
      const before = lines.slice(0, section.end);
      const after = lines.slice(section.end);
      // Add blank line between existing section content and appended content
      const hadBlankLine =
        section.end > 0 && lines[section.end - 1]?.trim() === "";
      const separator = hadBlankLine ? "" : "\n";
      return [...before, `${separator}${newContent}`, ...after].join("\n");
    }
    case "prepend": {
      // Insert right after the heading line
      const before = lines.slice(0, section.start + 1);
      const after = lines.slice(section.start + 1);
      return [...before, "", newContent, ...after].join("\n");
    }
  }
}

// ---------------------------------------------------------------------------
// Tool builders
// ---------------------------------------------------------------------------

export interface SkillWriteToolsOptions {
  /** Root path for global skills (~/.omagt/skills/) */
  globalSkillsPath: string;
  /** Called after a skill is created/modified to trigger hot-reload */
  onSkillChanged?: () => void;
}

/**
 * Build the three skill-write ToolDefinitions:
 * - skill_create: create a new agent-owned skill
 * - skill_patch: modify an existing agent-owned skill
 * - skill_add_reference: add a reference/script/template file
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildSkillWriteTools(opts: SkillWriteToolsOptions): any[] {
  const { globalSkillsPath, onSkillChanged } = opts;

  // ── Tool 1: skill_create ──────────────────────────────────────────

  const skillCreate = {
    name: "skill_create",
    label: "Create Skill",
    description:
      "Create a new skill by writing a SKILL.md file to the global skills directory. " +
      "The skill will be marked as agent-created and can be modified later with skill_patch. " +
      "Use kebab-case for the name (lowercase letters, numbers, hyphens).",
    parameters: Type.Object({
      name: Type.String({
        description: "Skill name in kebab-case (e.g. 'my-custom-tool')",
      }),
      content: Type.String({
        description:
          "Full SKILL.md content with YAML frontmatter and Markdown body",
      }),
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async execute(
      _toolCallId: any,
      params: any,
      _signal: any,
      _onUpdate: any,
      _ctx: any,
    ) {
      const { name, content } = params as { name: string; content: string };

      // Validate
      validateSkillName(name);
      const skillDir = path.join(globalSkillsPath, name);
      const skillFile = path.join(skillDir, "SKILL.md");
      ensurePathWithinRoot(globalSkillsPath, skillFile);

      // Check for conflicts
      if (fs.existsSync(skillDir)) {
        throw new Error(
          `Skill "${name}" already exists at ${skillDir}. Use skill_patch to modify it.`,
        );
      }

      // Inject agent source marker and write
      const finalContent = ensureAgentSourceMarker(content);
      atomicWrite(skillFile, finalContent);

      // Register in manifest
      addManifestEntry(globalSkillsPath, name, finalContent);

      // Notify
      onSkillChanged?.();

      log(`[SkillWriteTools] Created skill: ${name}`);

      return {
        content: [
          {
            type: "text" as const,
            text: `Skill "${name}" created successfully at ${skillFile}.`,
          },
        ],
      };
    },
  };

  // ── Tool 2: skill_patch ───────────────────────────────────────────

  const skillPatch = {
    name: "skill_patch",
    label: "Patch Skill",
    description:
      "Update a specific section of an existing agent-created skill's SKILL.md. " +
      "Only agent-created skills can be patched (not built-in or user-created skills). " +
      "The skill is backed up before modification.",
    parameters: Type.Object({
      name: Type.String({
        description: "Name of the existing agent-created skill",
      }),
      section: Type.String({
        description:
          "Section heading to modify (e.g. 'When to use', 'Execution steps', 'Constraints')",
      }),
      operation: Type.String({
        description:
          "How to modify the section: replace (overwrite), append (add after), prepend (add before)",
      }),
      content: Type.String({
        description: "New content to write into the section",
      }),
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async execute(
      _toolCallId: any,
      params: any,
      _signal: any,
      _onUpdate: any,
      _ctx: any,
    ) {
      const {
        name,
        section,
        operation,
        content: newSectionContent,
      } = params as {
        name: string;
        section: string;
        operation: "replace" | "append" | "prepend";
        content: string;
      };

      // Validate
      validateSkillName(name);
      if (!["replace", "append", "prepend"].includes(operation)) {
        throw new Error(
          `Invalid operation "${operation}". Must be replace, append, or prepend.`,
        );
      }

      // Only agent-created skills can be patched
      if (!isAgentCreated(globalSkillsPath, name)) {
        throw new Error(
          `Skill "${name}" was not created by the agent. Only agent-created skills can be patched. ` +
            `Built-in and user-created skills are protected.`,
        );
      }

      const skillDir = path.join(globalSkillsPath, name);
      const skillFile = path.join(skillDir, "SKILL.md");
      ensurePathWithinRoot(globalSkillsPath, skillFile);

      if (!fs.existsSync(skillFile)) {
        throw new Error(`Skill "${name}" not found at ${skillFile}`);
      }

      // Read current content
      const currentContent = fs.readFileSync(skillFile, "utf-8");

      // Backup before modifying
      const backupDir = path.join(
        globalSkillsPath,
        ".archive",
        ".backup",
        name,
      );
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      fs.mkdirSync(backupDir, { recursive: true });
      fs.writeFileSync(
        path.join(backupDir, `${timestamp}.md`),
        currentContent,
        "utf-8",
      );

      // Patch
      const patchedContent = patchSection(
        currentContent,
        section,
        operation,
        newSectionContent,
      );

      // Preserve agent source marker
      const finalContent = ensureAgentSourceMarker(patchedContent);

      // Atomic write
      atomicWrite(skillFile, finalContent);

      // Update manifest hash
      updateManifestHash(globalSkillsPath, name, finalContent);

      // Notify
      onSkillChanged?.();

      log(
        `[SkillWriteTools] Patched skill "${name}", section "${section}" (${operation})`,
      );

      return {
        content: [
          {
            type: "text" as const,
            text: `Skill "${name}" updated: ${operation} in section "${section}". Backup saved to ${backupDir}.`,
          },
        ],
      };
    },
  };

  // ── Tool 3: skill_add_reference ───────────────────────────────────

  const skillAddReference = {
    name: "skill_add_reference",
    label: "Add Skill Reference",
    description:
      "Add a reference file, script, or template to an existing agent-created skill. " +
      "Use for supplementary knowledge like error code references, configuration examples, or helper scripts.",
    parameters: Type.Object({
      name: Type.String({
        description: "Name of the parent agent-created skill",
      }),
      topic: Type.String({
        description:
          "File name without extension (e.g. 'error-codes', 'config-examples')",
      }),
      content: Type.String({
        description: "File content in Markdown or appropriate format",
      }),
      directory: Type.Optional(
        Type.String({
          description:
            "Subdirectory: 'references' (default), 'scripts', or 'templates'",
        }),
      ),
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async execute(
      _toolCallId: any,
      params: any,
      _signal: any,
      _onUpdate: any,
      _ctx: any,
    ) {
      const {
        name,
        topic,
        content: refContent,
        directory,
      } = params as {
        name: string;
        topic: string;
        content: string;
        directory?: string;
      };

      // Validate
      validateSkillName(name);
      const subDir = directory || "references";
      if (!["references", "scripts", "templates"].includes(subDir)) {
        throw new Error(
          `Invalid directory "${subDir}". Must be references, scripts, or templates.`,
        );
      }

      // Only agent-created skills
      if (!isAgentCreated(globalSkillsPath, name)) {
        throw new Error(
          `Skill "${name}" was not created by the agent. References can only be added to agent-created skills.`,
        );
      }

      const skillDir = path.join(globalSkillsPath, name);
      if (!fs.existsSync(path.join(skillDir, "SKILL.md"))) {
        throw new Error(`Skill "${name}" not found at ${skillDir}`);
      }

      const refDir = path.join(skillDir, subDir);
      const refFile = path.join(refDir, `${topic}.md`);
      ensurePathWithinRoot(globalSkillsPath, refFile);

      atomicWrite(refFile, refContent);

      onSkillChanged?.();

      log(`[SkillWriteTools] Added ${subDir}/${topic}.md to skill "${name}"`);

      return {
        content: [
          {
            type: "text" as const,
            text: `Reference file created: ${refFile}.`,
          },
        ],
      };
    },
  };

  return [skillCreate, skillPatch, skillAddReference];
}
