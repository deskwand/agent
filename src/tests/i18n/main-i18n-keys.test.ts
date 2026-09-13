import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MSG_KEYS } from "../../main/i18n";

/**
 * `t()` falls back to the key itself when it is missing, so a typo or a key
 * that only exists in one locale renders the raw key to the user (e.g.
 * "errors.modelTimeout" shown in chat). Neither the CJK scan nor the renderer
 * locale parity test covers the main-process table, so guard it here.
 */

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

const T_CALL = /\bt\(\s*["`]([a-zA-Z][\w.]*)["`]/g;

describe("main-process i18n keys", () => {
  it("defines the same keys in zh and en", () => {
    expect([...MSG_KEYS.zh].sort()).toEqual([...MSG_KEYS.en].sort());
  });

  it("resolves every t() key used in src/main", () => {
    const known = new Set(MSG_KEYS.en);
    const unresolved: string[] = [];

    for (const file of listSourceFiles("src/main")) {
      if (file.endsWith(join("i18n", "index.ts"))) continue;
      const relative = file.split("\\").join("/");
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(T_CALL)) {
        if (!known.has(match[1])) {
          unresolved.push(`${relative}: ${match[1]}`);
        }
      }
    }

    expect([...new Set(unresolved)].sort()).toEqual([]);
  });
});
