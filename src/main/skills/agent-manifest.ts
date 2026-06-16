/**
 * @module main/skills/agent-manifest
 *
 * Manages .agent-manifest.json in the global skills directory.
 * Tracks which skills were created by the agent, preventing the agent
 * from modifying user-created or built-in skills.
 *
 * Analogous to Hermes Agent's `.bundled_manifest` + `skill_usage.is_agent_created()`.
 */

import * as fs from "fs";
import * as path from "path";
import { log, logWarn } from "../utils/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentManifestEntry {
  source: "agent";
  createdAt: number;
  hash: string; // MD5 of SKILL.md content at creation time
}

export type AgentManifest = Record<string, AgentManifestEntry>;

// ---------------------------------------------------------------------------
// File path
// ---------------------------------------------------------------------------

function manifestPath(globalSkillsPath: string): string {
  return path.join(globalSkillsPath, ".agent-manifest.json");
}

// ---------------------------------------------------------------------------
// Read / write
// ---------------------------------------------------------------------------

export function readManifest(globalSkillsPath: string): AgentManifest {
  const fp = manifestPath(globalSkillsPath);
  try {
    if (!fs.existsSync(fp)) return {};
    const raw = fs.readFileSync(fp, "utf-8");
    return JSON.parse(raw) as AgentManifest;
  } catch (err) {
    logWarn(
      "[AgentManifest] Failed to read .agent-manifest.json, treating as empty:",
      err,
    );
    return {};
  }
}

function writeManifest(
  globalSkillsPath: string,
  manifest: AgentManifest,
): void {
  const fp = manifestPath(globalSkillsPath);
  const tmp = fp + ".tmp";
  try {
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2), "utf-8");
    fs.renameSync(tmp, fp);
  } catch (err) {
    logWarn("[AgentManifest] Failed to write .agent-manifest.json:", err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute a simple hash of content for manifest tracking.
 */
export function hashContent(content: string): string {
  // Simple DJB2-like hash — fast, no crypto dependency needed
  let hash = 5381;
  for (let i = 0; i < content.length; i++) {
    hash = ((hash << 5) + hash + content.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(16);
}

/**
 * Register a skill as agent-created.
 */
export function addManifestEntry(
  globalSkillsPath: string,
  skillName: string,
  content: string,
): void {
  const manifest = readManifest(globalSkillsPath);
  manifest[skillName] = {
    source: "agent",
    createdAt: Date.now(),
    hash: hashContent(content),
  };
  writeManifest(globalSkillsPath, manifest);
  log(`[AgentManifest] Registered agent-created skill: ${skillName}`);
}

/**
 * Remove a skill from the manifest (e.g. when user manually deletes it).
 */
export function removeManifestEntry(
  globalSkillsPath: string,
  skillName: string,
): void {
  const manifest = readManifest(globalSkillsPath);
  if (!manifest[skillName]) return;
  delete manifest[skillName];
  writeManifest(globalSkillsPath, manifest);
  log(`[AgentManifest] Removed skill from manifest: ${skillName}`);
}

/**
 * Check whether a skill was created by the agent.
 */
export function isAgentCreated(
  globalSkillsPath: string,
  skillName: string,
): boolean {
  const manifest = readManifest(globalSkillsPath);
  return manifest[skillName]?.source === "agent";
}

/**
 * Get all agent-created skill names.
 */
export function getAgentCreatedSkillNames(globalSkillsPath: string): string[] {
  const manifest = readManifest(globalSkillsPath);
  return Object.keys(manifest).filter((k) => manifest[k].source === "agent");
}

/**
 * Update the hash for an existing agent-created skill after modification.
 */
export function updateManifestHash(
  globalSkillsPath: string,
  skillName: string,
  newContent: string,
): void {
  const manifest = readManifest(globalSkillsPath);
  if (manifest[skillName]?.source === "agent") {
    manifest[skillName].hash = hashContent(newContent);
    writeManifest(globalSkillsPath, manifest);
  }
}
