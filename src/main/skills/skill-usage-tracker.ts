/**
 * @module main/skills/skill-usage-tracker
 *
 * Tracks per-skill usage metadata in a sidecar JSON file
 * (~/.omagt/skills/.usage.json) keyed by skill name.
 *
 * Analogous to Hermes Agent's `tools/skill_usage.py`.
 *
 * Used by:
 *   - Curator: determine auto-transitions (stale/archived)
 *   - UI: show "last used" timestamps
 */

import * as fs from "fs";
import * as path from "path";
import { log } from "../utils/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UsageEntry {
  lastUsedAt: number;
  useCount: number;
  lastUsed: "active" | "stale" | "archived";
  /** User-pinned skills are never auto-archived by the Curator. */
  pinned?: boolean;
  /** "agent" if created by the agent, "user" if manually created. */
  createdBy?: string;
  createdAt?: number;
  archivedAt?: number;
}

export type UsageIndex = Record<string, UsageEntry>;

// ---------------------------------------------------------------------------
// File path
// ---------------------------------------------------------------------------

function usagePath(globalSkillsPath: string): string {
  return path.join(globalSkillsPath, ".usage.json");
}

// ---------------------------------------------------------------------------
// Read / write
// ---------------------------------------------------------------------------

export function readUsageIndex(globalSkillsPath: string): UsageIndex {
  const fp = usagePath(globalSkillsPath);
  try {
    if (!fs.existsSync(fp)) return {};
    const raw = fs.readFileSync(fp, "utf-8");
    return JSON.parse(raw) as UsageIndex;
  } catch {
    return {};
  }
}

function writeUsageIndex(globalSkillsPath: string, index: UsageIndex): void {
  const fp = usagePath(globalSkillsPath);
  const tmp = fp + ".tmp";
  try {
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(index, null, 2), "utf-8");
    fs.renameSync(tmp, fp);
  } catch (err) {
    // Non-critical — log and continue
    log("[UsageTracker] Failed to write usage data:", err);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Record that a skill was used. Bumps useCount and lastUsedAt.
 */
export function bumpSkillUsage(
  globalSkillsPath: string,
  skillName: string,
): void {
  const index = readUsageIndex(globalSkillsPath);
  const entry = index[skillName];
  if (entry) {
    entry.useCount += 1;
    entry.lastUsedAt = Date.now();
    if (entry.lastUsed === "stale") {
      entry.lastUsed = "active"; // reactivate
    }
  } else {
    index[skillName] = {
      lastUsedAt: Date.now(),
      useCount: 1,
      lastUsed: "active",
    };
  }
  writeUsageIndex(globalSkillsPath, index);
}

/**
 * Transition a skill's status. Used by the Curator after auto-transitions.
 */
export function setSkillStatus(
  globalSkillsPath: string,
  skillName: string,
  status: UsageEntry["lastUsed"],
): void {
  const index = readUsageIndex(globalSkillsPath);
  if (!index[skillName]) {
    index[skillName] = { lastUsedAt: 0, useCount: 0, lastUsed: status };
  } else {
    index[skillName].lastUsed = status;
  }
  writeUsageIndex(globalSkillsPath, index);
}

/**
 * Get usage stats for all tracked skills.
 */
export function getAllUsageStats(
  globalSkillsPath: string,
): Array<{ name: string } & UsageEntry> {
  const index = readUsageIndex(globalSkillsPath);
  return Object.entries(index).map(([name, entry]) => ({ name, ...entry }));
}

/**
 * Get usage entry for a single skill.
 */
export function getSkillUsage(
  globalSkillsPath: string,
  skillName: string,
): UsageEntry | null {
  const index = readUsageIndex(globalSkillsPath);
  return index[skillName] ?? null;
}
