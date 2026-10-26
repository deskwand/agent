import { describe, expect, it } from "vitest";
import type { SubagentActivity } from "../../shared/subagent-activity";
import {
  buildOverviewBackgroundTasks,
} from "../../renderer/utils/subagent-card";

function activity(
  parentToolCallId: string,
  options: {
    background?: boolean;
    status?: SubagentActivity["status"];
    name?: string;
    description?: string;
  } = {},
): SubagentActivity {
  return {
    sessionId: "s1",
    agentId: `agent-${parentToolCallId}`,
    parentToolCallId,
    name: options.name ?? parentToolCallId,
    type: "general-purpose",
    description: options.description ?? `task ${parentToolCallId}`,
    background: options.background ?? true,
    status: options.status ?? "running",
    steps: [],
    stats: { toolUses: 2, durationMs: 1500 },
  };
}

const labelFor = (step: { toolName: string }) => step.toolName;

describe("buildOverviewBackgroundTasks", () => {
  it("keeps running tasks and finished tasks in separate groups", () => {
    const result = buildOverviewBackgroundTasks(
      {
        a: activity("a", { status: "running" }),
        b: activity("b", { status: "completed" }),
      },
      labelFor,
      "en",
    );

    expect(result.running.map((row) => row.toolCallId)).toEqual(["a"]);
    expect(result.finished.map((row) => row.toolCallId)).toEqual(["b"]);
  });

  it("drops foreground subagents (background !== true)", () => {
    const result = buildOverviewBackgroundTasks(
      { a: activity("a", { background: false }) },
      labelFor,
      "en",
    );

    expect(result.running).toEqual([]);
    expect(result.finished).toEqual([]);
  });

  it("does not cap the finished group (the section collapses it)", () => {
    const activities: Record<string, SubagentActivity> = {};
    for (let i = 0; i < 8; i += 1) {
      activities[`done-${i}`] = activity(`done-${i}`, { status: "completed" });
    }

    const result = buildOverviewBackgroundTasks(activities, labelFor, "en");

    expect(result.finished).toHaveLength(8);
  });

  it("maps duration and step count from the activity stats", () => {
    const [row] = buildOverviewBackgroundTasks(
      { a: activity("a") },
      labelFor,
      "en",
    ).running;

    expect(row.durationMs).toBe(1500);
    expect(row.stepCount).toBe(2);
  });
});
