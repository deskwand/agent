import { describe, expect, it, vi } from "vitest";
import {
  PersistentAgentExtension,
  buildAgentPromptSuffix,
} from "../../main/agents/persistent-agent-extension";
import type { PersistentAgentManager } from "../../main/agents/persistent-agent-manager";
import type { BeforeSessionRunContext } from "../../main/extensions/agent-runtime-extension";
import type { Session } from "../../renderer/types";

const agent = {
  id: "a1",
  name: "推特运营",
  instructions: "每天发两条",
  schedule: { kind: "interval", every: 30, unit: "minute" },
};

function context(kind: Session["kind"]): BeforeSessionRunContext {
  return {
    session: { id: "s1", kind } as Session,
    prompt: "",
    existingMessages: [],
    isColdStart: false,
  };
}

function fakeManager(found: boolean) {
  return {
    findBySessionId: vi.fn(() => (found ? agent : null)),
    onTurnFinished: vi.fn(),
    onSessionLost: vi.fn(),
    setCheckIn: vi.fn(),
  } as unknown as PersistentAgentManager & {
    onTurnFinished: ReturnType<typeof vi.fn>;
  };
}

describe("PersistentAgentExtension", () => {
  it("leaves ordinary sessions untouched", async () => {
    const ext = new PersistentAgentExtension(() => fakeManager(true));
    const result = await ext.beforeSessionRun(context("ordinary"));
    expect(result).toEqual({});
    expect(result.customTools).toBeUndefined();
    expect(result.systemPromptSuffix).toBeUndefined();
  });

  it("prompt suffix states the fallback interval", async () => {
    const ext = new PersistentAgentExtension(() => fakeManager(true));
    const result = await ext.beforeSessionRun(context("agent"));
    expect(result.systemPromptSuffix).toContain(
      "at most 30 minutes after your last turn ends",
    );
  });

  it("prompt suffix for daily rules only mentions check-ins", () => {
    const suffix = buildAgentPromptSuffix({
      ...agent,
      schedule: { kind: "daily", times: ["09:00"] },
    });
    expect(suffix).not.toContain("at most");
    expect(suffix).toContain("set_next_check_in");
  });

  it("injects a time-free persona suffix and the wakeup tools", async () => {
    const ext = new PersistentAgentExtension(() => fakeManager(true));
    const result = await ext.beforeSessionRun(context("agent"));
    expect(result.systemPromptSuffix).toContain("每天发两条");
    expect(result.systemPromptSuffix).not.toContain(
      String(new Date().getFullYear()),
    );
    expect(result.customTools?.map((tool) => tool.name)).toEqual([
      "schedule_wakeup",
      "cancel_wakeup",
      "set_next_check_in",
    ]);
  });

  it("maps the run outcome to the manager", async () => {
    const manager = fakeManager(true);
    const ext = new PersistentAgentExtension(() => manager);
    const session = { id: "s1", kind: "agent" } as Session;
    await ext.afterSessionRun({
      session,
      prompt: "",
      messages: [],
      outcome: "failure",
    });
    await ext.afterSessionRun({
      session,
      prompt: "",
      messages: [],
      outcome: "cancelled",
    });
    await ext.onSessionRunError({ sessionId: "s1", error: new Error("boom") });
    expect(manager.onTurnFinished.mock.calls).toEqual([
      ["s1", "failure", "Turn failed"],
      ["s1", "cancelled", undefined],
      ["s1", "failure", "boom"],
    ]);
  });

  it("ignores turn results for sessions with no agent", async () => {
    const ext = new PersistentAgentExtension(() => null);
    await expect(
      ext.afterSessionRun({
        session: { id: "x" } as Session,
        prompt: "",
        messages: [],
      }),
    ).resolves.toBeUndefined();
    expect(await ext.beforeSessionRun(context("agent"))).toEqual({});
  });
});
