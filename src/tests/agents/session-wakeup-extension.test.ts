import { describe, expect, it, vi } from "vitest";
import {
  SESSION_WAKEUP_PROMPT_SUFFIX,
  SessionWakeupExtension,
} from "../../main/agents/session-wakeup-extension";
import type { SessionWakeupManager } from "../../main/agents/session-wakeup-manager";
import type { BeforeSessionRunContext } from "../../main/extensions/agent-runtime-extension";
import type { Session } from "../../renderer/types";

function context(kind: Session["kind"]): BeforeSessionRunContext {
  return {
    session: { id: "s1", kind } as Session,
    prompt: "看下构建",
    existingMessages: [],
    isColdStart: false,
  };
}

function fakeManager() {
  return {
    beginRun: vi.fn(),
    onTurnFinished: vi.fn(),
    onSessionDeleted: vi.fn(),
    schedule: vi.fn(),
    cancel: vi.fn(),
  } as unknown as SessionWakeupManager & {
    beginRun: ReturnType<typeof vi.fn>;
    onTurnFinished: ReturnType<typeof vi.fn>;
    onSessionDeleted: ReturnType<typeof vi.fn>;
  };
}

describe("SessionWakeupExtension", () => {
  it("gives ordinary sessions the suffix, both tools and a run mark", async () => {
    const manager = fakeManager();
    const extension = new SessionWakeupExtension(() => manager);
    const result = await extension.beforeSessionRun(context("ordinary"));
    expect(result?.systemPromptSuffix).toBe(SESSION_WAKEUP_PROMPT_SUFFIX);
    expect(result?.customTools?.map((tool) => tool.name)).toEqual([
      "schedule_wakeup",
      "cancel_wakeup",
    ]);
    expect(manager.beginRun).toHaveBeenCalledWith("s1", "看下构建");
  });

  it("leaves agent and voice sessions untouched", async () => {
    const manager = fakeManager();
    const extension = new SessionWakeupExtension(() => manager);
    expect(await extension.beforeSessionRun(context("agent"))).toEqual({});
    expect(await extension.beforeSessionRun(context("voice"))).toEqual({});
    expect(manager.beginRun).not.toHaveBeenCalled();
  });

  it("does nothing when the manager is not ready", async () => {
    const extension = new SessionWakeupExtension(() => null);
    expect(await extension.beforeSessionRun(context("ordinary"))).toEqual({});
  });

  it("reports turn end for ordinary sessions only", async () => {
    const manager = fakeManager();
    const extension = new SessionWakeupExtension(() => manager);

    await extension.afterSessionRun({
      session: { id: "s1", kind: "agent" } as Session,
      prompt: "",
      messages: [],
    });
    expect(manager.onTurnFinished).not.toHaveBeenCalled();

    await extension.afterSessionRun({
      session: { id: "s1", kind: "ordinary" } as Session,
      prompt: "",
      messages: [],
    });
    expect(manager.onTurnFinished).toHaveBeenCalledWith("s1");
  });

  it("cleans up on deletion and on archive", async () => {
    const manager = fakeManager();
    const extension = new SessionWakeupExtension(() => manager);
    await extension.onSessionDeleted({ sessionId: "s1" });
    await extension.onSessionClosed({ sessionId: "s2" });
    expect(manager.onSessionDeleted).toHaveBeenNthCalledWith(1, "s1");
    expect(manager.onSessionDeleted).toHaveBeenNthCalledWith(2, "s2");
  });

  it("keeps the suffix free of timestamps so the prompt cache survives", () => {
    expect(SESSION_WAKEUP_PROMPT_SUFFIX).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(SESSION_WAKEUP_PROMPT_SUFFIX).toContain("<self_wakeup>");
  });
});
