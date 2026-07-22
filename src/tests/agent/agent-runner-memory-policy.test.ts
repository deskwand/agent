import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const runnerPath = join(__dirname, "../../main/agent/agent-runner.ts");

function source(): string {
  return readFileSync(runnerPath, "utf8");
}

describe("AgentRunner memory policy integration", () => {
  it("adds extension system prompt suffixes to the SDK system prompt", () => {
    const text = source();
    const appendPromptIndex = text.indexOf("const coworkAppendPrompt = [");
    const suffixIndex = text.indexOf(
      "const appendSystemPrompt = systemPromptSuffix",
      appendPromptIndex,
    );
    const resourceLoaderIndex = text.indexOf("new DefaultResourceLoader({");

    expect(appendPromptIndex).toBeGreaterThan(-1);
    expect(suffixIndex).toBeGreaterThan(appendPromptIndex);
    expect(suffixIndex).toBeLessThan(resourceLoaderIndex);
    expect(text.slice(resourceLoaderIndex)).toContain("appendSystemPrompt,");
    expect(text).not.toContain(
      "contextualPrompt = `${extensionResult.systemPromptSuffix",
    );
  });

  it("invalidates cached SDK sessions when extension policy changes", () => {
    const text = source();
    const signatureIndex = text.indexOf("const extensionSignature =");
    const comparisonIndex = text.indexOf(
      "cachedSession.extensionSignature !== extensionSignature",
    );
    const contextualPromptIndex = text.indexOf(
      "let contextualPrompt = prompt;",
    );
    const cacheIndex = text.indexOf("extensionSignature,", comparisonIndex + 1);

    expect(signatureIndex).toBeGreaterThan(-1);
    expect(text.slice(signatureIndex, comparisonIndex)).toContain(
      "MEMORY_POLICY_SCHEMA_VERSION",
    );
    expect(text.slice(signatureIndex, comparisonIndex)).toContain(
      "systemPromptSuffix",
    );
    expect(comparisonIndex).toBeGreaterThan(signatureIndex);
    expect(comparisonIndex).toBeLessThan(contextualPromptIndex);
    expect(cacheIndex).toBeGreaterThan(comparisonIndex);
  });

  it("rebuilds instead of reopening unsafe legacy session files", () => {
    const text = source();

    expect(text).toContain(
      "export { piSessionFileContainsLegacyMemoryContext };",
    );
    expect(text).toContain("let sessionFileForRun = piSessionFile;");
    expect(text).toContain("PiSessionManager.open(sessionFileForRun)");
    expect(text).not.toContain("PiSessionManager.open(piSessionFile)");
    expect(
      text.match(
        /piSessionFileContainsLegacyMemoryContext\(sessionFileForRun\)/g,
      ),
    ).toHaveLength(2);
  });
});
