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
export const RETIRED_SKILL_NAMES = ["docx", "pptx", "xlsx", "image-ocr"];

/**
 * 技能**运行时自己长出来**的目录（不随包发布）。
 *
 * 退役时它们不算「用户的改动」：它们是被退役技能自己的运行过程撑出来的，而技能已经没了。
 * `image-ocr` 就是例子 —— 首次运行时下 94MB 语言包、`npm install` 50MB 引擎，
 * 于是一份本该被清掉的拷贝会因为「多出文件」而被判成用户自己的东西，永久留在磁盘上。
 *
 * 逐技能声明，不是全局规则：没列在这里的技能，多出任何文件都照样保留。
 */
export const RETIRED_SKILL_RUNTIME_DIRS: Record<string, string[]> = {
  "image-ocr": ["models", "node_modules"],
};

export interface CleanupOptions {
  skillsDir: string;
  builtinSkillsDir: string;
  retiredNames?: string[];
  /** Overridable for tests; defaults to the real shipped manifests. */
  manifests?: Record<string, Record<string, string>>;
  /** Overridable for tests; defaults to the real per-skill runtime dirs. */
  runtimeDirs?: Record<string, string[]>;
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
  runtimeDirs: readonly string[],
): boolean {
  if (!manifest) return false;

  let actual: string[];
  try {
    actual = listRelativeFiles(dirPath).sort();
  } catch {
    return false;
  }

  // 随包发布过的文件都要在，且哈希一致 —— 用户改过一个字节就不算我们的了。
  for (const [file, hash] of Object.entries(manifest)) {
    if (!actual.includes(file)) return false;
    if (sha256OfFile(path.join(dirPath, file)) !== hash) return false;
  }

  // 多出来的文件只能长在技能的运行时目录里（见 RETIRED_SKILL_RUNTIME_DIRS）。
  // 其余任何多余文件都说明用户在改它，保留 —— 留在磁盘上的死技能远比删掉别人的东西好。
  return actual
    .filter((file) => !(file in manifest))
    .every((file) => runtimeDirs.includes(file.split("/")[0]));
}

export function cleanupRetiredSkillLinks(
  options: CleanupOptions,
): CleanupReport {
  const {
    skillsDir,
    builtinSkillsDir,
    retiredNames = RETIRED_SKILL_NAMES,
    manifests = RETIRED_SKILL_MANIFESTS,
    runtimeDirs = RETIRED_SKILL_RUNTIME_DIRS,
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
      : isUnmodifiedCopy(entryPath, manifests[name], runtimeDirs[name] ?? []);

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
