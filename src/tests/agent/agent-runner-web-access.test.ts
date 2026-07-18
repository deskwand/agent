import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const runnerSource = readFileSync(
  resolve(process.cwd(), "src/main/agent/agent-runner.ts"),
  "utf8",
);
const sessionManagerSource = readFileSync(
  resolve(process.cwd(), "src/main/session/session-manager.ts"),
  "utf8",
);
const mainIndexSource = readFileSync(
  resolve(process.cwd(), "src/main/index.ts"),
  "utf8",
);

describe("AgentRunner Web Access registration", () => {
  it("registers native Web Access tools instead of inline web_fetch", () => {
    expect(runnerSource).toContain("createWebAccessTools({");
    expect(runnerSource).not.toContain('name: "web_fetch"');
    expect(runnerSource).toContain("this.buildInternalBrowserTools()");
  });

  it("redacts every stored Web Access API key before config logging", () => {
    for (const field of [
      "openai.apiKey",
      "gemini.apiKey",
      "exaApiKey",
      "braveApiKey",
      "parallelApiKey",
      "tavilyApiKey",
      "perplexityApiKey",
    ]) {
      const [group, key] = field.split(".");
      expect(mainIndexSource).toContain(
        key
          ? `apiKey: normalized.${group}.apiKey ? "***" : ""`
          : `${group}: normalized.${group} ? "***" : ""`,
      );
    }
  });

  it("cleans all Web Access temporary files during app shutdown", () => {
    expect(mainIndexSource).toContain("await removeAllWebAccessTempDirs()");
  });

  it("clears Web Access state for deleted sessions", () => {
    const matches = sessionManagerSource.match(
      /webAccessCache\.clearSession\(sessionId\)/g,
    );
    expect(matches?.length).toBeGreaterThanOrEqual(2);
    expect(sessionManagerSource).toContain(
      "await removeWebAccessTempDir(sessionId)",
    );
  });
});
