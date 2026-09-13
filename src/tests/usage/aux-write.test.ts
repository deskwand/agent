import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

const read = (p: string) =>
  fs.readFileSync(path.join(__dirname, "../../main", p), "utf-8");

describe("aux usage write points", () => {
  it("runPiAiOneShot returns usage", () => {
    const text = read("agent/agent-sdk-one-shot.ts");
    expect(text).toContain(
      "usage: normalizeTokenUsage(response.usage, resolvedModel.provider)",
    );
    expect(text).toContain("usage?: TokenUsage;");
  });

  it("title generation records with purpose 'title' and an optional session", () => {
    const text = read("agent/agent-sdk-one-shot.ts");
    expect(text).toContain('"title",');
    expect(text).toContain("sessionId?: string");
  });

  it("memory extraction records through the shared aux recorder", () => {
    const text = read("memory/memory-llm-client.ts");
    expect(text).toContain("recordAuxUsage(");
    expect(text).toContain('"memory",');
  });

  it("probe records with purpose 'probe'", () => {
    expect(read("agent/agent-sdk-one-shot.ts")).toContain('"probe",');
  });

  it("funnels every aux row through the shared builder", () => {
    expect(read("agent/agent-sdk-one-shot.ts")).toContain(
      "buildAuxUsageRecord(",
    );
  });

  it("threads the session id into title generation for attribution", () => {
    expect(read("session/session-manager.ts")).toContain(
      "generateTitleWithAgentSdk(titlePrompt, titleConfig, sessionId)",
    );
  });
});
