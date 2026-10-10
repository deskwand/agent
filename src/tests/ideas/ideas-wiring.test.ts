import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./helpers";

const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const CHANNELS = [
  "ideas.list",
  "ideas.read",
  "ideas.create",
  "ideas.update",
  "ideas.setStatus",
  "ideas.remove",
];

describe("主进程 IPC 面", () => {
  const index = read("src/main/index.ts");

  for (const channel of CHANNELS) {
    it(`注册了 ${channel}`, () => {
      expect(index).toContain(`ipcMain.handle("${channel}"`);
    });
  }

  it("建了 ideaService 实例", () => {
    expect(index).toContain("ideaService = new IdeaService()");
  });
});

describe("preload 面", () => {
  const preload = read("src/preload/index.ts");

  for (const channel of CHANNELS) {
    it(`暴露了 ${channel}`, () => {
      expect(preload).toContain(`ipcRenderer.invoke("${channel}"`);
    });
  }

  it("挂在 electronAPI 的 ideas 命名空间下", () => {
    expect(preload).toMatch(/ideas:\s*\{/);
  });
});
