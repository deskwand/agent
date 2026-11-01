import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, initDatabase } from "../../main/db/database";
import {
  createPersistentAgentStore,
  type PersistentAgentStore,
} from "../../main/agents/persistent-agent-store";
import type { PersistentAgent } from "../../shared/persistent-agent";

let dir: string;
let store: PersistentAgentStore;

function agent(overrides: Partial<PersistentAgent> = {}): PersistentAgent {
  return {
    id: "a1",
    name: "推特运营",
    instructions: "运营推特号",
    cwd: "/tmp/agent",
    sessionId: "s1",
    schedule: { kind: "interval", every: 30, unit: "minute" },
    enabled: true,
    nextPeriodicAt: 2_000,
    consecutiveFailures: 0,
    lastWakeupAt: null,
    lastError: null,
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

function wakeup(id: string, runAt: number, agentId = "a1") {
  return { id, agentId, runAt, reason: `r-${id}`, createdAt: 1 };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "persistent-agent-store-"));
  store = createPersistentAgentStore(initDatabase(join(dir, "cowork.db")));
});

afterEach(() => {
  closeDatabase();
  rmSync(dir, { recursive: true, force: true });
});

describe("persistent agent store", () => {
  it("round-trips an agent by id and session id", () => {
    store.insert(agent());
    expect(store.get("a1")).toEqual(agent());
    expect(store.getBySessionId("s1")).toEqual(agent());
    expect(store.list()).toHaveLength(1);
  });

  it("updates fields and advances updatedAt", () => {
    store.insert(agent());
    const updated = store.update("a1", { enabled: false });
    expect(updated?.enabled).toBe(false);
    expect(updated!.updatedAt).toBeGreaterThan(1_000);
    expect(store.get("a1")?.enabled).toBe(false);
    expect(store.update("missing", { enabled: false })).toBeNull();
  });

  it("takes only due wakeups and keeps the rest in order", () => {
    store.insert(agent());
    store.insertWakeup(wakeup("w3", 3_000));
    store.insertWakeup(wakeup("w1", 500));
    store.insertWakeup(wakeup("w2", 1_000));
    expect(store.takeDueWakeups("a1", 1_000).map((w) => w.id)).toEqual([
      "w1",
      "w2",
    ]);
    expect(store.listWakeups("a1").map((w) => w.id)).toEqual(["w3"]);
  });

  it("cascades wakeups when the agent is deleted", () => {
    store.insert(agent());
    store.insertWakeup(wakeup("w1", 500));
    expect(store.delete("a1")).toBe(true);
    expect(store.countWakeups("a1")).toBe(0);
  });

  it("refuses to delete another agent's wakeup", () => {
    store.insert(agent());
    store.insert(agent({ id: "a2", sessionId: "s2" }));
    store.insertWakeup(wakeup("w1", 500, "a2"));
    expect(store.deleteWakeup("a1", "w1")).toBe(false);
    expect(store.deleteWakeup("a2", "w1")).toBe(true);
  });
});
