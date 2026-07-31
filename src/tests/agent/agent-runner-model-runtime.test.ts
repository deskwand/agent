import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Migration-safety static analysis only; runtime behavior is covered by the
// Electron OAuth and HTTP smoke test.
const agentRunnerContent = readFileSync(
  path.resolve(process.cwd(), "src/main/agent/agent-runner.ts"),
  "utf8",
);

describe("AgentRunner ModelRuntime integration", () => {
  it("uses the shared ModelRuntime without masking OAuth credentials", () => {
    expect(agentRunnerContent).toContain(
      'import { getSharedModelRuntime } from "./shared-model-runtime"',
    );
    expect(agentRunnerContent).toContain(
      "const modelRuntime = await getSharedModelRuntime()",
    );
    expect(agentRunnerContent).toContain("modelRuntime,");
    expect(agentRunnerContent).toContain('provider !== "oauth"');
    expect(agentRunnerContent).not.toContain("ensureFreshOAuthToken");
    expect(agentRunnerContent).not.toContain("ModelRegistry.inMemory");
    expect(agentRunnerContent).not.toContain("authStorage,");
  });
});
