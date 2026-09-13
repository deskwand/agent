import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ensureSubagentUsageReporting } from "../../main/usage/subagent-usage-setting";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "deskwand-subagents-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const file = () => path.join(dir, "subagents.json");
const read = () => JSON.parse(fs.readFileSync(file(), "utf-8"));

describe("ensureSubagentUsageReporting", () => {
  it("creates the file when missing", () => {
    expect(ensureSubagentUsageReporting(dir)).toBe(true);
    expect(read()).toEqual({ reportUsage: true });
  });

  it("merges into an existing file without dropping other keys", () => {
    fs.writeFileSync(file(), JSON.stringify({ fallbackSubagent: "explore" }));
    ensureSubagentUsageReporting(dir);
    expect(read()).toEqual({ fallbackSubagent: "explore", reportUsage: true });
  });

  it("is a no-op when already enabled", () => {
    fs.writeFileSync(file(), JSON.stringify({ reportUsage: true }));
    const before = fs.statSync(file()).mtimeMs;
    expect(ensureSubagentUsageReporting(dir)).toBe(false);
    expect(fs.statSync(file()).mtimeMs).toBe(before);
  });

  it("keeps the file intact when it is malformed", () => {
    fs.writeFileSync(file(), "{ not json");
    expect(ensureSubagentUsageReporting(dir)).toBe(false);
    expect(fs.readFileSync(file(), "utf-8")).toBe("{ not json");
  });
});
