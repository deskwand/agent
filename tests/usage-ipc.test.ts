import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

const repo = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(repo, p), "utf-8");

describe("usage.query IPC contract", () => {
  it("is declared on the ClientEvent union", () => {
    expect(read("src/renderer/types/index.ts")).toContain(
      'type: "usage.query"',
    );
  });

  it("is allowlisted in preload", () => {
    expect(read("src/preload/index.ts")).toContain('"usage.query"');
  });

  it("is handled in the main process and backfills before answering", () => {
    const text = read("src/main/index.ts");
    expect(text).toContain('case "usage.query"');
    expect(text).toContain("ensureUsageBackfilled");
  });

  it("validates the range payload instead of trusting the cast", () => {
    const text = read("src/main/index.ts");
    expect(text).toContain("const requested = event.payload.range as string;");
    expect(text).toContain('requested === "1d"');
    expect(text).toContain('requested === "90d"');
    // Unknown ids must fall back rather than reach queryUsage, whose NaN cutoff
    // would render an all-zero page with no error.
    expect(text).toMatch(/\?\s*requested\s*\n?\s*:\s*"30d";/);
  });

  it("resolves the sessions root from userData, not a hardcoded home path", () => {
    const text = read("src/main/index.ts");
    expect(text).toContain(
      'const USAGE_SESSIONS_ROOT = join(app.getPath("userData"), "pi-sessions");',
    );
  });
});
