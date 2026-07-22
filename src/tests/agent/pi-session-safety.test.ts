import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { piSessionFileContainsLegacyMemoryContext } from "../../main/agent/pi-session-safety";

const tempDirs: string[] = [];

function sessionFile(content: string): string {
  const directory = mkdtempSync(join(tmpdir(), "deskwand-pi-session-"));
  tempDirs.push(directory);
  const file = join(directory, "session.jsonl");
  writeFileSync(file, content, "utf8");
  return file;
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Pi session file safety", () => {
  it("rejects files containing legacy injected memory context", () => {
    const padding = "x".repeat(64 * 1024 - 8);
    const file = sessionFile(
      `${padding}<memory_context>old injected memory</memory_context>`,
    );

    expect(piSessionFileContainsLegacyMemoryContext(file)).toBe(true);
  });

  it("accepts files without the exact legacy marker", () => {
    const file = sessionFile(
      '{"message":"<memory-context>tool output</memory-context>"}\n',
    );

    expect(piSessionFileContainsLegacyMemoryContext(file)).toBe(false);
  });

  it("treats missing files as clean", () => {
    expect(
      piSessionFileContainsLegacyMemoryContext("/missing/session.jsonl"),
    ).toBe(false);
    expect(piSessionFileContainsLegacyMemoryContext(undefined)).toBe(false);
  });
});
