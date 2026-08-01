import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createAgentSession } from "@earendil-works/pi-coding-agent";
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { resolveInvocationName } from "../../main/extensions/pi-command-registry";

const stubModel = {
  id: "stub", name: "stub", api: "anthropic-messages" as const,
  provider: "anthropic" as const, baseUrl: "http://localhost:1",
  reasoning: false, input: ["text"] as const,
  cost: { input: 0, output: 0 }, contextWindow: 1000, maxTokens: 100,
};

function writeExt(agentDir: string, name: string) {
  fs.mkdirSync(path.join(agentDir, "extensions", name), { recursive: true });
  fs.writeFileSync(
    path.join(agentDir, "extensions", name, "index.ts"),
    `import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export default function (pi: ExtensionAPI) {
  pi.registerCommand("plan", {
    description: "plan from ${name}",
    handler: async () => {
      require("node:fs").writeFileSync(${JSON.stringify(path.join(agentDir, `ran-${name}.txt`))}, "ran");
    },
  });
}`,
  );
}

describe("duplicate command name handling", () => {
  let base: string;
  let agentDir: string;
  let cwd: string;

  beforeAll(() => {
    base = fs.mkdtempSync(path.join(os.homedir(), ".pi-dup-"));
    agentDir = path.join(base, "agent");
    cwd = path.join(base, "project");
    fs.mkdirSync(cwd, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  it("two extensions registering 'plan' → /plan does NOT execute (SDK renames to plan:1/plan:2)", async () => {
    writeExt(agentDir, "ext-a");
    writeExt(agentDir, "ext-b");
    const loader = new DefaultResourceLoader({
      cwd, agentDir,
      settingsManager: SettingsManager.create(cwd, agentDir),
    });
    await loader.reload();
    const { session } = await createAgentSession({
      model: stubModel as never,
      tools: [],
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory(),
    });
    await expect(session.prompt("/plan")).rejects.toThrow(/No API key|stub/);
    // /plan:1 should work (SDK renamed the duplicate)
    await session.prompt("/plan:1");
    expect(fs.existsSync(path.join(agentDir, "ran-ext-a.txt")) ||
           fs.existsSync(path.join(agentDir, "ran-ext-b.txt"))).toBe(true);
    // 映射一致性锁死：resolveInvocationName 输出必须与 runner 行为一致
    expect(resolveInvocationName([{ name: "plan" }, { name: "plan" }], "plan")).toBe("plan:1");
  }, 30000);

  it("single 'plan' registration → /plan executes normally", async () => {
    const base2 = fs.mkdtempSync(path.join(os.homedir(), ".pi-dup2-"));
    const agentDir2 = path.join(base2, "agent");
    const cwd2 = path.join(base2, "project");
    fs.mkdirSync(cwd2, { recursive: true });
    writeExt(agentDir2, "ext-a");
    const loader = new DefaultResourceLoader({
      cwd: cwd2, agentDir: agentDir2,
      settingsManager: SettingsManager.create(cwd2, agentDir2),
    });
    await loader.reload();
    const { session } = await createAgentSession({
      model: stubModel as never,
      tools: [],
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory(),
    });
    await session.prompt("/plan");
    expect(fs.existsSync(path.join(agentDir2, "ran-ext-a.txt"))).toBe(true);
    fs.rmSync(base2, { recursive: true, force: true });
  }, 30000);
});
