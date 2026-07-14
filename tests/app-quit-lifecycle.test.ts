import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const indexPath = path.resolve(process.cwd(), "src/main/index.ts");
const source = fs.readFileSync(indexPath, "utf8");

function getSourceBlock(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("app quit lifecycle", () => {
  it("waits for cleanup and allows the internal quit retry", () => {
    const block = getSourceBlock('app.on("before-quit"', "// IPC Handlers");

    const cleanupInProgressGuard = block.indexOf("if (isCleaningUp)");
    const cleanupCompleteGuard = block.indexOf(
      "if (!isCleanupComplete && !isQuittingForUpdate)",
      cleanupInProgressGuard,
    );
    const repeatedQuitPrevention = block.indexOf(
      "event.preventDefault()",
      cleanupCompleteGuard,
    );
    const cleanup = block.indexOf("await cleanupSandboxResources()");
    const markCleanupComplete = block.indexOf(
      "isCleanupComplete = true",
      cleanup,
    );
    const quit = block.indexOf("app.quit()", cleanup);

    expect(cleanupInProgressGuard).toBeGreaterThanOrEqual(0);
    expect(cleanupInProgressGuard).toBeLessThan(cleanupCompleteGuard);
    expect(cleanupCompleteGuard).toBeLessThan(repeatedQuitPrevention);
    expect(repeatedQuitPrevention).toBeLessThan(cleanup);
    expect(cleanup).toBeLessThan(markCleanupComplete);
    expect(markCleanupComplete).toBeLessThan(quit);
    expect(block).not.toContain("isCleaningUp = true");
  });

  it("marks cleanup complete only after resources are released", () => {
    const block = getSourceBlock(
      "async function cleanupSandboxResources()",
      "// Handle app quit - window-all-closed",
    );

    const closeLogFile = block.indexOf("closeLogFile()");
    const cleanupComplete = block.indexOf("isCleanupComplete = true");

    expect(closeLogFile).toBeGreaterThanOrEqual(0);
    expect(cleanupComplete).toBeGreaterThan(closeLogFile);
  });
});
