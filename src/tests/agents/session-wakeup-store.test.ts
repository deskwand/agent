import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, initDatabase } from "../../main/db/database";
import {
  createSessionWakeupStore,
  type SessionWakeupStore,
} from "../../main/agents/session-wakeup-store";

let dir: string;
let store: SessionWakeupStore;

function wakeup(id: string, runAt: number, sessionId = "s1") {
  return { id, sessionId, runAt, reason: `r-${id}`, createdAt: 1 };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "session-wakeup-store-"));
  store = createSessionWakeupStore(initDatabase(join(dir, "cowork.db")));
});

afterEach(() => {
  closeDatabase();
  rmSync(dir, { recursive: true, force: true });
});

describe("session wakeup store", () => {
  it("round-trips wakeups by session in run_at order", () => {
    store.insert(wakeup("w3", 3_000));
    store.insert(wakeup("w1", 1_000));
    store.insert(wakeup("w2", 2_000, "s2"));
    expect(store.listBySession("s1").map((w) => w.id)).toEqual(["w1", "w3"]);
    expect(store.count("s1")).toBe(2);
    expect(store.listSessionIds().sort()).toEqual(["s1", "s2"]);
  });

  it("takes only due wakeups and keeps the rest", () => {
    store.insert(wakeup("w1", 1_000));
    store.insert(wakeup("w2", 5_000));
    expect(store.takeDue("s1", 2_000).map((w) => w.id)).toEqual(["w1"]);
    expect(store.listBySession("s1").map((w) => w.id)).toEqual(["w2"]);
    expect(store.takeDue("s1", 2_000)).toEqual([]);
  });

  it("deletes one wakeup and all wakeups of a session", () => {
    store.insert(wakeup("w1", 1_000));
    store.insert(wakeup("w2", 2_000));
    expect(store.deleteWakeup("s1", "w1")).toBe(true);
    expect(store.deleteWakeup("s1", "w1")).toBe(false);
    store.deleteBySession("s1");
    expect(store.count("s1")).toBe(0);
    expect(store.listSessionIds()).toEqual([]);
  });

  it("prunes wakeups whose session no longer exists", () => {
    store.insert(wakeup("w1", 1_000, "gone"));
    store.insert(wakeup("w2", 1_000, "kept"));
    store.setChain("kept", 1);
    expect(store.pruneOrphans((sessionId) => sessionId === "kept")).toBe(1);
    expect(store.listSessionIds()).toEqual(["kept"]);
    expect(store.getChain("kept")).toBe(1);
    expect(store.count("gone")).toBe(0);
  });

  it("prunes chain rows whose session no longer exists", () => {
    // 投递会删掉预约但保留链计数，所以「只剩链行」的会话也必须被清掉
    store.setChain("gone", 4);
    expect(store.pruneOrphans((sessionId) => sessionId === "kept")).toBe(1);
    expect(store.getChain("gone")).toBe(0);
  });

  it("stores the self-wake chain per session", () => {
    expect(store.getChain("s1")).toBe(0);
    store.setChain("s1", 2);
    expect(store.getChain("s1")).toBe(2);
    store.setChain("s1", 3);
    expect(store.getChain("s1")).toBe(3);
    store.clearChain("s1");
    expect(store.getChain("s1")).toBe(0);
  });
});
