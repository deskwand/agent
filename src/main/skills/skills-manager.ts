/**
 * @module main/skills/skills-manager
 *
 * Skill discovery and lifecycle (999 lines).
 *
 * Responsibilities:
 * - Discovers built-in skills from .deskwand/skills/ directories
 * - Parses SKILL.md front-matter for metadata (name, description, triggers)
 * - Plugin install/uninstall from npm-style package specs
 *
 * Dependencies: database
 */
import * as fs from "fs";
import * as path from "path";
import { app } from "electron";
import { parse as parseYaml } from "yaml";
import type { Skill, PluginInstallResult } from "../../renderer/types";
import type { DatabaseInstance } from "../db/database";
import { log, logError, logWarn } from "../utils/logger";
import { isPathWithinRoot } from "../tools/path-containment";
import { isAgentCreated, removeManifestEntry } from "./agent-manifest";

/**
 * Validate that a skill name is safe for use as a directory name.
 * Rejects names containing path separators or parent directory references.
 */
function validateSkillName(name: string): void {
  if (!name || /[/\\]|\.\./.test(name)) {
    throw new Error(`Invalid skill name: ${name}`);
  }
}

/**
 * Check if a path is a dangling symlink (symlink whose target no longer exists).
 */
function isDanglingSymlink(filePath: string): boolean {
  try {
    const lstat = fs.lstatSync(filePath);
    if (!lstat.isSymbolicLink()) return false;
    // Symlink exists — check if the target is reachable
    try {
      fs.statSync(filePath);
      return false; // target exists, not dangling
    } catch {
      return true; // target unreachable
    }
  } catch {
    return false; // path itself doesn't exist
  }
}

/**
 * Check if a directory name should be skipped during skill loading.
 * Skips hidden dirs (dot-prefixed like .archive, .backup, .git) and
 * archive directories.
 */
function isHiddenOrArchiveDir(dirName: string): boolean {
  return dirName.startsWith(".");
}

interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface SkillConfig {
  name: string;
  description?: string;
  type: "mcp" | "custom";
  mcp?: McpServerConfig;
  enabled?: boolean;
}

interface PluginManifest {
  name?: string;
  description?: string;
  version?: string;
}

interface SkillsManagerOptions {
  // reserved for future use
}

/**
 * SkillsManager - Manages skill loading and MCP server lifecycle
 *
 * Skills loading priority:
 * 1. Project-level: <project>/.skills/ or <project>/skills/
 * 2. Global: <userData>/skills/ (includes ~/.deskwand/skills read-only)
 * 3. Built-in skills
 */
export class SkillsManager {
  private db: DatabaseInstance;
  private loadedSkills: Map<string, Skill> = new Map();
  private runningServers: Map<string, { process: unknown; skill: Skill }> =
    new Map();
  private _globalInitialized = false;

  constructor(db: DatabaseInstance, _options: SkillsManagerOptions = {}) {
    this.db = db;
    this.loadBuiltinSkills();
  }

  /**
   * Load built-in skills
   */
  private loadBuiltinSkills(): void {
    // Load skills from .deskwand/skills directory (like pdf, xlsx, docx, pptx)
    const builtinSkillsPath = this.getBuiltinSkillsPath();
    if (builtinSkillsPath) {
      try {
        const skillDirs = fs.readdirSync(builtinSkillsPath);

        for (const dir of skillDirs) {
          const skillPath = path.join(builtinSkillsPath, dir);

          if (isDanglingSymlink(skillPath)) {
            logWarn(
              `[Skills] Skipping dangling symlink in built-in skills: ${skillPath}`,
            );
            continue;
          }

          let stat: fs.Stats;
          try {
            stat = fs.statSync(skillPath);
          } catch {
            continue;
          }

          if (!stat.isDirectory()) continue;

          // Skip hidden/archive directories
          if (isHiddenOrArchiveDir(dir)) continue;

          // Look for SKILL.md
          const skillMdPath = path.join(skillPath, "SKILL.md");
          if (!fs.existsSync(skillMdPath)) continue;

          // Parse metadata
          const metadata = this.getSkillMetadata(skillPath);
          if (!metadata) continue;

          const skill: Skill = {
            id: `builtin-${dir}`,
            name: metadata.name,
            description: metadata.description,
            type: "builtin",
            enabled: true,
            createdAt: Date.now(),
          };

          this.loadedSkills.set(skill.id, skill);
          log(`Loaded built-in skill: ${skill.name}`);
        }
      } catch (error) {
        logError("Failed to load built-in skills from .deskwand/skills:", error);
      }
    }
  }

