import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { toPromptCommandEntries } from "../../main/prompts/prompt-command-store";

describe("toPromptCommandEntries", () => {
  let agentDir: string;

  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), "prompt-cmd-entries-"));
  });

  afterEach(() => {
    rmSync(agentDir, { recursive: true, force: true });
  });

  it("全局目录的模板标成 editable 并读出 display_name", () => {
    const filePath = join(agentDir, "translate.md");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      filePath,
      '---\ndisplay_name: "翻译成英文"\n---\n\n正文\n',
      "utf-8",
    );
    const entries = toPromptCommandEntries([
      { name: "translate", description: "把内容翻译成英文", filePath, scope: "user" },
    ]);
    expect(entries).toEqual([
      {
        name: "translate",
        description: "把内容翻译成英文",
        source: "prompt",
        displayName: "翻译成英文",
        editable: true,
      },
    ]);
  });

  it("项目级/包内的模板 editable=false 且不去读文件", () => {
    const entries = toPromptCommandEntries([
      {
        name: "repo-only",
        description: "仓库里的模板",
        filePath: join(agentDir, "missing.md"),
        scope: "project",
      },
    ]);
    expect(entries).toEqual([
      {
        name: "repo-only",
        description: "仓库里的模板",
        source: "prompt",
        displayName: undefined,
        editable: false,
      },
    ]);
  });

  it("文件坏掉时退回 displayName 缺失，而不是抛错", () => {
    const filePath = join(agentDir, "broken.md");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(filePath, "---\ndisplay_name: [unclosed\n---\n\n正文\n", "utf-8");
    const entries = toPromptCommandEntries([
      { name: "broken", description: "d", filePath, scope: "user" },
    ]);
    expect(entries[0].displayName).toBeUndefined();
    expect(entries[0].editable).toBe(true);
  });
});
