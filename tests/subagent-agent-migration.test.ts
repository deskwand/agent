import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// 让 migrateAgentModelSpecs 扫描我们控制的临时目录：
// agent-list.ts 内部使用 getAgentDir()（来自 pi-coding-agent），
// 通过 vi.mock 指向临时目录（agent-list 只 import 了 getAgentDir，无需加载整个包）。
const state = vi.hoisted(() => ({ agentDir: "" }));

vi.mock("@earendil-works/pi-coding-agent", () => ({
  getAgentDir: () => state.agentDir,
}));

import { migrateAgentModelSpecs } from "../src/main/agent/subagent/agent-list";

describe("migrateAgentModelSpecs", () => {
  const profileKeys = new Set(["deepseek", "custom:openai"]);
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "agent-migrate-"));
    state.agentDir = dir;
    mkdirSync(join(dir, "agents")); // 建 agents 目录
  });

  it("prefixes provider/model specs with deskwand:", () => {
    const agentsDir = join(dir, "agents");
    writeFileSync(
      join(agentsDir, "general-purpose.md"),
      "---\nname: general-purpose\nmodel: custom:openai/deepseek-v4-flash\n---\n",
      "utf-8",
    );
    const migrated = migrateAgentModelSpecs(profileKeys);
    expect(migrated).toBe(1);
    expect(
      readFileSync(join(agentsDir, "general-purpose.md"), "utf-8"),
    ).toContain("model: deskwand:custom:openai/deepseek-v4-flash");
  });

  it("leaves already-prefixed and inherit models untouched", () => {
    const agentsDir = join(dir, "agents");
    writeFileSync(
      join(agentsDir, "a.md"),
      "---\nname: a\nmodel: deskwand:deepseek/deepseek-v4-flash\n---\n",
      "utf-8",
    );
    writeFileSync(
      join(agentsDir, "b.md"),
      "---\nname: b\nmodel: inherit\n---\n",
      "utf-8",
    );
    const migrated = migrateAgentModelSpecs(profileKeys);
    expect(migrated).toBe(0);
    expect(readFileSync(join(agentsDir, "a.md"), "utf-8")).toContain(
      "model: deskwand:deepseek/deepseek-v4-flash",
    );
    expect(readFileSync(join(agentsDir, "b.md"), "utf-8")).toContain(
      "model: inherit",
    );
  });

  it("leaves bare model names untouched (cannot infer provider)", () => {
    const agentsDir = join(dir, "agents");
    writeFileSync(
      join(agentsDir, "c.md"),
      "---\nname: c\nmodel: deepseek-v4-flash\n---\n",
      "utf-8",
    );
    const migrated = migrateAgentModelSpecs(profileKeys);
    expect(migrated).toBe(0);
    expect(readFileSync(join(agentsDir, "c.md"), "utf-8")).toContain(
      "model: deepseek-v4-flash",
    );
  });

  it("leaves providers not in profileKeys untouched (no fake migration)", () => {
    const agentsDir = join(dir, "agents");
    writeFileSync(
      join(agentsDir, "d.md"),
      "---\nname: d\nmodel: deepseek/deepseek-v4-flash\n---\n",
      "utf-8",
    );
    // deepseek 不在 profileKeys（只有 custom:openai）
    const migrated = migrateAgentModelSpecs(new Set(["custom:openai"]));
    expect(migrated).toBe(0);
    expect(readFileSync(join(agentsDir, "d.md"), "utf-8")).toContain(
      "model: deepseek/deepseek-v4-flash",
    );
  });

  it("returns 0 when agent dir missing", () => {
    const empty = mkdtempSync(join(tmpdir(), "agent-empty-"));
    state.agentDir = empty;
    expect(migrateAgentModelSpecs(profileKeys)).toBe(0);
  });
});
