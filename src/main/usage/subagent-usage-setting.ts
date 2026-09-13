import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { logWarn } from "../utils/logger";

/**
 * pi-subagents does not report subagent usage by default (reportUsage=false),
 * which makes a session that delegated most of its work look nearly free.
 *
 * Enabling it merges `reportUsage: true` into pi-subagents' own settings file
 * (not settings.json), preserving whatever else is in there. Side effect: a
 * standalone pi CLI run by the same user also starts counting subagents in
 * /cost — that is deliberate, so both surfaces agree on what a session spent.
 *
 * Returns whether a write happened (already enabled = no write, no mtime bump).
 */
export function ensureSubagentUsageReporting(agentDir: string): boolean {
  const file = join(agentDir, "subagents.json");

  let current: Record<string, unknown> = {};
  if (existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, "utf-8")) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return false;
      }
      current = parsed as Record<string, unknown>;
    } catch (error) {
      logWarn(
        "[Usage] Ignoring malformed subagents.json, not touching it:",
        error,
      );
      return false;
    }
  }

  if (current.reportUsage === true) return false;

  try {
    writeFileSync(
      file,
      `${JSON.stringify({ ...current, reportUsage: true }, null, 2)}\n`,
      "utf-8",
    );
    return true;
  } catch (error) {
    logWarn("[Usage] Failed to enable subagent usage reporting:", error);
    return false;
  }
}
