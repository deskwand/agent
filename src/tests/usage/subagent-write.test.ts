import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

const SRC = path.join(__dirname, "../../main/agent/agent-runner.ts");
const src = () => fs.readFileSync(SRC, "utf-8");

describe("subagent usage write point", () => {
  it("reads usage off the tool result and delegates to the builder", () => {
    const text = src();
    expect(text).toContain("buildSubagentUsageRecord(");
    expect(text).toContain(
      "(event.result as { usage?: unknown } | undefined)?.usage",
    );
    expect(text).toContain("recordUsage(getDatabase().raw, subagentRecord)");
  });

  it("never lets a failed insert break tool handling", () => {
    expect(src()).toContain('"[AgentRunner] subagent usage record failed:"');
  });
});
