import { describe, expect, it, vi } from "vitest";
import { createSessionWakeupTools } from "../../main/agents/session-wakeup-tool";
import type { SessionWakeupManager } from "../../main/agents/session-wakeup-manager";

const NOW = new Date(2026, 10, 1, 8, 0).getTime();

type WakeupTool = ReturnType<typeof createSessionWakeupTools>[number];

function textOf(result: unknown): string {
  return (result as { content: { text: string }[] }).content[0].text;
}

/** ToolDefinition.execute 有 5 个参数；这里只关心前两个。 */
async function run(
  tool: WakeupTool,
  params: Record<string, unknown>,
): Promise<string> {
  const result = await tool.execute(
    "call-1",
    params,
    new AbortController().signal,
    undefined,
    undefined as never,
  );
  return textOf(result);
}

function tools(overrides: Record<string, unknown> = {}) {
  const schedule = vi.fn(() => ({
    id: "w1",
    sessionId: "s1",
    runAt: NOW + 600_000,
    reason: "看构建结果",
    createdAt: NOW,
  }));
  const cancel = vi.fn(() => true);
  const manager = {
    schedule,
    cancel,
    ...overrides,
  } as unknown as SessionWakeupManager;
  return {
    list: createSessionWakeupTools(manager, "s1", () => NOW),
    schedule,
    cancel,
  };
}

describe("session wakeup tools", () => {
  it("exposes exactly schedule_wakeup and cancel_wakeup", () => {
    const names = tools().list.map((tool) => tool.name);
    expect(names).toEqual(["schedule_wakeup", "cancel_wakeup"]);
  });

  it("schedules from in_minutes and echoes the local time", async () => {
    const { list, schedule } = tools();
    const text = await run(list[0], { in_minutes: 10, reason: "看构建结果" });
    expect(schedule).toHaveBeenCalledWith("s1", NOW + 600_000, "看构建结果");
    expect(text).toContain("Scheduled wakeup w1 at 2026-11-01 08:10");
  });

  it("rejects both or neither of at/in_minutes", async () => {
    const { list, schedule } = tools();
    const text = await run(list[0], {
      at: "2026-11-01T09:00",
      in_minutes: 10,
      reason: "看构建结果",
    });
    expect(text).toContain("exactly one of 'at' or 'in_minutes'");
    expect(schedule).not.toHaveBeenCalled();
  });

  it("requires a non-empty reason", async () => {
    const { list, schedule } = tools();
    const text = await run(list[0], { in_minutes: 10, reason: "   " });
    expect(text).toContain("short reason");
    expect(schedule).not.toHaveBeenCalled();
  });

  it("returns the manager's error text instead of throwing", async () => {
    const { list } = tools({
      schedule: vi.fn(() => {
        throw new Error("Too many pending wakeups (max 3). Cancel some first.");
      }),
    });
    const text = await run(list[0], { in_minutes: 10, reason: "看构建结果" });
    expect(text).toContain("Too many pending wakeups");
  });

  it("reports cancel outcomes", async () => {
    const { list, cancel } = tools();
    expect(await run(list[1], { wakeup_id: "w1" })).toBe("Cancelled.");
    expect(cancel).toHaveBeenCalledWith("s1", "w1");
  });
});
