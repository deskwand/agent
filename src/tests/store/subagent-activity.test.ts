import { beforeEach, describe, expect, it } from "vitest";
import { MAX_SUBAGENT_ACTIVITIES, useAppStore } from "../../renderer/store";
import type { SubagentActivity } from "../../shared/subagent-activity";

function activity(toolCallId: string): SubagentActivity {
  return {
    sessionId: "s1",
    agentId: `agent-${toolCallId}`,
    parentToolCallId: toolCallId,
    status: "running",
    steps: [],
    stats: { toolUses: 0, durationMs: 0 },
  };
}

describe("subagentActivities", () => {
  beforeEach(() => useAppStore.setState(useAppStore.getInitialState(), true));

  it("按 parentToolCallId 落进对应会话", () => {
    useAppStore.getState().setSubagentActivity("s1", activity("call-1"));
    const stored = useAppStore.getState().sessionStates.s1.subagentActivities;
    expect(stored["call-1"].agentId).toBe("agent-call-1");
  });

  it("只保留最近 MAX_SUBAGENT_ACTIVITIES 条（丢最久未更新的）", () => {
    for (let i = 0; i < MAX_SUBAGENT_ACTIVITIES; i++) {
      useAppStore.getState().setSubagentActivity("s1", activity(`call-${i}`));
    }
    // 把最早那条再更新一次：它变成「最近更新」，不应成为被淘汰的首选
    useAppStore.getState().setSubagentActivity("s1", activity("call-0"));
    useAppStore.getState().setSubagentActivity("s1", activity("call-new"));

    const keys = Object.keys(
      useAppStore.getState().sessionStates.s1.subagentActivities,
    );
    expect(keys).toHaveLength(MAX_SUBAGENT_ACTIVITIES);
    expect(keys).toContain("call-0");
    expect(keys).toContain("call-new");
    expect(keys).not.toContain("call-1");
  });
});
