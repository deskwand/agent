import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

const SRC = path.join(__dirname, "../../main/agent/tools/vision-describe.ts");
const src = () => fs.readFileSync(SRC, "utf-8");

describe("vision usage capture", () => {
  it("reads the raw usage object from the protocol responses", () => {
    const text = src();
    expect(text).toContain("usage: data.usage");
    expect(text).toContain("usage: data.usageMetadata");
  });

  it("records through the shared normalizer and builder", () => {
    const text = src();
    expect(text).toContain('"vision",');
    expect(text).toContain("normalizeTokenUsage(");
    expect(text).toContain("buildAuxUsageRecord(");
  });

  it("accepts a sessionId for attribution", () => {
    expect(src()).toContain("sessionId?: string");
  });

  it("does not fabricate usage for the cloud endpoint that returns only text", () => {
    const text = src();
    expect(text).toContain(
      "const data = (await res.json()) as { text?: string };",
    );
    expect(text).toContain("no usage field");
  });
});
