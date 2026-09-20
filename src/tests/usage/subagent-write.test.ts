import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

const repo = path.resolve(__dirname, "../../..");
const read = (p: string) => fs.readFileSync(path.join(repo, p), "utf-8");

/**
 * 子代理用量不再从 `tool_result.usage` 写：那是全局池化的无主聚合（无 model、
 * drain 落在最先结束的包装工具上）。现在逐条从子会话文件导入 —— 断言这条链存在，
 * 并断言旧链彻底消失，防止有人把它加回来造成重复计数。
 */
describe("subagent usage source", () => {
  it("no longer records from the pooled tool result", () => {
    const runner = read("src/main/agent/agent-runner.ts");
    expect(runner).not.toContain("buildSubagentUsageRecord");
    expect(runner).not.toContain(
      "(event.result as { usage?: unknown } | undefined)?.usage",
    );
  });

  it("wires the child-session backfill into the app", () => {
    const index = read("src/main/index.ts");
    expect(index).toContain("backfillSubagentUsageFromSessions(");
    expect(index).toContain("SUBAGENT_SESSIONS_ROOT");
    expect(index).toContain("removePooledSubagentRows(");
  });
});
