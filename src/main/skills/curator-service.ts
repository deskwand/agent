/**
 * @module main/skills/curator-service
 *
 * Periodic skill maintenance — consolidates fragmented agent-created skills
 * into class-level umbrella skills, and archives long-unused skills.
 *
 * Adapted from Hermes Agent curator.py (1848 lines).
 *
 * Architecture:
 *   CuratorService.maybeRun()
 *     → scanAgentCreatedSkills() — list agent-created skills with usage stats
 *     → applyAutomaticTransitions() — active → stale(30d) → archived(90d)
 *     → forkCuratorAgent() — lightweight AgentRunner fork → LLM uses tools
 *     → executePlan() — merge / archive actions
 *     → generateReport() — Markdown report
 *     → saveState()
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { app } from "electron";
import { parse as parseYaml } from "yaml";
import { log, logError } from "../utils/logger";
import { configStore } from "../config/config-store";
import { getAgentCreatedSkillNames, addManifestEntry } from "./agent-manifest";
import { getAllUsageStats, setSkillStatus } from "./skill-usage-tracker";
import { CURATOR_SYSTEM_PROMPT } from "../agent/curator-prompts";
import { AgentRunner } from "../agent/agent-runner";
import { PathResolver } from "../sandbox/path-resolver";
import { buildSkillWriteTools } from "./skill-write-tools";
import {
  applyAutomaticTransitions,
  type AgentCreatedSkillMeta,
  type SkillTransition,
} from "./curator-transitions";
import { isPathWithinRoot } from "../tools/path-containment";
import type { SkillsAdapter } from "./skills-adapter";
import type { Session, Message } from "../../renderer/types";

export type { SkillStatus } from "./curator-transitions";

export interface Consolidation {
  type: "merge" | "new_umbrella" | "demote";
  sourceSkills: string[];
  targetSkill: string;
  reason?: string;
}

export interface ArchiveAction {
  skill: string;
  reason: string;
}

export interface CuratorPlan {
  consolidations: Consolidation[];
  archives: ArchiveAction[];
}

export interface CuratorState {
  lastRunAt: number;
  pauseUntil: number | null;
  totalRuns: number;
  totalConsolidations: number;
  totalArchives: number;
}

export interface CuratorRunResult {
  timestamp: number;
  consolidations: Consolidation[];
  archives: ArchiveAction[];
  autoTransitions: SkillTransition[];
  report: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CURATOR_INTERVAL_MS = 7 * 24 * 3600 * 1000; // 7 days

// ---------------------------------------------------------------------------
// CuratorService
//
// NOTE: This class is not yet wired into the app lifecycle (main/index.ts or
// session-manager.ts).  When wired, it should be instantiated with:
//   new CuratorService(globalSkillsPath, pathResolver, skillsAdapter)
// and maybeRun() should be called:
//   - on app startup (if lastRunAt > 7 days ago)
//   - after 2h of idle time
//   - manually via UI / IPC handler
// ---------------------------------------------------------------------------

export class CuratorService {
  private globalSkillsPath: string;
  private pathResolver: PathResolver;
  private skillsAdapter?: SkillsAdapter;

  constructor(
    globalSkillsPath: string,
    pathResolver: PathResolver,
    skillsAdapter?: SkillsAdapter,
  ) {
    this.globalSkillsPath = globalSkillsPath;
    this.pathResolver = pathResolver;
    this.skillsAdapter = skillsAdapter;
  }

  // ---- Scheduling ----

  async maybeRun(): Promise<CuratorRunResult | null> {
    if (!configStore.getAll().autoSkillLearning) {
      return null;
    }

    const state = this.loadState();

    if (state.pauseUntil && Date.now() < state.pauseUntil) {
      log("[Curator] Paused until", new Date(state.pauseUntil).toISOString());
      return null;
    }

    if (Date.now() - state.lastRunAt < CURATOR_INTERVAL_MS) {
      log(
        "[Curator] Not yet time — last run:",
        new Date(state.lastRunAt).toISOString(),
      );
      return null;
    }

    return this.run();
  }

  async run(): Promise<CuratorRunResult> {
    const state = this.loadState();
    log("[Curator] Starting curation run...");

    // 1. Scan
    const candidates = this.scanAgentCreatedSkills();

    // 2. Auto transitions
    const autoTransitions = applyAutomaticTransitions(candidates);
    for (const t of autoTransitions) {
      if (t.to === "archived") {
        this.archiveSkill(t.skill, "Auto-archived: unused for 90+ days");
      }
      setSkillStatus(this.globalSkillsPath, t.skill, t.to);
    }

    // 3. LLM consolidation via AgentRunner fork
    const activeOrStale = candidates.filter(
      (c) => c.usage?.lastUsed !== "archived",
    );
    let plan: CuratorPlan = { consolidations: [], archives: [] };

    if (activeOrStale.length >= 2) {
      try {
        plan = await this.forkCuratorAgent(activeOrStale);
      } catch (err) {
        logError("[Curator] LLM consolidation failed:", err);
      }
    } else {
      log("[Curator] Not enough active skills for consolidation (need >= 2)");
    }

    // 4. Execute consolidations
    for (const c of plan.consolidations) {
      try {
        await this.executeConsolidation(c);
      } catch (err) {
        logError(`[Curator] Consolidation failed for ${c.targetSkill}:`, err);
      }
    }

    // 5. Execute manual archives from LLM plan
    for (const a of plan.archives) {
      try {
        this.archiveSkill(a.skill, a.reason);
        setSkillStatus(this.globalSkillsPath, a.skill, "archived");
      } catch (err) {
        logError(`[Curator] Archive failed for ${a.skill}:`, err);
      }
    }

    // 6. Report
    const report = this.generateReport(plan, autoTransitions);

    // 7. Save state
    const newTotal = {
      totalRuns: state.totalRuns + 1,
      totalConsolidations:
        state.totalConsolidations + plan.consolidations.length,
      totalArchives:
        state.totalArchives +
        plan.archives.length +
        autoTransitions.filter((t) => t.to === "archived").length,
    };
    this.saveState({ lastRunAt: Date.now(), ...newTotal });

    // 8. Write log
    await this.writeCuratorLog(report);

    const result: CuratorRunResult = {
      timestamp: Date.now(),
      consolidations: plan.consolidations,
      archives: plan.archives,
      autoTransitions,
      report,
    };

    log(
      "[Curator] Run complete:",
      plan.consolidations.length,
      "consolidations,",
      plan.archives.length +
        autoTransitions.filter((t) => t.to === "archived").length,
      "archives",
    );

    return result;
  }

  // ---- Core logic ----

  private scanAgentCreatedSkills(): AgentCreatedSkillMeta[] {
    const names = getAgentCreatedSkillNames(this.globalSkillsPath);
    const allUsage = getAllUsageStats(this.globalSkillsPath);
    const usageMap = new Map(allUsage.map((u) => [u.name, u]));

    const result: AgentCreatedSkillMeta[] = [];
    for (const name of names) {
      const skillDir = path.join(this.globalSkillsPath, name);
      const skillMdPath = path.join(skillDir, "SKILL.md");
      if (!fs.existsSync(skillMdPath)) continue;

      let description = name;
      try {
        const content = fs.readFileSync(skillMdPath, "utf-8");
        const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (fmMatch) {
          const parsed = parseYaml(fmMatch[1]);
          if (
            parsed &&
            typeof parsed === "object" &&
            typeof (parsed as Record<string, unknown>).description === "string"
          ) {
            description = (
              (parsed as Record<string, unknown>).description as string
            ).trim();
          }
        }
      } catch {
        /* use name as fallback */
      }

      const usage = usageMap.get(name) ?? null;
      result.push({ name, description, usage, skillDir });
    }

    result.sort((a, b) => {
      if (a.usage?.lastUsed !== b.usage?.lastUsed) {
        if (a.usage?.lastUsed === "active") return -1;
        if (b.usage?.lastUsed === "active") return 1;
      }
      return (b.usage?.useCount ?? 0) - (a.usage?.useCount ?? 0);
    });

    return result;
  }

  /**
   * Fork a lightweight AgentRunner to consolidate skills.
   *
   * The forked runner has read + skill_create + skill_patch + skill_add_reference
   * tools. The LLM inspects candidate skills, merges them into umbrellas,
   * and archives stale entries.
   *
   * After the fork completes, we snapshot the file system to determine
   * which actions were taken (instead of parsing YAML output).
   */
  private async forkCuratorAgent(
    candidates: AgentCreatedSkillMeta[],
  ): Promise<CuratorPlan> {
    // 1. Build candidate listing
    const candidateLines = candidates.map((c) => {
      const usageLine = c.usage
        ? `used ${c.usage.useCount}x, last: ${new Date(c.usage.lastUsedAt).toISOString().slice(0, 10)}, status: ${c.usage.lastUsed}`
        : "no usage data";
      return `- ${c.name}: ${c.description} (${usageLine})`;
    });

    const prompt = `## Skills to curate

${candidateLines.join("\n")}

Review these agent-created skills. Read their SKILL.md files, identify clusters, and use your tools to consolidate them into class-level umbrella skills. Archive skills that are stale (90+ days unused).

Be thorough — fewer than 10 actions means you stopped too early.`;

    // 2. Tool set
    const tools = buildSkillWriteTools({
      globalSkillsPath: this.globalSkillsPath,
    });

    // 3. Take pre-fork snapshot
    const before = this.snapshotAgentSkills();

    // 4. Create fork
    const forkRunner = new AgentRunner(
      { sendToRenderer: () => {}, customTools: tools },
      this.pathResolver,
      undefined,
      this.skillsAdapter,
    );

    const forkSession: Session = {
      id: `curator-${Date.now()}`,
      title: "",
      cwd: os.homedir(),
      mountedPaths: [],
      allowedTools: tools.map((t) => t.name),
      status: "idle",
      memoryEnabled: false,
      isProjectMode: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // 5. Run — pass curator system prompt as existingMessages (same pattern as BackgroundReviewService)
    const systemMsg: Message = {
      id: `curator-sys-${Date.now()}`,
      sessionId: forkSession.id,
      role: "system" as Message["role"],
      content: [{ type: "text", text: CURATOR_SYSTEM_PROMPT }],
      timestamp: Date.now(),
    };

    await forkRunner.run(forkSession, prompt, [systemMsg]);

    // 6. Compute diff (what changed)
    const after = this.snapshotAgentSkills();
    return this.computeCuratorDiff(before, after);
  }

  /** Snapshot current agent-created skill names. */
  private snapshotAgentSkills(): Set<string> {
    return new Set(getAgentCreatedSkillNames(this.globalSkillsPath));
  }

  /**
   * Compare pre/post fork snapshots to determine what happened.
   *
   * LIMITATION: File-name diff can only detect CREATED (new name appears) and
   * ARCHIVED (name disappears).  It cannot distinguish MERGE (2+ sources into
   * an existing umbrella) from DEMOTE (skill → reference file).  The real
   * consolidation work is performed by the forked LLM — this diff is a
   * best-effort summary for the curator report.  Merges and demotes that
   * don't change the file-name set will not appear in the report.
   */
  private computeCuratorDiff(
    before: Set<string>,
    after: Set<string>,
  ): CuratorPlan {
    const plan: CuratorPlan = { consolidations: [], archives: [] };

    const archived = new Set([...before].filter((n) => !after.has(n)));
    const created = new Set([...after].filter((n) => !before.has(n)));

    for (const name of archived) {
      plan.archives.push({ skill: name, reason: "Archived by curator" });
    }

    // Created skills are new umbrellas
    for (const name of created) {
      plan.consolidations.push({
        type: "new_umbrella",
        sourceSkills: [],
        targetSkill: name,
        reason: "Created by curator",
      });
    }

    return plan;
  }

  private async executeConsolidation(c: Consolidation): Promise<void> {
    log(
      `[Curator] Consolidating: ${c.type} → ${c.targetSkill} (${c.sourceSkills.join(", ")})`,
    );
    switch (c.type) {
      case "merge":
        await this.mergeIntoUmbrella(c);
        break;
      case "new_umbrella":
        await this.createUmbrella(c);
        break;
      case "demote":
        await this.demoteToReference(c);
        break;
    }
  }

  private async mergeIntoUmbrella(c: Consolidation): Promise<void> {
    const targetPath = path.join(
      this.globalSkillsPath,
      c.targetSkill,
      "SKILL.md",
    );
    if (!fs.existsSync(targetPath)) {
      log(`[Curator] Target ${c.targetSkill} not found, skipping merge`);
      return;
    }

    let targetContent = fs.readFileSync(targetPath, "utf-8");
    for (const sourceName of c.sourceSkills) {
      const sourcePath = path.join(
        this.globalSkillsPath,
        sourceName,
        "SKILL.md",
      );
      if (!fs.existsSync(sourcePath)) continue;
      const sourceContent = fs.readFileSync(sourcePath, "utf-8");
      const bodyMatch = sourceContent.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
      const body = bodyMatch ? bodyMatch[1].trim() : sourceContent;
      if (body) {
        targetContent += `\n\n<!-- merged from ${sourceName} → ${new Date().toISOString().slice(0, 10)} -->\n${body}`;
      }
      this.archiveSkill(sourceName, `Merged into umbrella: ${c.targetSkill}`);
    }

    const backupDir = path.join(
      this.globalSkillsPath,
      ".archive",
      ".backup",
      c.targetSkill,
    );
    fs.mkdirSync(backupDir, { recursive: true });
    fs.copyFileSync(targetPath, path.join(backupDir, `${Date.now()}.md`));

    const tmpPath = targetPath + ".tmp";
    fs.writeFileSync(tmpPath, targetContent, "utf-8");
    fs.renameSync(tmpPath, targetPath);
    log(
      `[Curator] Merged ${c.sourceSkills.length} skills into ${c.targetSkill}`,
    );
  }

  private async createUmbrella(c: Consolidation): Promise<void> {
    const umbrellaDir = path.join(this.globalSkillsPath, c.targetSkill);
    if (fs.existsSync(umbrellaDir)) {
      log(`[Curator] Umbrella ${c.targetSkill} already exists, skipping`);
      return;
    }

    const sections: string[] = [];
    for (const sourceName of c.sourceSkills) {
      const sourcePath = path.join(
        this.globalSkillsPath,
        sourceName,
        "SKILL.md",
      );
      if (!fs.existsSync(sourcePath)) continue;
      const sourceContent = fs.readFileSync(sourcePath, "utf-8");
      const bodyMatch = sourceContent.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
      const body = bodyMatch ? bodyMatch[1].trim() : sourceContent;
      if (body) sections.push(`<!-- from ${sourceName} -->\n${body}`);
      this.archiveSkill(
        sourceName,
        `Consolidated into new umbrella: ${c.targetSkill}`,
      );
    }

    const umbrellaContent = `---
name: ${c.targetSkill}
description: "Auto-generated umbrella skill — consolidates: ${c.sourceSkills.join(", ")}"
license: MIT
metadata:
  source: agent
  curator_created: true
  curator_timestamp: ${new Date().toISOString()}
---

# ${c.targetSkill}

${c.reason ? `> ${c.reason}\n` : ""}
${sections.join("\n\n")}
`;

    fs.mkdirSync(umbrellaDir, { recursive: true });
    const tmpPath = path.join(umbrellaDir, ".tmp", "SKILL.md");
    fs.mkdirSync(path.dirname(tmpPath), { recursive: true });
    fs.writeFileSync(tmpPath, umbrellaContent, "utf-8");
    fs.renameSync(tmpPath, path.join(umbrellaDir, "SKILL.md"));

    addManifestEntry(this.globalSkillsPath, c.targetSkill, umbrellaContent);
    log(`[Curator] Created umbrella: ${c.targetSkill}`);
  }

  private async demoteToReference(c: Consolidation): Promise<void> {
    for (const sourceName of c.sourceSkills) {
      const sourceDir = path.join(this.globalSkillsPath, sourceName);
      const sourceSkillMd = path.join(sourceDir, "SKILL.md");
      if (!fs.existsSync(sourceSkillMd)) continue;

      const targetRefDir = path.join(
        this.globalSkillsPath,
        c.targetSkill,
        "references",
      );
      fs.mkdirSync(targetRefDir, { recursive: true });
      const refPath = path.join(targetRefDir, `${sourceName}.md`);
      fs.writeFileSync(
        refPath,
        fs.readFileSync(sourceSkillMd, "utf-8"),
        "utf-8",
      );

      this.archiveSkill(
        sourceName,
        `Demoted to reference under: ${c.targetSkill}`,
      );
      log(`[Curator] Demoted ${sourceName} → reference in ${c.targetSkill}`);
    }
  }

  private archiveSkill(skillName: string, reason: string): void {
    const skillDir = path.join(this.globalSkillsPath, skillName);
    if (!fs.existsSync(skillDir)) return;

    const dateStr = new Date().toISOString().slice(0, 10);
    const archiveRoot = path.join(this.globalSkillsPath, ".archive");
    const archiveDateDir = path.join(archiveRoot, dateStr);
    const archiveTarget = path.join(archiveDateDir, skillName);

    if (!isPathWithinRoot(archiveTarget, this.globalSkillsPath)) {
      logError(
        `[Curator] Archive target outside skills path: ${archiveTarget}`,
      );
      return;
    }
    if (fs.existsSync(archiveTarget)) {
      log(`[Curator] Already archived: ${skillName}`);
      return;
    }

    fs.mkdirSync(archiveDateDir, { recursive: true });

    try {
      try {
        fs.renameSync(skillDir, archiveTarget);
      } catch (renameErr: any) {
        if (renameErr.code === "EXDEV") {
          fs.cpSync(skillDir, archiveTarget, { recursive: true });
          fs.rmSync(skillDir, { recursive: true, force: true });
        } else throw renameErr;
      }
      log(
        `[Curator] Archived ${skillName} → .archive/${dateStr}/${skillName}: ${reason}`,
      );

      const readmePath = path.join(archiveDateDir, "README.md");
      const entry = `- **${skillName}**: ${reason} (archived ${new Date().toISOString()})\n`;
      if (fs.existsSync(readmePath)) {
        fs.appendFileSync(readmePath, entry, "utf-8");
      } else {
        fs.writeFileSync(
          readmePath,
          `# Archive ${dateStr}\n\n${entry}`,
          "utf-8",
        );
      }
    } catch (err) {
      logError(`[Curator] Failed to archive ${skillName}:`, err);
    }
  }

  // ---- Report ----

  private generateReport(
    plan: CuratorPlan,
    autoTransitions: SkillTransition[],
  ): string {
    const lines = [
      `# Curator Report — ${new Date().toISOString()}`,
      "",
      "## Auto Transitions",
      "",
    ];

    if (autoTransitions.length === 0) {
      lines.push("*No auto transitions*");
    } else {
      for (const t of autoTransitions) {
        lines.push(`- **${t.skill}**: ${t.from} → ${t.to}`);
      }
    }

    lines.push("", "## Consolidations", "");
    if (plan.consolidations.length === 0) {
      lines.push("*No consolidations*");
    } else {
      for (const c of plan.consolidations) {
        lines.push(
          `- **${c.type}**: ${c.sourceSkills.join(", ")} → ${c.targetSkill}`,
        );
        if (c.reason) lines.push(`  > ${c.reason}`);
      }
    }

    lines.push("", "## Archives", "");
    if (plan.archives.length === 0) {
      lines.push("*No manual archives*");
    } else {
      for (const a of plan.archives) {
        lines.push(`- **${a.skill}**: ${a.reason}`);
      }
    }

    return lines.join("\n");
  }

  private async writeCuratorLog(report: string): Promise<void> {
    try {
      const logDir = path.join(
        app.getPath("userData"),
        "logs",
        "curator",
        new Date().toISOString().slice(0, 10),
      );
      fs.mkdirSync(logDir, { recursive: true });
      const reportPath = path.join(
        logDir,
        `${new Date().toISOString().replace(/:/g, "-")}.md`,
      );
      fs.writeFileSync(reportPath, report, "utf-8");
      log("[Curator] Report written to:", reportPath);
    } catch (err) {
      logError("[Curator] Failed to write report:", err);
    }
  }

  // ---- State ----

  private statePath(): string {
    return path.join(app.getPath("userData"), "curator_state.json");
  }

  loadState(): CuratorState {
    try {
      if (!fs.existsSync(this.statePath())) {
        return {
          lastRunAt: Date.now(),
          pauseUntil: null,
          totalRuns: 0,
          totalConsolidations: 0,
          totalArchives: 0,
        };
      }
      const raw = fs.readFileSync(this.statePath(), "utf-8");
      return JSON.parse(raw) as CuratorState;
    } catch {
      return {
        lastRunAt: Date.now(),
        pauseUntil: null,
        totalRuns: 0,
        totalConsolidations: 0,
        totalArchives: 0,
      };
    }
  }

  saveState(partial: Partial<CuratorState>): void {
    const current = this.loadState();
    const next = { ...current, ...partial };
    try {
      const sp = this.statePath();
      const tmp = sp + ".tmp";
      fs.mkdirSync(path.dirname(sp), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(next, null, 2), "utf-8");
      fs.renameSync(tmp, sp);
    } catch (err) {
      logError("[Curator] Failed to save state:", err);
    }
  }

  // ---- Manual control ----

  pause(durationMs?: number): void {
    const until = durationMs ? Date.now() + durationMs : null;
    this.saveState({ pauseUntil: until });
    log(
      "[Curator] Paused" +
        (until ? ` until ${new Date(until).toISOString()}` : " indefinitely"),
    );
  }

  resume(): void {
    this.saveState({ pauseUntil: null });
    log("[Curator] Resumed");
  }

  isPaused(): boolean {
    const state = this.loadState();
    return state.pauseUntil !== null && Date.now() < state.pauseUntil;
  }
}
