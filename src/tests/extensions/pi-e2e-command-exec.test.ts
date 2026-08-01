import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createAgentSession } from "@earendil-works/pi-coding-agent";
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";

describe("SDK command execution chain (e2e)", () => {
  let base: string;
  let agentDir: string;
  let cwd: string;
  let marker: string;

  beforeAll(async () => {
    base = fs.mkdtempSync(path.join(os.homedir(), ".pi-e2e-cmd-"));
    agentDir = path.join(base, "agent");
    cwd = path.join(base, "project");
    marker = path.join(base, "handler-ran.txt");
    fs.mkdirSync(path.join(agentDir, "extensions", "probe"), { recursive: true });
    fs.mkdirSync(cwd, { recursive: true });
    fs.writeFileSync(
      path.join(agentDir, "extensions", "probe", "index.ts"),
      `import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export default function (pi: ExtensionAPI) {
  pi.registerCommand("probe", {
    description: "probe command",
    handler: async () => {
      require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran");
    },
  });
}`,
    );
  });

  afterAll(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  it("prompt('/probe') executes the extension handler without calling the model", async () => {
    const loader = new DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager: SettingsManager.create(cwd, agentDir),
    });
    await loader.reload();
    const extResult = (
      loader as unknown as { extensionsResult?: { extensions: unknown[]; errors?: unknown[] } }
    ).extensionsResult;
    expect(extResult?.extensions.length ?? 0).toBeGreaterThan(0);
    expect(extResult?.errors ?? []).toHaveLength(0);

    const stubModel = {
      id: "stub",
      name: "stub",
      api: "anthropic-messages" as const,
      provider: "anthropic" as const,
      baseUrl: "http://localhost:1",
      reasoning: false,
      input: ["text"] as const,
      cost: { input: 0, output: 0 },
      contextWindow: 1000,
      maxTokens: 100,
    };

    const { session } = await createAgentSession({
      model: stubModel as never,
      tools: [],
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory(),
    });

    // Command path must not reach the model: prompt() returns void because
    // the handler is self-contained (registered via pi.registerCommand).
    const result = await session.prompt("/probe");
    expect(fs.existsSync(marker)).toBe(true); // handler ran
    expect(result).toBeUndefined(); // no LLM invocation
  }, 30000);
});
