/**
 * @module main/skills/curator-transitions
 *
 * Pure utility: apply automatic status transitions for agent-created skills.
 * Zero heavy dependencies — can be imported in tests without mocking
 * electron, AgentRunner, or pi-ai.
 *
 * active → stale (30 days unused)
 * stale  → active (recently used again)
 * stale  → archived (90 days unused)
 * active → archived (90 days unused)
 */

import type { UsageEntry } from "./skill-usage-tracker";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SkillStatus = "active" | "stale" | "archived";

export interface AgentCreatedSkillMeta {
  name: string;
  description: string;
  usage: UsageEntry | null;
  skillDir: string;
}

export interface SkillTransition {
  skill: string;
  from: SkillStatus;
  to: SkillStatus;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STALE_DAYS = 30;
const ARCHIVE_DAYS = 90;

// ---------------------------------------------------------------------------
// applyAutomaticTransitions
// ---------------------------------------------------------------------------

export function applyAutomaticTransitions(
  candidates: AgentCreatedSkillMeta[],
): SkillTransition[] {
  const transitions: SkillTransition[] = [];
  const now = Date.now();

  for (const c of candidates) {
    const currentStatus: SkillStatus = c.usage?.lastUsed ?? "active";

    if (!c.usage || !c.usage.lastUsedAt) continue;

    const daysSinceUsed = (now - c.usage.lastUsedAt) / 86400000;

    if (daysSinceUsed > ARCHIVE_DAYS && currentStatus !== "archived") {
      transitions.push({ skill: c.name, from: currentStatus, to: "archived" });
    } else if (daysSinceUsed > STALE_DAYS && currentStatus === "active") {
      transitions.push({ skill: c.name, from: "active", to: "stale" });
    } else if (daysSinceUsed <= STALE_DAYS && currentStatus === "stale") {
      transitions.push({ skill: c.name, from: "stale", to: "active" });
    }
  }

  return transitions;
}
