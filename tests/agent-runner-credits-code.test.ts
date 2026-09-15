import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const runnerPath = path.resolve(
  process.cwd(),
  "src/main/agent/agent-runner.ts",
);
const typesPath = path.resolve(process.cwd(), "src/renderer/types/index.ts");

describe("Agent runner credits error propagation", () => {
  it("attaches INSUFFICIENT_BALANCE code in all error message paths", () => {
    const source = fs.readFileSync(runnerPath, "utf8");
    const occurrences =
      source.split("code: detectInsufficientCredits(errorText)").length - 1;
    expect(occurrences).toBe(3);
    expect(source).toContain('? "INSUFFICIENT_BALANCE"');
  });

  it("Message interface carries optional code field", () => {
    const source = fs.readFileSync(typesPath, "utf8");
    expect(source).toContain("code?: string;");
  });
});
