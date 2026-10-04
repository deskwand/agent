import { expect, it, vi } from "vitest";
import type { DatabaseInstance, SessionRow } from "../../main/db/database";
import { SessionManager } from "../../main/session/session-manager";
import { VOICE_TURN } from "../../main/agent/turn-profiles";

function setup() {
  const rows = new Map<string, SessionRow>();
  const send = vi.fn();
  const create = vi.fn((row: SessionRow) => {
    expect(send).not.toHaveBeenCalled();
    rows.set(row.id, row);
  });
  const db = {
    sessions: {
      create,
      get: (id: string) => rows.get(id),
      getAll: () => [...rows.values()],
    },
    goals: { get: () => undefined },
  } as unknown as DatabaseInstance;
  return { sm: new SessionManager(db, send), rows, create, send };
}
it("persists an idle voice record before notifying without a prompt", () => {
  const { sm, rows, send } = setup();
  const session = sm.createVoiceSessionRecord();
  expect(session.kind).toBe("voice");
  expect(session.status).toBe("idle");
  expect(session.allowedTools).toEqual(VOICE_TURN.tools);
  expect(rows.get(session.id)?.session_kind).toBe("voice");
  expect(
    sm.listSessions().sessions.find((s) => s.id === session.id)?.kind,
  ).toBe("voice");
  expect(send).toHaveBeenCalledExactlyOnceWith({
    type: "session.create",
    payload: { session },
  });
});
it("keeps ordinary creation compatible", () => {
  const { sm, rows } = setup();
  const session = sm.createSessionRecord("ordinary");
  expect(session.kind).toBe("ordinary");
  expect(rows.get(session.id)?.session_kind).toBe("ordinary");
});
it("does not announce records when persistence fails", () => {
  const { sm, create, send } = setup();
  create.mockImplementation(() => {
    throw new Error("disk full");
  });
  expect(() => sm.createVoiceSessionRecord()).toThrow("disk full");
  expect(send).not.toHaveBeenCalled();
});
