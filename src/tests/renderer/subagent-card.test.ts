import { describe, expect, it } from "vitest";
import {
  buildBackgroundAgentRows,
  collectCurrentRoundToolCallIds,
  findToolCallOwnerMessageId,
  resolveSubagentName,
  splitSubagentOutput,
  stripUpstreamAgentStats,
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

  it("组内最新的排在最前（面板贴底向上长，首行最显眼）", () => {
    const rows = buildBackgroundAgentRows(
      {
        "call-old": rowActivity("call-old", {
          background: true,
          name: "euler",
        }),
        "call-new": rowActivity("call-new", {
          background: true,
          name: "darwin",
        }),
      },
      labelFor,
      "en",
    );
    expect(rows.map((row) => row.toolCallId)).toEqual(["call-new", "call-old"]);
  });

  it("运行中的不在本轮也保留；已完成的仅保留本轮的", () => {
    const rows = buildBackgroundAgentRows(
      {
        "old-done": rowActivity("old-done", {
          background: true,
          status: "completed",
        }),
        "old-running": rowActivity("old-running", {
          background: true,
          status: "running",
        }),
        "new-done": rowActivity("new-done", {
          background: true,
          status: "completed",
        }),
      },
      labelFor,
      "en",
      new Set(["new-done"]),
    );
    expect(rows.map((row) => row.toolCallId).sort()).toEqual([
      "new-done",
      "old-running",
    ]);
  });

  it("本轮已完成的至多保留最近 5 条，运行中不受限", () => {
    const activities: Record<string, SubagentActivity> = {};
    for (let i = 0; i < 7; i++) {
      activities[`done-${i}`] = rowActivity(`done-${i}`, {
        background: true,
        status: "completed",
      });
    }
    activities.live = rowActivity("live", {
      background: true,
      status: "running",
    });

    const rows = buildBackgroundAgentRows(
      activities,
      labelFor,
      "en",
      new Set(Object.keys(activities)),
    );
    const finished = rows.filter((row) => row.status !== "running");
    expect(finished).toHaveLength(5);
    // 组内最新在前 → 留下的是最后写入的那 5 条
    expect(finished.map((row) => row.toolCallId)).toEqual([
      "done-6",
      "done-5",
      "done-4",
      "done-3",
      "done-2",
    ]);
    expect(rows.filter((row) => row.status === "running")).toHaveLength(1);
  });

  it("空集合（本轮还没有任何工具调用）会收窄掉已完成的，但不影响运行中", () => {
    const rows = buildBackgroundAgentRows(
      {
        "old-done": rowActivity("old-done", {
          background: true,
          status: "completed",
        }),
        "old-running": rowActivity("old-running", {
          background: true,
          status: "running",
        }),
      },
      labelFor,
      "en",
      new Set(),
    );
    expect(rows.map((row) => row.toolCallId)).toEqual(["old-running"]);
  });

  it("集合为 null 或未传时不过滤（判不出来不误藏）", () => {
    const activities = {
      "old-done": rowActivity("old-done", {
        background: true,
        status: "completed",
      }),
    };
    expect(
      buildBackgroundAgentRows(activities, labelFor, "en", null).map(
        (row) => row.toolCallId,
      ),
    ).toEqual(["old-done"]);
    expect(
      buildBackgroundAgentRows(activities, labelFor, "en").map(
        (row) => row.toolCallId,
      ),
    ).toEqual(["old-done"]);
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

describe("findToolCallOwnerMessageId", () => {
  it("跳到那条工具调用所属的消息（组从这里开始），而不是回合末", () => {
    // 真实形态：m1 = 文本 + spawn 的 tool_use；m2 = 纯工具（结果）会被并进 m1；
    // m3 = 本轮最后一条 assistant（它的顶部并没有这组卡片）
    const messages = [
      { id: "u2", role: "user", turnId: "t2", content: [] },
      {
        id: "m1",
        role: "assistant",
        turnId: "t2",
        content: [{ type: "text" }, { type: "tool_use", id: "call-9" }],
      },
      {
        id: "m2",
        role: "assistant",
        turnId: "t2",
        content: [{ type: "tool_result", toolUseId: "call-9" }],
      },
      {
        id: "m3",
        role: "assistant",
        turnId: "t2",
        content: [{ type: "text" }],
      },
    ];
    expect(findToolCallOwnerMessageId(messages, "call-9")).toBe("m1");
  });

  it("tool_use 所在消息是纯工具消息时，跳到它的合并目标", () => {
    const messages = [
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
    expect(findToolCallOwnerMessageId(messages, "call-9")).toBe("a1");
  });

  it("纯工具且回合内前面没有 assistant 时，就是它自己（合并时会保留原样）", () => {
    const messages = [
      { id: "u1", role: "user", turnId: "t1", content: [] },
      {
        id: "a1",
        role: "assistant",
        turnId: "t1",
        content: [{ type: "tool_use", id: "call-9" }],
      },
    ];
    expect(findToolCallOwnerMessageId(messages, "call-9")).toBe("a1");
  });

  it("回合边界用 turnId 判定（与渲染层合并的判据一致）", () => {
    const messages = [
      { id: "u1", role: "user", content: [] },
      { id: "a1", role: "assistant", content: [{ type: "text" }] },
      {
        id: "a2",
        role: "assistant",
        content: [{ type: "tool_use", id: "call-9" }],
      },
      { id: "u2", role: "user", content: [] },
    ];
    expect(findToolCallOwnerMessageId(messages, "call-9")).toBe("a1");
  });

  it("连串纯工具消息里，返回的是合并后仍然存在的那条（否则点击会静默失效）", () => {
    // [a1 文本, a2 纯工具, a3 纯工具且含本次 tool_use]：a2/a3 都会并进 a1，只有 a1 有 DOM 节点
    const messages = [
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
        content: [{ type: "tool_result", toolUseId: "other" }],
      },
      {
        id: "a3",
        role: "assistant",
        turnId: "t1",
        content: [{ type: "tool_use", id: "call-9" }],
      },
    ];
    const target = findToolCallOwnerMessageId(messages, "call-9");
    expect(target).toBe("a1");

    // 不变量：返回值必须能扛过渲染层的合并（复刻 ChatView.tsx:700-746）
    const survivors: string[] = [];
    for (const message of messages) {
      const blocks = message.content as Array<{ type?: string }>;
      const pureTool =
        message.role === "assistant" &&
        blocks.length > 0 &&
        !blocks.some((block) => block?.type === "text");
      let merged = false;
      if (pureTool) {
        for (let j = survivors.length - 1; j >= 0; j--) {
          const prev = messages.find((m) => m.id === survivors[j]);
          if (prev?.role === "assistant" && prev.turnId === message.turnId) {
            merged = true;
            break;
          }
        }
      }
      if (!merged) survivors.push(message.id);
    }
    expect(survivors).toContain(target);
  });

  it("找不到 / 空输入都返回 null", () => {
    expect(findToolCallOwnerMessageId([], "call-9")).toBeNull();
    expect(findToolCallOwnerMessageId([], "")).toBeNull();
    expect(findToolCallOwnerMessageId(undefined, "call-9")).toBeNull();
  });
});

describe("collectCurrentRoundToolCallIds", () => {
  const userMessage = (id: string, autoGenerated?: boolean) => ({
    id,
    role: "user",
    content: [],
    autoGenerated,
  });
  const assistantWithTools = (id: string, toolCallIds: string[]) => ({
    id,
    role: "assistant",
    content: toolCallIds.map((toolCallId) => ({
      type: "tool_use",
      id: toolCallId,
    })),
  });

  it("只收最后一条用户消息之后的 tool_use id", () => {
    const ids = collectCurrentRoundToolCallIds([
      userMessage("u1"),
      assistantWithTools("a1", ["old-1"]),
      userMessage("u2"),
      assistantWithTools("a2", ["new-1", "new-2"]),
    ]);
    expect([...(ids ?? [])].sort()).toEqual(["new-1", "new-2"]);
  });

  it("注入的 autoGenerated 用户消息不算边界", () => {
    const ids = collectCurrentRoundToolCallIds([
      userMessage("u1"),
      assistantWithTools("a1", ["new-1"]),
      userMessage("notice", true),
    ]);
    expect([...(ids ?? [])]).toEqual(["new-1"]);
  });

  it("没有真实用户消息（只有注入消息 / 空输入）时返回 null", () => {
    expect(collectCurrentRoundToolCallIds([userMessage("n", true)])).toBeNull();
    expect(collectCurrentRoundToolCallIds([])).toBeNull();
    expect(collectCurrentRoundToolCallIds(undefined)).toBeNull();
  });
});

describe("stripUpstreamAgentStats", () => {
  it("摘掉统计括号，保留正文", () => {
    expect(
      stripUpstreamAgentStats(
        "Agent completed in 194.1s (10 tool uses, 114.2k token).\n\n找到了三个文件。",
      ),
    ).toBe("Agent completed in 194.1s.\n\n找到了三个文件。");
  });

  it("只摘第一个括号：后面的结论说明必须留", () => {
    expect(
      stripUpstreamAgentStats(
        "Agent completed in 221.6s (36 tool uses, 112.7k token) (wrapped up at the turn limit — output may be partial).\n\n正文",
      ),
    ).toBe(
      "Agent completed in 221.6s (wrapped up at the turn limit — output may be partial).\n\n正文",
    );
  });

  it("带 cost 的统计括号一并摘掉", () => {
    expect(
      stripUpstreamAgentStats(
        "Agent completed in 1.2s (0 tool uses, 117 token, $0.0014).\n\nx",
      ),
    ).toBe("Agent completed in 1.2s.\n\nx");
  });

  it("无 token 时（只有工具数）同样摘掉", () => {
    expect(
      stripUpstreamAgentStats("Agent completed in 1.0s (3 tool uses).\n\nx"),
    ).toBe("Agent completed in 1.0s.\n\nx");
  });

  it("非完成摘要原样返回（保守策略）", () => {
    const failed = "Agent failed: boom (2 tool uses).\n\nx";
    expect(stripUpstreamAgentStats(failed)).toBe(failed);
    const queued = "Agent started in background.\n\n(id: a1)";
    expect(stripUpstreamAgentStats(queued)).toBe(queued);
    const note = "Fell back to X. Agent completed in 1s (2 tool uses).\n\nx";
    expect(stripUpstreamAgentStats(note)).toBe(note);
  });
});
