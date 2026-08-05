import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const agentRunnerPath = path.resolve(
  process.cwd(),
  "src/main/agent/agent-runner.ts",
);
const agentRunnerContent = readFileSync(agentRunnerPath, "utf8");

describe("AgentRunner cold-start manual compaction", () => {
  it("restores a pi session from the persisted JSONL when no in-memory session exists", () => {
    expect(agentRunnerContent).toContain("getSessionInfo?.(sessionId)");
    expect(agentRunnerContent).toContain(
      "createColdStartSessionForCompaction(",
    );
    expect(agentRunnerContent).toContain("fs.existsSync(piSessionFile)");
    expect(agentRunnerContent).toContain(
      "piSessionFileContainsLegacyMemoryContext(piSessionFile)",
    );
  });

  it("builds the restored session without tools (summarization only)", () => {
    expect(agentRunnerContent).toContain("PiSessionManager.open(restoreFile)");
    expect(agentRunnerContent).toContain('noTools: "all"');
    expect(agentRunnerContent).toContain("resolveCompactionSettingsForWindow(");
  });

  it("disposes the cold-restored session after compaction", () => {
    expect(agentRunnerContent).toContain("tempSession === cached.session");
    expect(agentRunnerContent).toContain("dispose error on cold-start compact");
  });

  it("reports 'Nothing to compact' as skipped instead of failed", () => {
    expect(agentRunnerContent).toContain(
      'errorMessage.includes("Nothing to compact")',
    );
    expect(agentRunnerContent).toContain(
      '"[AgentRunner] Nothing to compact for session:"',
    );
  });

  it("skips cold-start compact when compaction is disabled for the window", () => {
    expect(agentRunnerContent).toContain("if (!compactionSettings.enabled)");
    expect(agentRunnerContent).toContain(
      '"[AgentRunner] Compaction disabled for small context window:"',
    );
  });

  it("guards against double-trigger while a compaction is in flight", () => {
    expect(agentRunnerContent).toContain("this.compactInFlight.has(sessionId)");
    expect(agentRunnerContent).toContain(
      '"[AgentRunner] Compaction already in flight for session:"',
    );
  });

  it("supports aborting cold-start compactions", () => {
    expect(agentRunnerContent).toContain(
      "const coldStart = this.coldStartCompactionSessions.get(sessionId);",
    );
    expect(agentRunnerContent).toContain("cached?.session ?? coldStart");
  });

  it("emits failed when the cold-start restore throws", () => {
    expect(agentRunnerContent).toContain(
      '"[AgentRunner] Failed to restore pi session for compaction:"',
    );
    expect(agentRunnerContent).toContain(
      'payload: { sessionId, status: "failed" }',
    );
  });

  it("releases the ModelRuntime created by a cold-start compact", () => {
    expect(agentRunnerContent).toContain("createdRuntime");
    expect(agentRunnerContent).toContain(
      "unregisterSessionModelRuntime(cached.createdRuntime)",
    );
  });

  it("wires getSessionInfo through SessionManager", () => {
    const sessionManagerPath = path.resolve(
      process.cwd(),
      "src/main/session/session-manager.ts",
    );
    const sessionManagerContent = readFileSync(sessionManagerPath, "utf8");
    expect(sessionManagerContent).toContain(
      "getSessionInfo: (sessionId: string) => this.loadSession(sessionId)",
    );
  });
});