  /**
   * Get the built-in skills directory path
   */
  private getBuiltinSkillsPath(): string {
    const appPath = app.getAppPath();
    const unpackedPath = appPath.replace(/\.asar$/, ".asar.unpacked");

    const possiblePaths = [
      // Development
      path.join(__dirname, "..", "..", "..", ".deskwand", "skills"),
      // Production: extraResources extracts .deskwand/skills → resources/skills
      path.join(process.resourcesPath || "", "skills"),
      // Legacy: in app.asar.unpacked (for older builds with asarUnpack)
      ...(this.physicalDirExists(path.join(unpackedPath, ".deskwand", "skills"))
        ? [path.join(unpackedPath, ".deskwand", "skills")]
        : []),
      // Last resort: read from inside the asar archive (Electron intercepts this)
      path.join(appPath, ".deskwand", "skills"),
    ];

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        return p;
      }
    }

    return "";
  }

  /**
   * Check if a directory physically exists on disk, bypassing Electron's
   * asar interception. Uses try/catch with lstatSync on the real filesystem.
   */
  private physicalDirExists(dirPath: string): boolean {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const originalFs = require("original-fs") as typeof import("fs");
      return (
        originalFs.existsSync(dirPath) &&
        originalFs.statSync(dirPath).isDirectory()
      );
    } catch {
      return false;
    }
  }

  private getDefaultGlobalSkillsPath(): string {
    return path.join(app.getPath("home"), ".deskwand", "skills");
  }

  getGlobalSkillsPath(): string {
    const skillsPath = this.getDefaultGlobalSkillsPath();
    if (!fs.existsSync(skillsPath)) {
      fs.mkdirSync(skillsPath, { recursive: true });
    }
    return skillsPath;
  }

  private clearSkillsBySource(source: "project" | "global"): void {
    const prefix = `${source}-`;
    for (const key of Array.from(this.loadedSkills.keys())) {
      if (key.startsWith(prefix)) {
        this.loadedSkills.delete(key);
      }
    }
  }

  /**
   * Remove dangling symlinks from a directory (e.g. leftover links to a
   * previous app bundle after an upgrade).
   */
  private cleanDanglingSymlinks(dir: string): void {
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return; // directory unreadable — nothing to clean
    }
    for (const entry of entries) {
      const entryPath = path.join(dir, entry);
      if (isDanglingSymlink(entryPath)) {
        try {
          fs.unlinkSync(entryPath);
          log(`[Skills] Cleaned up dangling symlink: ${entryPath}`);
        } catch (err) {
          logWarn(
            `[Skills] Could not remove dangling symlink ${entryPath}: ${err}`,
          );
        }
      }
    }
  }

  private getUserSkillsPath(): string {
    return path.join(app.getPath("home"), ".deskwand", "skills");
  }

  private async importUserSkills(globalSkillsPath: string): Promise<void> {
    const userSkillsPath = this.getUserSkillsPath();
    if (!fs.existsSync(userSkillsPath)) {
      return;
    }

    const entries = fs.readdirSync(userSkillsPath, { withFileTypes: true });
    for (const entry of entries) {
      // Dirent.isDirectory() returns false for symlinks; check symlinks separately
      const sourcePath = path.join(userSkillsPath, entry.name);
      if (entry.isSymbolicLink()) {
        if (isDanglingSymlink(sourcePath)) {
          logWarn(
            `[Skills] Skipping dangling symlink in user skills: ${sourcePath}`,
          );
          continue;
        }
        // Valid symlink — resolve to check if it's a directory
        try {
          if (!fs.statSync(sourcePath).isDirectory()) continue;
        } catch {
          continue;
        }
      } else if (!entry.isDirectory()) {
        continue;
      }

      const targetPath = path.join(globalSkillsPath, entry.name);

      // Clean up dangling symlinks at the target before re-importing
      if (isDanglingSymlink(targetPath)) {
        try {
          fs.unlinkSync(targetPath);
          logWarn(`[Skills] Removed dangling symlink at target: ${targetPath}`);
        } catch (unlinkErr) {
          logError(
            `[Skills] Failed to remove dangling symlink: ${targetPath}`,
            unlinkErr,
          );
          continue;
        }
      } else if (fs.existsSync(targetPath)) {
        continue;
      }

      try {
        fs.symlinkSync(sourcePath, targetPath, "dir");
      } catch (err) {
        try {
          await this.copyDirectory(sourcePath, targetPath);
        } catch (copyErr) {
          logError(`Failed to import user skill from ${sourcePath}:`, copyErr);
        }
      }
    }
  }

  /**
   * Load skills from a project directory
   */
  async loadProjectSkills(projectPath: string): Promise<Skill[]> {
    const skills: Skill[] = [];
    this.clearSkillsBySource("project");

    // Check for .skills/ or skills/ directory
    const skillsDirs = [
      path.join(projectPath, ".skills"),
      path.join(projectPath, "skills"),
    ];

    for (const skillsDir of skillsDirs) {
      if (fs.existsSync(skillsDir) && fs.statSync(skillsDir).isDirectory()) {
        const loadedSkills = await this.loadSkillsFromDirectory(
          skillsDir,
          "project",
        );
        skills.push(...loadedSkills);
      }
    }

    return skills;
  }

  /**
   * Load global skills from user config directory
   */
  async loadGlobalSkills(): Promise<Skill[]> {
    const globalSkillsPath = this.getGlobalSkillsPath();

    if (!fs.existsSync(globalSkillsPath)) {
      fs.mkdirSync(globalSkillsPath, { recursive: true });
    }

    // Clean + import only on first call (startup or install/uninstall paths).
    // These operations are idempotent; skip on hot-path rescans.
    if (!this._globalInitialized) {
      this.cleanDanglingSymlinks(globalSkillsPath);
      await this.importUserSkills(globalSkillsPath);
      this._globalInitialized = true;
    }

    this.clearSkillsBySource("global");
    const skills = await this.loadSkillsFromDirectory(
      globalSkillsPath,
      "global",
    );
    return skills;
  }

  /**
   * Load skills from a directory
   */
  private async loadSkillsFromDirectory(
    dir: string,
    source: "project" | "global",
  ): Promise<Skill[]> {
    const skills: Skill[] = [];

    // Prepared statement for restoring persisted enabled state (hot path —
    // hoisted outside the loop to avoid re-compiling SQL for every skill).
    const getEnabledStmt = this.db.prepare(
      "SELECT enabled FROM skills WHERE id = ?",
    );

    try {
      const entries = fs.readdirSync(dir);

      for (const entry of entries) {
        const entryPath = path.join(dir, entry);

        // Skip dangling symlinks (e.g. leftover links to a previous app bundle)
        if (isDanglingSymlink(entryPath)) {
          logWarn(`[Skills] Skipping dangling symlink: ${entryPath}`);
          continue;
        }

        let stat: fs.Stats;
        try {
          stat = fs.statSync(entryPath);
        } catch {
          continue; // skip entries that can't be stat'd
        }

        // Skip hidden/archive directories
        if (stat.isDirectory() && isHiddenOrArchiveDir(entry)) continue;

        // Check if it's a directory with SKILL.md
        if (stat.isDirectory()) {
          const skillMdPath = path.join(entryPath, "SKILL.md");
          if (fs.existsSync(skillMdPath)) {
            // Parse metadata from SKILL.md
            const metadata = this.getSkillMetadata(entryPath);
            if (!metadata) continue;

            const skillId = `${source}-${entry}`;

            // Restore persisted enabled state from DB (defaults to true for
            // newly discovered skills that haven't been saved yet)
            let persistedEnabled = true;
            try {
              const row = getEnabledStmt.get(skillId) as
                | { enabled: number }
                | undefined;
              if (row !== undefined) {
                persistedEnabled = row.enabled === 1;
              }
            } catch {
              // DB read can fail during CLI install — use default
            }

            const skill: Skill = {
              id: skillId,
              name: metadata.name,
              description: metadata.description,
              type:
                source === "global" && isAgentCreated(dir, entry)
                  ? "agent"
                  : "custom",
              enabled: persistedEnabled,
              createdAt: Date.now(),
            };

            skills.push(skill);
            this.loadedSkills.set(skill.id, skill);
          }
        }
        // Also support legacy .json config files
        else if (entry.endsWith(".json")) {
          try {
            const content = fs.readFileSync(entryPath, "utf-8");
            const config: SkillConfig = JSON.parse(content);

            if (!config.name) continue;

            const skill: Skill = {
              id: `${source}-${path.basename(entry, ".json")}`,
              name: config.name,
              description: config.description,
              type: config.type === "mcp" ? "mcp" : "custom",
              enabled: config.enabled !== false,
              config: config.mcp ? { mcp: config.mcp } : undefined,
              createdAt: Date.now(),
            };

            skills.push(skill);
            this.loadedSkills.set(skill.id, skill);
          } catch (error) {
            logError(`Failed to load skill from ${entryPath}:`, error);
          }
        }
      }
    } catch (error) {
      logError(`Failed to read skills directory ${dir}:`, error);
    }

    return skills;
  }

  /**
   * Get all active skills for a session
   */
  async getActiveSkills(
    _sessionId: string,
    projectPath?: string,
  ): Promise<Skill[]> {
    const skills: Skill[] = [];

    // 1. Add built-in skills
    for (const skill of this.loadedSkills.values()) {
      if (skill.type === "builtin" && skill.enabled) {
        skills.push(skill);
      }
    }

    // 2. Add global skills
    const globalSkills = await this.loadGlobalSkills();
    skills.push(...globalSkills.filter((s) => s.enabled));

    // 3. Add project skills (highest priority, can override)
    if (projectPath) {
      const projectSkills = await this.loadProjectSkills(projectPath);

      // Project skills can override global/builtin by name
      for (const projectSkill of projectSkills) {
        if (!projectSkill.enabled) continue;

        const existingIndex = skills.findIndex(
          (s) => s.name === projectSkill.name,
        );
        if (existingIndex >= 0) {
          skills[existingIndex] = projectSkill;
        } else {
          skills.push(projectSkill);
        }
      }
    }

    return skills;
  }

  /**
   * Start an MCP server for a skill
   */
  async startMcpServer(skill: Skill): Promise<void> {
    if (skill.type !== "mcp" || !skill.config?.mcp) {
      throw new Error("Skill is not an MCP skill");
    }

    if (this.runningServers.has(skill.id)) {
      log(`MCP server for ${skill.name} is already running`);
      return;
    }

    // TODO: Implement actual MCP server startup
    // const { spawn } = await import('child_process');
    // const mcpConfig = skill.config.mcp as McpServerConfig;
    //
    // const proc = spawn(mcpConfig.command, mcpConfig.args || [], {
    //   env: { ...process.env, ...mcpConfig.env },
    // });
    //
    // this.runningServers.set(skill.id, { process: proc, skill });

    log(`MCP server started for skill: ${skill.name}`);
  }

  /**
   * Stop an MCP server
   */
  async stopMcpServer(skillId: string): Promise<void> {
    const server = this.runningServers.get(skillId);
    if (!server) {
      return;
    }

    // TODO: Implement graceful shutdown
    // server.process.kill();

    this.runningServers.delete(skillId);
    log(`MCP server stopped for skill: ${server.skill.name}`);
  }

  /**
   * Stop all running MCP servers
   */
  async stopAllServers(): Promise<void> {
    for (const skillId of this.runningServers.keys()) {
      await this.stopMcpServer(skillId);
    }
  }

  /**
   * Enable or disable a skill
   */
  setSkillEnabled(skillId: string, enabled: boolean): void {
    const skill = this.loadedSkills.get(skillId);
    if (skill) {
      skill.enabled = enabled;

      // Persist to database so state survives reloads
      this.saveSkill(skill);

      // Stop server if disabling an MCP skill
      if (!enabled && skill.type === "mcp") {
        this.stopMcpServer(skillId);
      }
    }
  }

  /**
   * Get all loaded skills
   */
  getAllSkills(): Skill[] {
    return this.deduplicateSkills(Array.from(this.loadedSkills.values()));
  }

  /**
   * Save skill to database
   */
  saveSkill(skill: Skill): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO skills (id, name, description, type, enabled, config, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      skill.id,
      skill.name,
      skill.description || null,
      skill.type,
      skill.enabled ? 1 : 0,
      skill.config ? JSON.stringify(skill.config) : null,
      skill.createdAt,
    );
  }

  /**
   * Delete a skill
   */
  deleteSkill(skillId: string): void {
    // Can't delete built-in skills
    const skill = this.loadedSkills.get(skillId);
    if (skill?.type === "builtin") {
      throw new Error("Cannot delete built-in skills");
    }

    this.stopMcpServer(skillId);
    this.loadedSkills.delete(skillId);

    const stmt = this.db.prepare("DELETE FROM skills WHERE id = ?");
    stmt.run(skillId);
  }

  /**
   * List all skills with optional filters
   */
  async listSkills(filter?: {
    type?: "builtin" | "mcp" | "custom" | "agent";
    enabled?: boolean;
  }): Promise<Skill[]> {
    // Load global skills first to ensure they're in loadedSkills
    await this.loadGlobalSkills();

    let skills = this.deduplicateSkills(Array.from(this.loadedSkills.values()));

    if (filter) {
      if (filter.type !== undefined) {
        skills = skills.filter((s) => s.type === filter.type);
      }
      if (filter.enabled !== undefined) {
        skills = skills.filter((s) => s.enabled === filter.enabled);
      }
    }

    return skills;
  }

  /**
   * Validate skill folder structure and SKILL.md
   */
  async validateSkillFolder(
    skillPath: string,
  ): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    // Check if path exists
    if (!fs.existsSync(skillPath)) {
      return { valid: false, errors: ["Path does not exist"] };
    }

    // Check if it's a directory
    const stat = fs.statSync(skillPath);
    if (!stat.isDirectory()) {
      return { valid: false, errors: ["Path is not a directory"] };
    }

    // Check for SKILL.md
    const skillMdPath = path.join(skillPath, "SKILL.md");
    if (!fs.existsSync(skillMdPath)) {
      return { valid: false, errors: ["SKILL.md not found"] };
    }

    // Parse SKILL.md frontmatter with a proper YAML parser
    try {
      const content = fs.readFileSync(skillMdPath, "utf-8");
      const frontMatter = this.parseYamlFrontMatter(content);

      if (!frontMatter) {
        errors.push("SKILL.md has invalid or missing YAML frontmatter");
      } else {
        if (
          typeof frontMatter.name !== "string" ||
          !frontMatter.name.trim()
        ) {
          errors.push('SKILL.md missing "name" in frontmatter');
        }
        if (
          typeof frontMatter.description !== "string" ||
          !frontMatter.description.trim()
        ) {
          errors.push('SKILL.md missing "description" in frontmatter');
        }
      }
    } catch (err) {
      errors.push("Failed to parse SKILL.md");
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Get skill metadata from SKILL.md file
   */
  getSkillMetadata(
    skillPath: string,
  ): { name: string; description: string } | null {
    const skillMdPath = path.join(skillPath, "SKILL.md");

    if (!fs.existsSync(skillMdPath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(skillMdPath, "utf-8");
      const frontMatter = this.parseYamlFrontMatter(content);
      if (!frontMatter) return null;

      const name =
        typeof frontMatter.name === "string" ? frontMatter.name.trim() : "";
      const description =
        typeof frontMatter.description === "string"
          ? frontMatter.description.trim()
          : "";

      if (!name || !description) return null;
      validateSkillName(name);

      return { name, description };
    } catch (error) {
      logError(`Failed to parse SKILL.md from ${skillPath}:`, error);
      return null;
    }
  }

  /**
   * Parse YAML front-matter from SKILL.md content.
   * Uses a proper YAML parser to handle all standard YAML syntax,
   * including block scalars (|, >), quoted strings with escapes,
   * and values starting with special characters like <.
   */
  private parseYamlFrontMatter(
    content: string,
  ): Record<string, unknown> | null {
    const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fmMatch) return null;

    try {
      const parsed = parseYaml(fmMatch[1]);
      if (typeof parsed !== "object" || parsed === null) return null;
      return parsed as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  /**
   * Copy skill folder to global skills directory
   */
  private async copySkillToGlobal(
    sourcePath: string,
    skillName: string,
  ): Promise<string> {
    // Use app-specific skills directory to avoid conflicts with user settings
    const globalSkillsPath = this.getGlobalSkillsPath();

    // Ensure global skills directory exists
    if (!fs.existsSync(globalSkillsPath)) {
      fs.mkdirSync(globalSkillsPath, { recursive: true });
    }

    const targetPath = path.join(globalSkillsPath, skillName);

    // Copy directory recursively (caller should handle existing files)
    await this.copyDirectory(sourcePath, targetPath);

    log(`Copied skill from ${sourcePath} to ${targetPath}`);
    return targetPath;
  }

  /**
   * Recursively copy directory
   */
  private async copyDirectory(source: string, target: string): Promise<void> {
    // Remove dangling symlink at target before creating directory
    if (isDanglingSymlink(target)) {
      try {
        fs.unlinkSync(target);
      } catch {
        if (isDanglingSymlink(target))
          throw new Error(`Cannot remove dangling symlink: ${target}`);
      }
    }
    if (!fs.existsSync(target)) {
      fs.mkdirSync(target, { recursive: true });
    }

    const files = fs.readdirSync(source);

    for (const file of files) {
      const sourcePath = path.join(source, file);
      const targetPath = path.join(target, file);
      const lstat = fs.lstatSync(sourcePath);

      if (lstat.isSymbolicLink()) {
        // Resolve symlink and check it stays within source directory
        let realTarget: string;
        try {
          realTarget = fs.realpathSync(sourcePath);
        } catch {
          logWarn(`[Skills] Skipping unresolvable symlink: ${sourcePath}`);
          continue;
        }
        if (!isPathWithinRoot(realTarget, source)) {
          logWarn(
            `[Skills] Skipping symlink escaping source directory: ${sourcePath} -> ${realTarget}`,
          );
          continue;
        }
        // Copy the target content instead of recreating the symlink
        const realStat = fs.statSync(sourcePath);
        if (realStat.isDirectory()) {
          await this.copyDirectory(realTarget, targetPath);
        } else {
          fs.copyFileSync(sourcePath, targetPath);
        }
      } else if (lstat.isDirectory()) {
        await this.copyDirectory(sourcePath, targetPath);
      } else {
        fs.copyFileSync(sourcePath, targetPath);
      }
    }
  }

  /**
   * Install a skill from a directory
   */
  async installSkill(skillPath: string): Promise<Skill> {
    // Validate skill folder
    const validation = await this.validateSkillFolder(skillPath);
    if (!validation.valid) {
      throw new Error(`Invalid skill folder: ${validation.errors.join(", ")}`);
    }

    // Get skill metadata
    const metadata = this.getSkillMetadata(skillPath);
    if (!metadata) {
      throw new Error("Failed to read skill metadata from SKILL.md");
    }

    // Validate skill name is safe for filesystem operations
    validateSkillName(metadata.name);

    // Load global skills to check for existing
    await this.loadGlobalSkills();

    // Check if skill with same name already exists in global directory
    // Use app-specific skills directory to avoid conflicts with user settings
    const globalSkillsPath = this.getGlobalSkillsPath();
    const targetPath = path.join(globalSkillsPath, metadata.name);

    const normalizedSkillName = metadata.name.toLowerCase();
    for (const [skillId, skill] of this.loadedSkills.entries()) {
      if (skill.name.toLowerCase() === normalizedSkillName) {
        this.loadedSkills.delete(skillId);
        log(`Removing existing skill: ${skill.name} (${skillId})`);
      }
    }

    if (isDanglingSymlink(targetPath)) {
      try {
        fs.unlinkSync(targetPath);
        log(`Removed dangling symlink at: ${targetPath}`);
      } catch {
        if (isDanglingSymlink(targetPath))
          throw new Error(`Cannot remove dangling symlink: ${targetPath}`);
      }
    } else if (fs.existsSync(targetPath)) {
      // Delete existing directory
      fs.rmSync(targetPath, { recursive: true, force: true });
      log(`Deleted existing skill directory: ${targetPath}`);
    }

    // Copy skill to global directory
    await this.copySkillToGlobal(skillPath, metadata.name);

    // Reload from global directory and return canonical global skill entry.
    const globalSkills = await this.loadGlobalSkills();
    const installedSkill = globalSkills.find(
      (skill) => skill.name.toLowerCase() === normalizedSkillName,
    );

    if (!installedSkill) {
      throw new Error(
        `Installed skill not found after reload: ${metadata.name}`,
      );
    }

    // Save canonical skill entry (stable id: global-<folderName>)
    this.saveSkill(installedSkill);

    log(`Installed skill: ${installedSkill.name} (${installedSkill.id})`);
    return installedSkill;
  }

  private deduplicateSkills(skills: Skill[]): Skill[] {
    const byName = new Map<string, Skill>();

    for (const skill of skills) {
      const key = skill.name.toLowerCase();
      const existing = byName.get(key);

      if (!existing) {
        byName.set(key, skill);
        continue;
      }

      // Prefer canonical global/custom entries over transient custom entries.
      if (
        existing.id.startsWith("custom-") &&
        !skill.id.startsWith("custom-")
      ) {
        byName.set(key, skill);
      }
    }

    return Array.from(byName.values());
  }

  async validatePluginFolder(
    pluginRootPath: string,
  ): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    if (!fs.existsSync(pluginRootPath)) {
      return { valid: false, errors: ["Path does not exist"] };
    }

    const stat = fs.statSync(pluginRootPath);
    if (!stat.isDirectory()) {
      return { valid: false, errors: ["Path is not a directory"] };
    }

    const skillsRootPath = path.join(pluginRootPath, "skills");
    if (
      !fs.existsSync(skillsRootPath) ||
      !fs.statSync(skillsRootPath).isDirectory()
    ) {
      errors.push("Plugin has no installable skills");
      return { valid: false, errors };
    }

    const entries = fs.readdirSync(skillsRootPath, { withFileTypes: true });
    const hasInstallableSkill = entries.some((entry) => {
      if (!entry.isDirectory()) return false;
      const skillMdPath = path.join(skillsRootPath, entry.name, "SKILL.md");
      return fs.existsSync(skillMdPath);
    });

    if (!hasInstallableSkill) {
      errors.push("Plugin has no installable skills");
    }

    return { valid: errors.length === 0, errors };
  }

  async installPluginFromDirectory(
    pluginRootPath: string,
  ): Promise<PluginInstallResult> {
    const validation = await this.validatePluginFolder(pluginRootPath);
    if (!validation.valid) {
      throw new Error(`Invalid plugin folder: ${validation.errors.join(", ")}`);
    }

    const pluginJsonPath = path.join(
      pluginRootPath,
      ".deskwand-plugin",
      "plugin.json",
    );
    let pluginName = path.basename(pluginRootPath);
    try {
      const manifest = JSON.parse(
        fs.readFileSync(pluginJsonPath, "utf8"),
      ) as PluginManifest;
      pluginName = manifest.name?.trim() || pluginName;
    } catch {
      // ignore, fallback to directory name
    }

    const skillsRootPath = path.join(pluginRootPath, "skills");
    if (
      !fs.existsSync(skillsRootPath) ||
      !fs.statSync(skillsRootPath).isDirectory()
    ) {
      throw new Error("Plugin has no installable skills");
    }

    const entries = fs.readdirSync(skillsRootPath, { withFileTypes: true });
    const skillDirs = entries.filter((entry) => entry.isDirectory());
    if (skillDirs.length === 0) {
      throw new Error("Plugin has no installable skills");
    }

    const result: PluginInstallResult = {
      pluginName,
      installedSkills: [],
      skippedSkills: [],
      errors: [],
    };

    for (const skillDir of skillDirs) {
      const skillFolderPath = path.join(skillsRootPath, skillDir.name);
      const skillMdPath = path.join(skillFolderPath, "SKILL.md");

      if (!fs.existsSync(skillMdPath)) {
        result.skippedSkills.push(skillDir.name);
        continue;
      }

      try {
        const installedSkill = await this.installSkill(skillFolderPath);
        result.installedSkills.push(installedSkill.name);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result.errors.push(`${skillDir.name}: ${message}`);
      }
    }

    if (result.installedSkills.length === 0 && result.errors.length > 0) {
      throw new Error(
        `Failed to install plugin skills: ${result.errors.join("; ")}`,
      );
    }

    if (result.installedSkills.length === 0) {
      throw new Error("Plugin has no installable skills");
    }

    log(
      `Installed plugin skills: ${pluginName} (${result.installedSkills.length} skills)`,
    );
    return result;
  }

  /**
   * Uninstall a skill (delete from filesystem and database)
   */
  async uninstallSkill(skillId: string): Promise<void> {
    const skill = this.loadedSkills.get(skillId);

    if (!skill) {
      throw new Error("Skill not found");
    }

    // Can't delete built-in skills
    if (skill.type === "builtin") {
      throw new Error("Cannot delete built-in skills");
    }

    // Stop MCP server if running
    await this.stopMcpServer(skillId);

    // Remove from filesystem for custom / agent skills in global directory
    const isGlobalSkill = skill.type === "custom" || skill.type === "agent";
    if (isGlobalSkill) {
      // Validate skill name before using it in path construction
      validateSkillName(skill.name);

      // Use app-specific skills directory to avoid conflicts with user settings
      const globalSkillsPath = this.getGlobalSkillsPath();
      const skillDir = path.join(globalSkillsPath, skill.name);

      if (fs.existsSync(skillDir)) {
        fs.rmSync(skillDir, { recursive: true, force: true });
        log(`Deleted skill directory: ${skillDir}`);
      }

      // Clean up agent-manifest entry for agent-created skills.
      // Wrapped in try/catch — a failed manifest cleanup should not block
      // the in-memory + DB removal that follows.
      if (skill.type === "agent") {
        try {
          removeManifestEntry(globalSkillsPath, skill.name);
        } catch (err) {
          logWarn(
            `[Skills] Failed to clean manifest entry for ${skill.name}:`,
            err,
          );
        }
      }
    }

    // Remove from loaded skills
    this.loadedSkills.delete(skillId);

    // Delete from database
    const stmt = this.db.prepare("DELETE FROM skills WHERE id = ?");
    stmt.run(skillId);

    log(`Uninstalled skill: ${skill.name} (${skillId})`);
  }
}
