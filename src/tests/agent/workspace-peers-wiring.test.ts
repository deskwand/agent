import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const MAIN = path.join(__dirname, "../../main");

function read(relative: string): string {
  return fs.readFileSync(path.join(MAIN, relative), "utf-8");
}

describe("workspace_peers 接线", () => {
  it("agent-runner 在工具开始时记录活动，并按宿主注入注册工具", () => {
    const src = read("agent/agent-runner.ts");
    expect(src).toContain("this._recordToolActivity?.(");
    expect(src).toContain("event.args");
    expect(src).toContain("createWorkspacePeersTool(");
    expect(src).toContain("this._listWorkspacePeers");
    // 沙盒会话的 effectiveCwd 是 Guest 路径，拿它跟 peers 的宿主 cwd 比永远不等 ⇒ 假阴性
    expect(src).toContain("selfCwd: session.cwd || effectiveCwd");
    expect(src).toContain("recordToolActivity?:");
    expect(src).toContain("listWorkspacePeers?:");
  });

  it("session-manager 维护内存活动表并实现两个方法", () => {
    const src = read("session/session-manager.ts");
    expect(src).toContain("private sessionActivity");
    expect(src).toContain("recordToolActivity(");
    expect(src).toContain("this.sessionActivity.set(sessionId");
    expect(src).toContain("listWorkspacePeers(");
    expect(src).toContain("selectWorkspacePeerIds(");
    expect(src).toContain("this.sessionActivity.delete(sessionId)");
  });

  it("工具带三条 prompt guideline", async () => {
    const { createWorkspacePeersTool } =
      await import("../../main/agent/tools/workspace-peers");
    const tool = createWorkspacePeersTool({
      selfSessionId: "self",
      selfCwd: "/work",
      listPeers: () => ({ peers: [], omittedCount: 0 }),
    });
    expect(tool.promptGuidelines).toHaveLength(3);
    expect(tool.parameters).toBeDefined();
  });
});
