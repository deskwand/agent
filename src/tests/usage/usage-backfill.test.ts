import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createUsageSchema, queryUsage } from "../../main/usage/usage-store";
import {
  BACKFILL_PARSER_VERSION,
  backfillUsageFromSessions,
} from "../../main/usage/usage-backfill";

let root: string;
let db: DatabaseSync;

function writeSession(sessionId: string, lines: unknown[]): void {
  const dir = path.join(root, sessionId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "2026-09-12T00-00-00-000Z_abc.jsonl"),
    lines.map((l) => JSON.stringify(l)).join("\n"),
    "utf-8",
  );
}

const assistant = (ts: number, input: number, output: number) => ({
  type: "message",
  id: "e1",
  timestamp: "2026-09-12T00:00:01.000Z",
  message: {
    role: "assistant",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    timestamp: ts,
    usage: { input, output, cacheRead: 100, cacheWrite: 0 },
  },
});

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "deskwand-backfill-"));
  db = new DatabaseSync(":memory:");
  createUsageSchema(db);
});
afterEach(() => {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("backfillUsageFromSessions", () => {
  it("imports assistant usage rows and derives session id from the directory name", async () => {
    writeSession("s-1", [
      { type: "session", id: "s-1" },
      { type: "message", message: { role: "user", content: "hi" } },
      assistant(1_760_000_000_000, 10, 5),
    ]);
    const result = await backfillUsageFromSessions(db, root);
    expect(result).toMatchObject({ scanned: 1, inserted: 1, skipped: 0 });
    const single = db
      .prepare("SELECT session_id, source, dedup_key FROM usage_records")
      .get() as Record<string, unknown>;
    expect(single).toMatchObject({
      session_id: "s-1",
      source: "chat",
      // session-independent key: ts + the usage tuple
      dedup_key: "chat:1760000000000:10:5:100:0",
    });
  });

  it("is idempotent — a second run inserts nothing", async () => {
    writeSession("s-1", [assistant(1_760_000_000_000, 10, 5)]);
    await backfillUsageFromSessions(db, root);
    const second = await backfillUsageFromSessions(db, root);
    expect(second.inserted).toBe(0);
    // Unchanged corpus: no file is read at all.
    // (The dedup path itself is covered by the change-detection and fork cases.)
    expect(second).toMatchObject({ scanned: 0, filesChanged: 0 });
    const { c } = db
      .prepare("SELECT COUNT(*) AS c FROM usage_records")
      .get() as { c: number };
    expect(c).toBe(1);
  });

  it("reads only the file whose fingerprint changed", async () => {
    writeSession("s-1", [assistant(1_760_000_000_000, 10, 5)]);
    writeSession("s-2", [assistant(1_760_000_001_000, 10, 5)]);
    writeSession("s-3", [assistant(1_760_000_002_000, 10, 5)]);
    expect(await backfillUsageFromSessions(db, root)).toMatchObject({
      filesChanged: 3,
      inserted: 3,
    });

    fs.appendFileSync(
      path.join(root, "s-2", "2026-09-12T00-00-00-000Z_abc.jsonl"),
      "\n" + JSON.stringify(assistant(1_760_000_003_000, 4, 4)),
      "utf-8",
    );

    const second = await backfillUsageFromSessions(db, root);
    // s-2 is re-read in full (both records: one new, one deduped); s-1 and s-3
    // are not read at all. A regression to a whole-corpus rescan makes
    // `filesChanged` 3 and `scanned` 4.
    expect(second).toMatchObject({
      filesChanged: 1,
      scanned: 2,
      inserted: 1,
      skipped: 1,
    });
    const { c } = db
      .prepare("SELECT COUNT(*) AS c FROM usage_records")
      .get() as { c: number };
    expect(c).toBe(4);
  });

  it("does not double count a row already written live with the same key", async () => {
    writeSession("s-1", [assistant(1_760_000_000_000, 10, 5)]);
    db.prepare(
      `INSERT INTO usage_records
         (ts, session_id, model, provider, source, purpose,
          input, output, cache_read, cache_write, dedup_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      1_760_000_000_000,
      "s-1",
      "deepseek-v4-flash",
      "deepseek",
      "chat",
      null,
      10,
      5,
      100,
      0,
      "chat:1760000000000:10:5:100:0",
    );
    const result = await backfillUsageFromSessions(db, root);
    expect(result.inserted).toBe(0);
    expect(queryUsage(db, "all", 1_800_000_000_000).totals.calls).toBe(1);
  });

  it("re-reads a file that was imported but never marked as scanned", async () => {
    writeSession("s-1", [assistant(1_760_000_000_000, 10, 5)]);
    await backfillUsageFromSessions(db, root);

    // What a crash between "rows inserted" and "file marked" leaves behind.
    db.exec("DELETE FROM usage_scan_files");

    const second = await backfillUsageFromSessions(db, root);
    expect(second).toMatchObject({
      filesChanged: 1,
      scanned: 1,
      inserted: 0,
      skipped: 1,
    });
    expect(queryUsage(db, "all", 1_800_000_000_000).totals.calls).toBe(1);
  });

  it("counts a forked copy of the same message only once", async () => {
    // Forking copies entries verbatim into the new session directory, so the
    // identical message exists under two session ids.
    writeSession("s-1", [assistant(1_760_000_000_000, 10, 5)]);
    writeSession("s-2-fork", [
      { type: "session", id: "s-2-fork" },
      assistant(1_760_000_000_000, 10, 5),
    ]);
    const result = await backfillUsageFromSessions(db, root);
    expect(result.inserted).toBe(1);
    const totals = queryUsage(db, "all", 1_800_000_000_000).totals;
    expect(totals.calls).toBe(1);
    expect(totals.input).toBe(10);
  });

  it("skips entries that carry no message timestamp", async () => {
    writeSession("s-3", [
      {
        type: "message",
        message: {
          role: "assistant",
          provider: "deepseek",
          model: "m",
          usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
        },
      },
    ]);
    const result = await backfillUsageFromSessions(db, root);
    expect(result).toMatchObject({ scanned: 0, inserted: 0 });
  });

  it("skips malformed lines and entries without usage", async () => {
    writeSession("s-2", [
      "not json at all",
      { type: "message", message: { role: "assistant" } },
      assistant(1_760_000_000_000, 1, 1),
    ]);
    const result = await backfillUsageFromSessions(db, root);
    expect(result).toMatchObject({ scanned: 1, inserted: 1 });
  });

  it("commits each chunk in its own transaction, with no await inside it", () => {
    const source = fs.readFileSync(
      path.join(__dirname, "../../main/usage/usage-backfill.ts"),
      "utf-8",
    );
    const start = source.indexOf("function flushChunk(");
    const end = source.indexOf("\nfunction ", start + 1);
    expect(start).toBeGreaterThan(-1);
    const flushBody = source.slice(start, end);
    expect(flushBody).toContain('db.exec("BEGIN")');
    expect(flushBody).toContain('db.exec("COMMIT")');
    expect(flushBody).toContain('db.exec("ROLLBACK")');
    // The write transaction must never span a yield: another main-process write
    // could join it, and a later rollback would discard that write too.
    expect(flushBody).not.toContain("await");
  });

  it("re-reads a file whose fingerprint was written by an older parser version", async () => {
    writeSession("s-1", [assistant(1_760_000_000_000, 10, 5)]);
    await backfillUsageFromSessions(db, root);

    // Simulate an upgrade that bumped BACKFILL_PARSER_VERSION. Trusting the
    // stored row would pin old parsing results forever.
    db.prepare(
      "UPDATE usage_scan_files SET parser_version = ? WHERE path = ?",
    ).run(
      BACKFILL_PARSER_VERSION - 1,
      "s-1/2026-09-12T00-00-00-000Z_abc.jsonl",
    );

    const second = await backfillUsageFromSessions(db, root);
    expect(second).toMatchObject({
      filesChanged: 1,
      scanned: 1,
      inserted: 0,
      skipped: 1,
    });
  });

  it("returns an empty result for a missing root", async () => {
    expect(
      await backfillUsageFromSessions(db, path.join(root, "nope")),
    ).toMatchObject({ scanned: 0, inserted: 0, skipped: 0, filesChanged: 0 });
  });
});

/**
 * A backfill that re-reads 478MB on every app launch only to find every row
 * already present is the reason the usage page hangs on first open. The
 * per-file fingerprint must let an unchanged file be skipped, without ever
 * turning into a permanent skip.
 */
describe("backfill skips an unchanged file", () => {
  it("does not rescan when nothing changed", async () => {
    writeSession("s-1", [assistant(1_760_000_000_000, 10, 5)]);
    const first = await backfillUsageFromSessions(db, root);
    expect(first).toMatchObject({
      scanned: 1,
      inserted: 1,
      filesChanged: 1,
    });

    const second = await backfillUsageFromSessions(db, root);
    expect(second).toMatchObject({
      scanned: 0,
      inserted: 0,
      filesChanged: 0,
    });
  });

  it("imports a new session file without touching the existing ones", async () => {
    writeSession("s-1", [assistant(1_760_000_000_000, 10, 5)]);
    await backfillUsageFromSessions(db, root);

    writeSession("s-2", [assistant(1_760_000_001_000, 7, 3)]);
    const third = await backfillUsageFromSessions(db, root);
    // Only the new file is read; s-1 is left alone rather than re-examined.
    expect(third).toMatchObject({
      filesChanged: 1,
      scanned: 1,
      inserted: 1,
      skipped: 0,
    });
    // The old row is still deduped, not duplicated.
    expect(queryUsage(db, "all", 1_800_000_000_000).totals.calls).toBe(2);
  });

  it("does not skip when a file is appended to without changing its mtime", async () => {
    writeSession("s-1", [assistant(1_760_000_000_000, 10, 5)]);
    await backfillUsageFromSessions(db, root);

    // Simulate a session that grows during the same second: same file count,
    // same mtime granularity, different bytes.
    const file = path.join(root, "s-1", "2026-09-12T00-00-00-000Z_abc.jsonl");
    const before = fs.statSync(file);
    fs.appendFileSync(
      file,
      "\n" + JSON.stringify(assistant(1_760_000_002_000, 4, 4)),
      "utf-8",
    );
    fs.utimesSync(file, before.atime, before.mtime);

    const third = await backfillUsageFromSessions(db, root);
    // `size` is what catches this: the mtime was restored to its old value.
    expect(third).toMatchObject({
      filesChanged: 1,
      scanned: 2,
      inserted: 1,
      skipped: 1,
    });
  });
});

/**
 * The scan runs on the Electron main thread and the query awaits it. If it never
 * yields, every other IPC (and the chat stream) stalls for the whole scan.
 */
describe("backfill yields to the event loop", () => {
  it("lets other work run while it scans, without losing or duplicating rows", async () => {
    // Enough entries to cross the per-chunk line budget (the real corpus has
    // ~152k lines, so a fixture that never trips it would not be representative).
    const perFile = 300;
    const fileCount = 5;
    for (let i = 0; i < fileCount; i += 1) {
      writeSession(
        `s-${i}`,
        Array.from({ length: perFile }, (_, n) =>
          assistant(1_760_000_000_000 + i * 1_000 + n, 1, 1),
        ),
      );
    }

    let otherWorkRan = 0;
    let spinning = true;
    const spin = (): void => {
      if (!spinning) return;
      otherWorkRan += 1;
      setImmediate(spin);
    };
    setImmediate(spin);

    await backfillUsageFromSessions(db, root);
    spinning = false;

    expect(otherWorkRan).toBeGreaterThan(0);

    // Chunked commits must not drop or duplicate rows.
    const { c } = db
      .prepare("SELECT COUNT(*) AS c FROM usage_records")
      .get() as { c: number };
    expect(c).toBe(perFile * fileCount);
  });
});

/**
 * `readScanRows` reads the whole table on every pass and permanent session
 * deletion is a real feature, so fingerprint rows must not outlive their files.
 */
describe("fingerprint rows are pruned", () => {
  it("forgets the rows of files that no longer exist", async () => {
    writeSession("s-1", [assistant(1_760_000_000_000, 10, 5)]);
    writeSession("s-2", [assistant(1_760_000_001_000, 10, 5)]);
    await backfillUsageFromSessions(db, root);

    fs.rmSync(path.join(root, "s-2"), { recursive: true, force: true });
    const second = await backfillUsageFromSessions(db, root);

    // Deleting a session changes no surviving file's fingerprint...
    expect(second).toMatchObject({ filesChanged: 0 });
    // ...only its own row goes away...
    const rows = db
      .prepare("SELECT path FROM usage_scan_files ORDER BY path")
      .all() as Array<{ path: string }>;
    expect(rows.map((row) => row.path)).toEqual([
      "s-1/2026-09-12T00-00-00-000Z_abc.jsonl",
    ]);
    // ...and its already-imported usage rows stay: usage_records is history, not
    // a mirror of the corpus.
    expect(queryUsage(db, "all", 1_800_000_000_000).totals.calls).toBe(2);
  });

  it("leaves the fingerprint table alone when the root cannot be read", async () => {
    writeSession("s-1", [assistant(1_760_000_000_000, 10, 5)]);
    await backfillUsageFromSessions(db, root);

    await backfillUsageFromSessions(db, path.join(root, "nope"));

    // An unreadable root must not be mistaken for "every session was deleted",
    // or one transient failure would force a full re-import on the next launch.
    const { c } = db
      .prepare("SELECT COUNT(*) AS c FROM usage_scan_files")
      .get() as { c: number };
    expect(c).toBe(1);
  });
});
