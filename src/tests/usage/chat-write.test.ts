import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

const SRC = path.join(__dirname, "../../main/agent/agent-runner.ts");
const src = () => fs.readFileSync(SRC, "utf-8");

describe("chat usage write point", () => {
  it("delegates the mapping to the pure builder", () => {
    const text = src();
    expect(text).toContain("buildChatUsageRecord(");
    expect(text).toMatch(/recordUsage\(\s*getDatabase\(\)\.raw,/);
    expect(text).toContain("buildChatUsageRecord(");
    // 池化子代理构造器已删（改由子会话文件回填），不得再被 import
    expect(text).not.toContain("buildSubagentUsageRecord");
  });

  it("passes the SDK message plus the session model/provider as fallback", () => {
    expect(src()).toContain(
      "{ provider: piModel.provider, model: session.model }",
    );
  });

  it("records outside the render guard so billed-but-empty messages count", () => {
    const text = src();
    const guard = text.indexOf("if (contentBlocks.length > 0) {");
    const record = text.indexOf("buildChatUsageRecord(");
    expect(guard).toBeGreaterThan(-1);
    expect(record).toBeGreaterThan(-1);
    expect(record).toBeLessThan(guard);
  });

  it("never lets a failed insert break the chat stream", () => {
    expect(src()).toContain(
      'logWarn("[AgentRunner] usage record failed:", error)',
    );
  });
});
