import { describe, expect, it } from "vitest";
import {
  DEFAULT_AGENT_SCHEDULE_FORM,
  fromAgentScheduleConfig,
  toAgentScheduleConfig,
} from "../../renderer/components/agents/agent-schedule-form";

describe("agent schedule form", () => {
  it("builds an interval rule and rejects too-short minute intervals", () => {
    expect(toAgentScheduleConfig(DEFAULT_AGENT_SCHEDULE_FORM)).toEqual({
      kind: "interval",
      every: 30,
      unit: "minute",
    });
    expect(
      toAgentScheduleConfig({ ...DEFAULT_AGENT_SCHEDULE_FORM, every: 3 }),
    ).toBeNull();
  });

  it("rejects weekly rules without weekdays", () => {
    expect(
      toAgentScheduleConfig({
        ...DEFAULT_AGENT_SCHEDULE_FORM,
        mode: "weekly",
        times: ["09:00"],
      }),
    ).toBeNull();
  });

  it("round-trips weekly rules", () => {
    const config = {
      kind: "weekly" as const,
      weekdays: [1 as const, 3 as const],
      times: ["09:00", "20:00"],
    };
    expect(toAgentScheduleConfig(fromAgentScheduleConfig(config))).toEqual(
      config,
    );
  });
});
