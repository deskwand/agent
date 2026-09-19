/**
 * Cleanup for built-in skills that were removed from a release.
 *
 * The built-in skill sync (agent-runner) only creates a link when the target
 * does not already exist, so retiring a skill from `.deskwand/skills/` leaves
 * the older copy behind in `~/.deskwand/skills/`. A stale copy is not harmless:
 * the retired `docx` skill and the new `officecli-docx` skill both claim
 * "Word doc" / "report" / "letter", so both would be offered to the model.
 *
 * Two shapes have to be recognised, because the sync produces both:
 *
 * 1. A **symlink** into the built-in skills directory. This is what a packaged
 *    app creates on macOS/Linux (the extraResources dir is real, so symlinking
 *    succeeds), and it dangles once the built-in directory is deleted.
 * 2. A **real directory copy**. The sync falls back to `copyDirectorySync` when
 *    symlinking fails — notably on Windows without Developer Mode, and whenever
 *    the built-in source sits inside an asar archive. Those copies are real
 *    directories, so "real directory means the user made it" is false.
 *
 * The symlink case is decided by where the link points. A real directory cannot
 * be, so it is decided by comparing it against the exact file manifest of what
 * we shipped: it is removed only when every file matches a shipped hash and no
 * extra file is present. An edited file, an added note or template, or a
 * directory the user authored all cause the directory to be kept — a stale skill
 * that lingers is a far lesser problem than deleting someone's work.
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { RETIRED_SKILL_MANIFESTS } from "./retired-skill-manifests";

/** Built-in skills that earlier releases shipped and that we no longer do. */
export const RETIRED_SKILL_NAMES = ["docx", "pptx", "xlsx"];

export interface CleanupOptions {
  skillsDir: string;
  builtinSkillsDir: string;
  retiredNames?: string[];
  /** Overridable for tests; defaults to the real shipped manifests. */
  manifests?: Record<string, Record<string, string>>;
}

export interface CleanupReport {
  removed: string[];
  kept: string[];
}

function realpathOrSelf(target: string): string {
  try {
    return fs.realpathSync(target);
  } catch {
    return path.resolve(target);
  }
}

function isInside(parentDir: string, childPath: string): boolean {
  // Both sides must be resolved: on macOS the temp dir and /var are themselves
  // symlinks (/var -> /private/var), so comparing one resolved path against one
  // unresolved path never matches.
  const parent = realpathOrSelf(parentDir) + path.sep;
  const child = realpathOrSelf(childPath) + path.sep;
  return child.startsWith(parent);
}

function listRelativeFiles(dirPath: string, prefix = ""): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(path.join(dirPath, prefix), {
    withFileTypes: true,
  })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      found.push(...listRelativeFiles(dirPath, rel));
    } else {
      found.push(rel);
    }
  }
  return found;
}

function sha256OfFile(filePath: string): string | null {
  try {
    return crypto
      .createHash("sha256")
      .update(fs.readFileSync(filePath))
      .digest("hex");
  } catch {
    return null;
  }
}

/**
 * True when `dirPath` is a byte-exact copy of the skill we shipped: every
 * shipped file is present and unmodified, and nothing else is in the tree.
 */
function isUnmodifiedCopy(
  dirPath: string,
  manifest: Record<string, string> | undefined,
): boolean {
  if (!manifest) return false;

  let actual: string[];
  try {
    actual = listRelativeFiles(dirPath).sort();
  } catch {
    return false;
  }

  const expected = Object.keys(manifest).sort();
  if (actual.length !== expected.length) return false;
  if (actual.some((file, i) => file !== expected[i])) return false;

  return actual.every(
    (file) => sha256OfFile(path.join(dirPath, file)) === manifest[file],
  );
}

export function cleanupRetiredSkillLinks(
  options: CleanupOptions,
): CleanupReport {
  const {
    skillsDir,
    builtinSkillsDir,
    retiredNames = RETIRED_SKILL_NAMES,
    manifests = RETIRED_SKILL_MANIFESTS,
  } = options;
  const report: CleanupReport = { removed: [], kept: [] };

  for (const name of retiredNames) {
    const entryPath = path.join(skillsDir, name);

    let lstat: fs.Stats;
    try {
      lstat = fs.lstatSync(entryPath);
    } catch {
      continue; // not present — the common case
    }

    const appManaged = lstat.isSymbolicLink()
      ? // Dangling means the built-in directory it pointed at is gone; otherwise
        // it is only ours to remove if it resolves into our own directory.
        !fs.existsSync(entryPath) || isInside(builtinSkillsDir, entryPath)
      : isUnmodifiedCopy(entryPath, manifests[name]);

    if (!appManaged) {
      report.kept.push(entryPath);
      continue;
    }

    try {
      fs.rmSync(entryPath, { recursive: true, force: true });
      report.removed.push(entryPath);
    } catch {
      report.kept.push(entryPath);
    }
  }

  return report;
}
