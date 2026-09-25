import { describe, expect, it } from "vitest";
import {
  resolveSubagentName,
  splitSubagentOutput,
} from "../../renderer/utils/subagent-card";
import type { SubagentActivity } from "../../shared/subagent-activity";

function activity(
  parentToolCallId: string,
  agentId: string,
  name?: string,
): SubagentActivity {
  return {
    sessionId: "s1",
    agentId,
    parentToolCallId,
    name,
    status: "completed",
    steps: [],
    stats: { toolUses: 0, durationMs: 0 },
  };
}

describe("resolveSubagentName", () => {
  // key 是 Agent 工具调用 id，值里的 agentId 才是工具参数里的那个 id。
  const activities = {
    "call-1": activity("call-1", "9c5ae021-6450-400", "hopper"),
    "call-2": activity("call-2", "aaaa-bbbb", undefined),
  };

  it("用 agentId 命中时取其别名（中文界面走映射）", () => {
    expect(resolveSubagentName("9c5ae021-6450-400", activities, "zh-CN")).toBe(
      "霍珀",
    );
    expect(resolveSubagentName("9c5ae021-6450-400", activities, "en")).toBe(
      "hopper",
    );
  });

  it("传别名（带或不带 @）时原样沿用", () => {
    expect(resolveSubagentName("hopper", activities, "en")).toBe("hopper");
    expect(resolveSubagentName("@hopper", activities, "en")).toBe("hopper");
  });

  it("命中但没有别名时回落 agentId", () => {
    expect(resolveSubagentName("aaaa-bbbb", activities, "en")).toBe(
      "aaaa-bbbb",
    );
  });

  it("空值 / 未命中 / 无快照都不抛错", () => {
    expect(resolveSubagentName(undefined, activities, "zh")).toBe("");
    expect(resolveSubagentName("  ", activities, "zh")).toBe("");
    expect(resolveSubagentName("unknown-id", activities, "zh")).toBe(
      "unknown-id",
    );
    expect(resolveSubagentName("unknown-id", undefined, "zh")).toBe(
      "unknown-id",
    );
  });
});

describe("splitSubagentOutput", () => {
  const withHeader = [
    "Agent: 9c5ae021-6450-400",
    "Type: general-purpose | Status: completed | Tool uses: 9",
    "Description: 全量文件清单与体量分析",
    "",
    "# 报告标题",
    "- 一条",
  ].join("\n");

  it("以 Agent: 开头且含空行时按首个空行拆分", () => {
    const { header, body } = splitSubagentOutput(withHeader);
    expect(header).toContain("Agent: 9c5ae021-6450-400");
    expect(header).toContain("Description: 全量文件清单与体量分析");
    expect(header).not.toContain("报告标题");
    expect(body.startsWith("# 报告标题")).toBe(true);
  });

  it("不以 Agent: 开头时整块当正文（steer 回执 / Agent failed 走这条）", () => {
    const { header, body } = splitSubagentOutput("Sent to @hopper");
    expect(header).toBeUndefined();
    expect(body).toBe("Sent to @hopper");
  });

  it("有 Agent: 头但没有空行时也整块当正文", () => {
    const { header, body } = splitSubagentOutput("Agent: x\nType: y");
    expect(header).toBeUndefined();
    expect(body).toBe("Agent: x\nType: y");
  });
});
