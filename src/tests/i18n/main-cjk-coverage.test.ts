import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards against new hardcoded Chinese in main-process user-facing strings:
 * those must go through the `src/main/i18n` table so they follow the locale
 * reported by the renderer.
 *
 * Known limitation: the file-level allowlist below is coarse — adding Chinese
 * inside an already allowed file goes unnoticed. This test is a coarse
 * regression guard ("a whole new module forgot i18n"), not a per-string one.
 * Per-string review is still on code review.
 *
 * Escape hatch for a single deliberate case: put `i18n-allow-cjk` in a comment
 * on the same line as the literal.
 */
const ALLOWED_FILES = new Set([
  // Model-visible prompts / JSON field descriptions.
  "src/main/memory/memory-prompts.ts",
  // Chinese stop-word list (tokenization, not copy).
  "src/main/memory/memory-utils.ts",
  // Intentionally bilingual prompt: the model must answer in the user's language.
  "src/main/session/session-title-utils.ts",
  // App-name mapping table and bilingual macOS permission hints.
  "src/main/mcp/gui-operate-server.ts",
  "src/main/mcp/gui-accessibility-query.ts",
  // The message table itself.
  "src/main/i18n/index.ts",
]);

const CJK = /[\u4e00-\u9fa5]/;
const CJK_LITERAL =
  /("[^"]*[\u4e00-\u9fa5][^"]*")|('[^']*[\u4e00-\u9fa5][^']*')|(`[^`]*[\u4e00-\u9fa5][^`]*`)/;

function listSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      listSourceFiles(full, out);
    } else if (/\.ts$/.test(entry) && !/\.test\.ts$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Removes comments but KEEPS line breaks: deleting block comments outright
 * shifts every following line number and can glue a `log(` before the comment
 * onto the code after it, which would hide real offenders.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("main-process user-facing strings are localized", () => {
  it("has no hardcoded CJK string literal outside the allowlist", () => {
    const offenders: string[] = [];

    for (const file of listSourceFiles("src/main")) {
      const relative = file.split("\\").join("/");
      if (ALLOWED_FILES.has(relative)) continue;

      const lines = stripComments(readFileSync(file, "utf8")).split("\n");
      lines.forEach((line, index) => {
        if (!CJK.test(line)) return;
        if (!CJK_LITERAL.test(line)) return;
        // Log lines may carry Chinese; they never reach the UI.
        if (/^\s*log(Error|Warn)?\(/.test(line)) return;
        if (line.includes("i18n-allow-cjk")) return;
        offenders.push(`${relative}:${index + 1}: ${line.trim()}`);
      });
    }

    expect(offenders).toEqual([]);
  });
});
