import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (relativePath: string) =>
  fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8");

describe("git.getRepoSummary wiring", () => {
  it("registers the read-only main handler", () => {
    expect(read("src/main/index.ts")).toContain(
      'ipcMain.handle("git.getRepoSummary"',
    );
  });

  it("exposes the preload bridge method and its type", () => {
    const preload = read("src/preload/index.ts");
    expect(preload).toContain(
      'ipcRenderer.invoke("git.getRepoSummary", dirPath)',
    );
    expect(preload).toContain("getRepoSummary: (dirPath?: string)");
  });
});
