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
  schedule: { kind: "interval", every: 30, unit: "minute" } as const,
  trustedRecipients: [] as string[],
  riskyCapabilities: { shell: true, browser: true, computer: true },
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

describe("teammate outbound safety", () => {
  const emailInput = { to: "stranger@evil.com", subject: "hi", body: "x" };

  function guardManager(overrides: Record<string, unknown> = {}) {
    const current = { ...agent, ...overrides };
    return {
      findBySessionId: vi.fn(() => current),
      get: vi.fn(() => current),
      addTrustedRecipient: vi.fn(),
      onTurnFinished: vi.fn(),
      onSessionLost: vi.fn(),
      setCheckIn: vi.fn(),
    } as unknown as PersistentAgentManager & {
      addTrustedRecipient: ReturnType<typeof vi.fn>;
    };
  }

  async function guardOf(
    manager: PersistentAgentManager,
    onApprovalNeeded?: (name: string) => void,
  ) {
    const ext = new PersistentAgentExtension(() => manager, onApprovalNeeded);
    const result = await ext.beforeSessionRun(context("agent"));
    expect(result.toolCallGuard).toBeDefined();
    return result.toolCallGuard!;
  }

  it("safety prompt is stable and lists disabled capabilities", () => {
    const first = buildAgentPromptSuffix(agent);
    expect(first).toContain("Safety rules:");
    expect(buildAgentPromptSuffix(agent)).toBe(first);
    expect(first).not.toContain("Disabled capabilities");
    const off = buildAgentPromptSuffix({
      ...agent,
      riskyCapabilities: { shell: false, browser: false, computer: true },
    });
    expect(off).toContain(
      "Disabled capabilities for this teammate: shell, browser.",
    );
  });

  it("ordinary sessions get no guard", async () => {
    const ext = new PersistentAgentExtension(() => guardManager());
    const result = await ext.beforeSessionRun(context("ordinary"));
    expect(result.toolCallGuard).toBeUndefined();
  });

  it("approving a stranger allows the send and trusts them", async () => {
    const manager = guardManager();
    const onApprovalNeeded = vi.fn();
    const guard = await guardOf(manager, onApprovalNeeded);
    const askUser = vi.fn(async () => ({
      status: "answered" as const,
      answers: { "0": "Yes" },
    }));
    const out = await guard(
      { toolName: "email_send", input: emailInput },
      { askUser },
    );
    expect(out).toBeUndefined();
    expect(onApprovalNeeded).toHaveBeenCalledWith(agent.name);
    expect(manager.addTrustedRecipient).toHaveBeenCalledWith(
      "a1",
      "stranger@evil.com",
    );
  });

  it("declining or cancelling blocks the send", async () => {
    const manager = guardManager();
    const guard = await guardOf(manager);
    const no = await guard(
      { toolName: "email_send", input: emailInput },
      {
        askUser: async () => ({ status: "answered", answers: { "0": "No" } }),
      },
    );
    expect(no).toEqual({
      block: true,
      reason: "Blocked: the user declined this send.",
    });
    const cancelled = await guard(
      { toolName: "email_send", input: emailInput },
      { askUser: async () => ({ status: "cancelled" }) },
    );
    expect(cancelled?.reason).toContain("declined");
    expect(manager.addTrustedRecipient).not.toHaveBeenCalled();
  });

  it("tells the model when the user replied in chat instead of approving", async () => {
    const guard = await guardOf(guardManager());
    const out = await guard(
      { toolName: "email_send", input: emailInput },
      {
        askUser: async () => ({ status: "cancelled", reason: "userReplied" }),
      },
    );
    expect(out).toEqual({
      block: true,
      reason:
        "Blocked: the user replied in chat instead of approving this send. Read their message and follow it.",
    });
    const stopped = await guard(
      { toolName: "email_send", input: emailInput },
      { askUser: async () => ({ status: "cancelled", reason: "stopped" }) },
    );
    expect(stopped?.reason).toContain("declined");
  });

  it("blocks when no approval card is available", async () => {
    const guard = await guardOf(guardManager());
    const out = await guard({ toolName: "email_send", input: emailInput }, {});
    expect(out?.block).toBe(true);
    expect(out?.reason).toContain("needs the user's approval");
  });

  it("blocks disabled capabilities without asking", async () => {
    const guard = await guardOf(
      guardManager({
        riskyCapabilities: { shell: false, browser: true, computer: true },
      }),
    );
    const askUser = vi.fn();
    const out = await guard(
      { toolName: "bash", input: { command: "ls" } },
      { askUser },
    );
    expect(out?.block).toBe(true);
    expect(askUser).not.toHaveBeenCalled();
  });
});
