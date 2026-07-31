import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("runtime agent attachments wrapper registration", () => {
  it("passes AgentExecutor content to SessionManager's fifth argument", () => {
    const source = readFileSync(resolve("src/main/index.ts"), "utf8");
    expect(source).toMatch(
      /sessionManager\.startSession\(\s*title,\s*prompt,\s*cwd,\s*undefined,\s*content/,
    );
  });

  it("processes empty inline files instead of treating them as absent", () => {
    const source = readFileSync(
      resolve("src/main/session/session-manager.ts"),
      "utf8",
    );
    expect(source).toContain("inlineDataBase64 !== undefined");
  });

  it("uses collision-resistant paths for inline file attachments", () => {
    const source = readFileSync(
      resolve("src/main/session/session-manager.ts"),
      "utf8",
    );
    expect(source).toMatch(
      /inlineDataBase64 !== undefined[\s\S]*uuidv4\(\)/,
    );
  });
});
