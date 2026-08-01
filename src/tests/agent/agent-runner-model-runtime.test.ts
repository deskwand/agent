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
  it("routes auth through per-session ModelRuntime without masking OAuth credentials", () => {
    expect(agentRunnerContent).toContain('from "./shared-model-runtime"');
    expect(agentRunnerContent).toContain("registerSessionModelRuntime");
    expect(agentRunnerContent).toContain("unregisterSessionModelRuntime");
    expect(agentRunnerContent).toContain(
      "const modelRuntime = await getOrCreateSessionRuntime(",
    );
    expect(agentRunnerContent).toContain(
      "sessionModelRuntimes.delete(sessionId)",
    );
    // 锁定 round-1 修复：unregister 与 map delete 必须成对相邻（防回归）
    expect(agentRunnerContent).toMatch(
      /unregisterSessionModelRuntime\(runtime\);\s+this\.sessionModelRuntimes\.delete\(sessionId\);/,
    );
    expect(agentRunnerContent).toContain("sessionModelRuntimes.get(oldestKey)");
    expect(agentRunnerContent).toContain("modelRuntime,");
    expect(agentRunnerContent).toContain('provider !== "oauth"');
    expect(agentRunnerContent).not.toContain("ensureFreshOAuthToken");
    expect(agentRunnerContent).not.toContain("ModelRegistry.inMemory");
    expect(agentRunnerContent).not.toContain("authStorage,");
  });
});
