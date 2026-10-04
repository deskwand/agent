import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
const paths = vi.hoisted(() => ({ userData: "" }));
vi.mock("electron", async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return {
    ...original,
    app: { ...(original.app as object), getPath: () => paths.userData },
  };
});
import { initDatabase, closeDatabase } from "../../main/db/database";
import { SessionManager } from "../../main/session/session-manager";
import { VOICE_TURN } from "../../main/agent/turn-profiles";
beforeEach(() => {
  closeDatabase();
  paths.userData = mkdtempSync(join(tmpdir(), "voice-session-db-"));
});
afterEach(() => {
  closeDatabase();
  rmSync(paths.userData, { recursive: true, force: true });
});
it("migrates old rows without guessing from messages and survives restart", () => {
  const dir = join(paths.userData, "data");
  mkdirSync(dir, { recursive: true });
  const legacy = new DatabaseSync(join(dir, "cowork.db"));
  try {
    legacy.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT NOT NULL, deskwand_session_id TEXT, status TEXT NOT NULL DEFAULT 'idle', cwd TEXT, mounted_paths TEXT NOT NULL DEFAULT '[]', allowed_tools TEXT NOT NULL DEFAULT '[]', memory_enabled INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    INSERT INTO sessions (id,title,created_at,updated_at) VALUES ('old','voice sounding title',1,1);`);
  } finally {
    legacy.close();
  }
  let db = initDatabase();
  expect(db.sessions.get("old")?.session_kind).toBe("ordinary");
  const original = db.sessions.get("old")!;
  db.sessions.create({ ...original, id: "voice", session_kind: "voice" });
  closeDatabase();
  db = initDatabase();
  expect(db.sessions.get("voice")?.session_kind).toBe("voice");
  expect(db.sessions.get("old")?.session_kind).toBe("ordinary");
});

it("keeps a created voice record usable after a restart", () => {
  const send = vi.fn();
  let db = initDatabase();
  const created = new SessionManager(db, send).createVoiceSessionRecord();
  closeDatabase();
  db = initDatabase();
  const reopened = new SessionManager(db, send);
  const listed = reopened
    .listSessions()
    .sessions.find((session) => session.id === created.id);
  expect(listed?.kind).toBe("voice");
  expect(listed?.status).toBe("idle");
  expect(listed?.allowedTools).toEqual(VOICE_TURN.tools);
});
