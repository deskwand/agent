import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readProjectFile(relativePath: string): string {
  return readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

describe("memory integration wiring", () => {
  it("registers the memory extension in the main process and exposes IPC handlers", () => {
    const mainIndex = readProjectFile("src/main/index.ts");
    expect(mainIndex).toContain("new MemoryExtension(memoryService)");
    expect(mainIndex).toContain('"memory.search"');
    expect(mainIndex).toContain('ipcMain.handle("memory.setEnabled"');
    expect(mainIndex).toContain('ipcMain.handle("memory.clearAll"');
  });

  it("injects runtime plugin skill paths and extension hooks into the agent runner", () => {
    const runner = readProjectFile("src/main/agent/agent-runner.ts");
    const memoryExtension = readProjectFile(
      "src/main/memory/memory-extension.ts",
    );
    expect(runner).toContain("resolveSkillPaths()");
    expect(runner).toContain("this.extensionManager.beforeSessionRun");
    expect(runner).toContain("skillsSignature");
    expect(memoryExtension).toContain(
      "customTools: this.memoryService.getTools(session.cwd)",
    );
    expect(memoryExtension).toContain("systemPromptSuffix");
  });

  it("adds a dedicated Memory settings tab and preload bridge", () => {
    const settingsPanel = readProjectFile(
      "src/renderer/components/SettingsPanel.tsx",
    );
    const preload = readProjectFile("src/preload/index.ts");
    const memorySettings = readProjectFile(
      "src/renderer/components/settings/SettingsPersonalization.tsx",
    );

    expect(settingsPanel).toContain('id: "personalization"');
    expect(settingsPanel).toContain("<SettingsPersonalization />");
    expect(preload).toContain("memory: {");
    expect(preload).toContain('ipcRenderer.invoke("memory.search"');
    expect(preload).toContain('ipcRenderer.invoke("memory.clearAll")');
    expect(memorySettings).toContain("window.electronAPI.memory.setEnabled");
    expect(memorySettings).toContain("window.electronAPI.memory.clearAll");
  });

  it("keeps background skill review separate from memory learning", () => {
    const finalizer = readProjectFile("src/main/agent/turn-finalizer.ts");
    const backgroundReview = readProjectFile(
      "src/main/agent/background-review.ts",
    );
    const reviewPrompt = readProjectFile("src/main/agent/review-prompts.ts");

    expect(finalizer).not.toContain("turnsSinceLastMemoryReview");
    expect(backgroundReview).not.toContain("memory-write-tools");
    expect(backgroundReview).not.toContain("coreStore");
    expect(reviewPrompt).not.toContain("memory_upsert");
    expect(reviewPrompt).not.toContain("memory_delete");
  });

  it("defaults new sessions to the global memory toggle", () => {
    const sessionManager = readProjectFile(
      "src/main/session/session-manager.ts",
    );
    expect(sessionManager).toContain(
      'configStore.get("memoryEnabled") !== false',
    );
    expect(sessionManager).toContain("memoryEnabled?: boolean");
    expect(sessionManager).toContain("afterSessionRun");
  });

  it("describes memory as on-demand rather than automatically injected", () => {
    const en = JSON.parse(
      readProjectFile("src/renderer/i18n/locales/en.json"),
    ) as {
      settings: { personalizationDesc: string };
      memory: { description: string; toggleHint: string };
    };
    const zh = JSON.parse(
      readProjectFile("src/renderer/i18n/locales/zh.json"),
    ) as {
      settings: { personalizationDesc: string };
      memory: { description: string; toggleHint: string };
    };

    expect(en.settings.personalizationDesc).toContain("memory");
    expect(en.memory.description).toContain("never automatically injected");
    expect(en.memory.description).toContain("every 10 user turns");
    expect(en.memory.toggleHint).toContain("on-demand");
    expect(en.memory.toggleHint).not.toContain("auto-recall");
    expect(zh.settings.personalizationDesc).toContain("记忆");
    expect(zh.memory.description).toContain("不会自动注入");
    expect(zh.memory.description).toContain("每 10 个用户回合");
    expect(zh.memory.toggleHint).toContain("按需");
    expect(zh.memory.toggleHint).not.toContain("自动注入");
  });

  it("removes unused SQLite memory tables from schema initialization", () => {
    const databaseSource = readProjectFile("src/main/db/database.ts");
    expect(databaseSource).not.toContain("memory_core_entries");
    expect(databaseSource).not.toContain("memory_experience_sessions");
    expect(databaseSource).not.toContain("memory_experience_chunks");
    expect(databaseSource).not.toContain("memory_session_state");
  });
});
