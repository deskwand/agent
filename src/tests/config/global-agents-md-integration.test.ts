import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readProjectFile(relativePath: string): string {
  return readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

describe("global-agents-md integration wiring", () => {
  it("exposes read/write IPC handlers and preload bridge", () => {
    const mainIndex = readProjectFile("src/main/index.ts");
    const preload = readProjectFile("src/preload/index.ts");
    expect(mainIndex).toContain('ipcMain.handle("global-agents-md:read"');
    expect(mainIndex).toContain('ipcMain.handle("global-agents-md:write"');
    expect(preload).toContain('ipcRenderer.invoke("global-agents-md:read")');
    expect(preload).toContain('ipcRenderer.invoke("global-agents-md:write"');
  });
});
