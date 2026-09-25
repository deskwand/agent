import { describe, expect, it } from "vitest";
import {
  buildBackgroundAgentRows,
  findTurnEndMessageIdForToolCall,
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

describe("buildBackgroundAgentRows", () => {
  const labelFor = (step: { toolName: string; args: Record<string, string> }) =>
    `${step.toolName}:${step.args.path ?? step.args.command ?? ""}`;

  // 注意：本文件模块级已有一个同名的 `activity(parentToolCallId, agentId, name?)`，
  // 这里故意换个名字，避免遮蔽后阅读时误用。
  function rowActivity(
    toolCallId: string,
    over: Partial<SubagentActivity> = {},
  ): SubagentActivity {
    return {
      sessionId: "s1",
      agentId: `agent-${toolCallId}`,
      parentToolCallId: toolCallId,
      status: "running",
      steps: [],
      stats: { toolUses: 0, durationMs: 100 },
      ...over,
    };
  }

  it("只收 background 的，运行中排在前，名字在中文界面走映射", () => {
    const rows = buildBackgroundAgentRows(
      {
        "call-1": rowActivity("call-1", {
          background: true,
          name: "hopper",
          type: "Explore",
          description: "find bug",
          status: "completed",
          steps: [
            {
              id: "t1",
              toolName: "read",
              args: { path: "src/a.ts" },
              done: true,
              durationMs: 300,
            },
          ],
          stats: { toolUses: 3, durationMs: 5000 },
        }),
        "call-2": rowActivity("call-2", {
          background: true,
          name: "curie",
          status: "running",
        }),
        "call-3": rowActivity("call-3", { background: false }),
      },
      labelFor,
      "zh-CN",
    );

    expect(rows.map((row) => row.toolCallId)).toEqual(["call-2", "call-1"]);
    expect(rows[1].name).toBe("霍珀");
    expect(rows[1].type).toBe("Explore");
    expect(rows[1].currentLabel).toBe("read:src/a.ts");
    expect(rows[1].stepCount).toBe(3);
    expect(rows[1].durationMs).toBe(5000);
    expect(rows[0].name).toBe("居里");
  });

  it("优先用 current 作为当前动作；没有快照时返回空数组", () => {
    const rows = buildBackgroundAgentRows(
      {
        "call-1": rowActivity("call-1", {
          background: true,
          current: {
            id: "t9",
            toolName: "bash",
            args: { command: "npm test" },
            done: false,
          },
          steps: [
            {
              id: "t1",
              toolName: "read",
              args: { path: "old.ts" },
              done: true,
            },
          ],
        }),
      },
      labelFor,
      "en",
    );
    expect(rows[0].currentLabel).toBe("bash:npm test");
    expect(buildBackgroundAgentRows(undefined, labelFor, "en")).toEqual([]);
  });
});

describe("findTurnEndMessageIdForToolCall", () => {
  const messages = [
    { id: "u1", role: "user", turnId: "t1", content: [] },
    {
      id: "a1",
      role: "assistant",
      turnId: "t1",
      content: [{ type: "tool_use", id: "call-9" }],
    },
    { id: "a2", role: "assistant", turnId: "t1", content: [] },
    { id: "u2", role: "user", turnId: "t2", content: [] },
  ];

  it("返回该回合最后一条 assistant 消息（process summary 就挂在那里）", () => {
    expect(findTurnEndMessageIdForToolCall(messages, "call-9")).toBe("a2");
  });

  it("找不到 / 空输入都返回 null", () => {
    expect(findTurnEndMessageIdForToolCall(messages, "missing")).toBeNull();
    expect(findTurnEndMessageIdForToolCall(messages, "")).toBeNull();
    expect(findTurnEndMessageIdForToolCall(undefined, "call-9")).toBeNull();
  });

  it("回合末是纯工具消息时，跳过它（渲染前被合并，自己没有 DOM 节点）", () => {
    const withToolTail = [
      { id: "u1", role: "user", turnId: "t1", content: [] },
      {
        id: "a1",
        role: "assistant",
        turnId: "t1",
        content: [{ type: "tool_use", id: "call-9" }],
      },
      {
        id: "a2",
        role: "assistant",
        turnId: "t1",
        content: [{ type: "tool_result", toolUseId: "call-9" }],
      },
      { id: "u2", role: "user", turnId: "t2", content: [] },
    ];
    // a1 自己没有 text 块、但它是回合内第一条 assistant → 保留节点；a2 被并进 a1
    expect(findTurnEndMessageIdForToolCall(withToolTail, "call-9")).toBe("a1");
  });

  it("tool_use 所在消息被合并时，返回它的合并目标", () => {
    const merged = [
      { id: "u1", role: "user", turnId: "t1", content: [] },
      {
        id: "a1",
        role: "assistant",
        turnId: "t1",
        content: [{ type: "text" }],
      },
      {
        id: "a2",
        role: "assistant",
        turnId: "t1",
        content: [{ type: "tool_use", id: "call-9" }],
      },
      { id: "u2", role: "user", turnId: "t2", content: [] },
    ];
    expect(findTurnEndMessageIdForToolCall(merged, "call-9")).toBe("a1");
  });

  it("没有 turnId 时按「遇到下一条 user 消息为止」划回合", () => {
    const legacy = [
      { id: "u1", role: "user", content: [] },
      { id: "a1", role: "assistant", content: [{ type: "text" }] },
      {
        id: "a2",
        role: "assistant",
        content: [{ type: "tool_use", id: "call-9" }],
      },
      { id: "u2", role: "user", content: [] },
    ];
    // a2 是纯工具消息且回合内前面有 a1 → 被并走；保留节点的是 a1
    expect(findTurnEndMessageIdForToolCall(legacy, "call-9")).toBe("a1");
  });
});
