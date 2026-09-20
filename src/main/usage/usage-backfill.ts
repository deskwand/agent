import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import type { DatabaseSync } from "node:sqlite";
import { logWarn } from "../utils/logger";
import { normalizeTokenUsage } from "./normalize-usage";
import { buildChatUsageRecord } from "./usage-records";
import { recordUsage } from "./usage-store";
import type { UsageRecordInput } from "../../shared/usage";

export interface BackfillResult {
  scanned: number;
  inserted: number;
  skipped: number;
  /**
   * Files this pass actually read: the ones whose stored `(mtime, size,
   * parser_version)` no longer matched. 0 means nothing needed re-reading. A
   * regression to a whole-corpus rescan shows up here.
   */
  filesChanged: number;
  /**
   * The sessions root itself could not be read, so the pass did nothing at all.
   *
   * Callers that cache a completed pass must not cache this one: the root not
   * existing yet (first ever launch) and a transient `readdirSync` failure
   * (EMFILE, a synced home dir) are indistinguishable here, and treating either
   * as "done" would silently disable the backfill for the rest of the run.
   */
  rootUnreadable: boolean;
}

interface ParsedEntry {
  message?: {
    role?: string;
    provider?: string;
    model?: string;
    timestamp?: number;
    usage?: unknown;
  };
}

/**
 * Bump whenever the parsing or normalization of session entries changes.
 *
 * The per-file fingerprint only notices *new or changed session files*, so a
 * stored fingerprint pins whatever the importer did at that time: fix a parsing
 * bug (dedup key, provider field mapping, …) without bumping this and existing
 * installs never re-import their history — silently, because nothing about the
 * corpus changed.
 *
 * The version is stored on every fingerprint row, so bumping it invalidates all
 * of them at once and the next launch performs one full rescan (rows stay
 * deduped, so that is wasteful but never wrong).
 */
export const BACKFILL_PARSER_VERSION = 1;

/**
 * Lines parsed before the pass commits its chunk and yields to the event loop.
 *
 * 1,000 lines is ~16ms of parse+insert on the measured corpus (5.6µs parse +
 * 10µs insert per line), i.e. roughly one frame. Yielding per file is not enough:
 * the largest session file here is 57MB (12% of the corpus), so a per-file loop
 * still leaves a ~200ms stall.
 */
const LINE_BUDGET = 1000;

interface CorpusFile {
  /**
   * `<sessionId>/<fileName>`, relative to the sessions root. The forward slash
   * is deliberate: this string is the primary key of the fingerprint table, so
   * it must not change shape between platforms.
   */
  relPath: string;
  absPath: string;
  sessionId: string;
  /** Floored, to match exactly what gets written back to the table. */
  mtime: number;
  size: number;
}

/**
 * Walk the corpus and stat every session file.
 *
 * Measured at ~43ms for 734 files / 537MB. That is the price of never
 * re-parsing them: a directory's mtime is useless here, because appending to a
 * file does not touch its directory's mtime, so every file must be stat'ed.
 *
 * Returns null when the root itself cannot be read. That is deliberately
 * distinct from an empty corpus: "unreadable" must never be read as "every
 * session was deleted", or a transient failure would let the caller wipe the
 * whole fingerprint table and force a full re-import.
 */
function walkCorpus(sessionsRoot: string): CorpusFile[] | null {
  let sessionDirs: string[];
  try {
    sessionDirs = readdirSync(sessionsRoot);
  } catch {
    return null;
  }

  const files: CorpusFile[] = [];
  for (const sessionId of sessionDirs) {
    const dir = join(sessionsRoot, sessionId);
    let names: string[];
    try {
      if (!statSync(dir).isDirectory()) continue;
      names = readdirSync(dir).filter((name) => name.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const name of names) {
      const absPath = join(dir, name);
      try {
        const stat = statSync(absPath);
        files.push({
          relPath: `${sessionId}/${name}`,
          absPath,
          sessionId,
          mtime: Math.floor(stat.mtimeMs),
          size: stat.size,
        });
      } catch {
        // Unreadable mid-walk: leave the file out entirely. An absent
        // fingerprint only costs a re-read next run; a stale one skips it
        // forever.
      }
    }
  }

  return files;
}

interface ScanRow {
  mtime: number;
  size: number;
  parserVersion: number;
}

/** Fingerprint rows, keyed by `relPath`. */
function readScanRows(db: DatabaseSync): Map<string, ScanRow> {
  const rows = db
    .prepare("SELECT path, mtime, size, parser_version FROM usage_scan_files")
    .all() as unknown as Array<{
    path: string;
    mtime: number;
    size: number;
    parser_version: number;
  }>;
  return new Map(
    rows.map((row) => [
      row.path,
      { mtime: row.mtime, size: row.size, parserVersion: row.parser_version },
    ]),
  );
}

/**
 * Record that a file's usage rows are fully imported.
 *
 * Ordering matters: this commits *after* the file's chunks did. A crash in
 * between leaves rows with no fingerprint, so the next run re-reads the file and
 * every row is deduped — wasteful but never wrong. The reverse order would mark
 * a file scanned without importing it, losing those rows silently.
 */
function markScanned(db: DatabaseSync, file: CorpusFile): void {
  db.exec("BEGIN");
  try {
    db.prepare(
      `INSERT OR REPLACE INTO usage_scan_files (path, mtime, size, parser_version)
       VALUES (?, ?, ?, ?)`,
    ).run(file.relPath, file.mtime, file.size, BACKFILL_PARSER_VERSION);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

interface PassState {
  pending: UsageRecordInput[];
  /** Lines parsed since the last yield, NOT since the last flush. */
  lines: number;
}

/**
 * Commit the buffered rows as one short transaction.
 *
 * Chunked rather than one transaction for the whole pass: the pass now yields
 * between chunks, and holding a write transaction open across a yield would let
 * unrelated main-process writes join it — a later rollback would then discard
 * them too. Short transactions plus idempotent keys keep retries safe.
 *
 * Deliberately does not touch `state.lines`: that counter measures distance to
 * the next yield. Resetting it here too would let a run of small files (each
 * flushed at its own boundary) block the event loop for the whole pass.
 */
function flushChunk(
  db: DatabaseSync,
  state: PassState,
  result: BackfillResult,
): void {
  if (state.pending.length === 0) return;
  db.exec("BEGIN");
  try {
    for (const record of state.pending) {
      if (recordUsage(db, record)) result.inserted += 1;
      else result.skipped += 1;
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  state.pending.length = 0;
}

/**
 * Drop fingerprint rows for files that no longer exist.
 *
 * Not a correctness requirement: a stale row only lies if a vanished path
 * reappears with an identical mtime and size, and the path carries a session id
 * plus an ISO timestamp. It is a size requirement — `readScanRows` reads the
 * whole table on every pass, so the table must not grow with every session the
 * user has ever permanently deleted.
 *
 * Accepted limitation: a session directory that fails to walk (transient
 * `readdirSync`/`statSync` error) contributes no paths, so its rows are pruned
 * and the next pass re-reads that session. Bounded, once, and never wrong — the
 * rows were already imported and the dedup keys make the re-read a no-op. Only
 * the root case returns early (see `walkCorpus`); per-directory failures
 * deliberately do not, because that would mean threading a partial-failure flag
 * through the whole pass for a rare event.
 */
function pruneScanRows(
  db: DatabaseSync,
  livePaths: Set<string>,
  stored: Map<string, ScanRow>,
): void {
  const stale = [...stored.keys()].filter((path) => !livePaths.has(path));
  if (stale.length === 0) return;

  // One statement per path rather than an IN (?, ?, …) list: no placeholder
  // ceiling to reason about, and the primary key makes each delete an index hit.
  const remove = db.prepare("DELETE FROM usage_scan_files WHERE path = ?");
  db.exec("BEGIN");
  try {
    for (const path of stale) remove.run(path);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Import historical assistant usage from deskwand's own pi session JSONL.
 *
 * Idempotent: it goes through the same `buildChatUsageRecord` as the live write
 * path, so both produce identical dedup keys — replaying the backfill, or racing
 * with live writes, cannot double count.
 *
 * Three properties keep this off the UI's critical path:
 *  1. the fingerprint is per file, so a pass reads only the sessions that
 *     actually changed since the last one (the old whole-corpus fingerprint was
 *     invalidated by any append anywhere, i.e. by every message the user sent);
 *  2. the walk that decides this is ~36ms for 734 files / 537MB, versus
 *     ~2.5–3.9s to parse the corpus;
 *  3. the pass yields to the event loop every `LINE_BUDGET` lines, so the
 *     Electron main thread keeps serving IPC.
 *
 * Only `~/.deskwand/pi-sessions` is scanned. Aux calls were never persisted
 * anywhere, so they have no history to import. Subagent usage IS persisted (in
 * pi's own session root) and has its own pass — see usage-subagent-backfill.ts.
 */
export async function backfillUsageFromSessions(
  db: DatabaseSync,
  sessionsRoot: string,
): Promise<BackfillResult> {
  const result: BackfillResult = {
    scanned: 0,
    inserted: 0,
    skipped: 0,
    filesChanged: 0,
    rootUnreadable: false,
  };

  const files = walkCorpus(sessionsRoot);
  if (files === null) {
    result.rootUnreadable = true;
    return result;
  }

  const stored = readScanRows(db);
  const changed = files.filter((file) => {
    const row = stored.get(file.relPath);
    return (
      !row ||
      row.mtime !== file.mtime ||
      row.size !== file.size ||
      row.parserVersion !== BACKFILL_PARSER_VERSION
    );
  });
  result.filesChanged = changed.length;

  const state: PassState = { pending: [], lines: 0 };

  for (const file of changed) {
    let content: string;
    try {
      content = readFileSync(file.absPath, "utf-8");
    } catch {
      continue;
    }

    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      state.lines += 1;
      const record = parseLine(line, file.sessionId);
      if (record) {
        result.scanned += 1;
        state.pending.push(record);
      }
      if (state.lines >= LINE_BUDGET) {
        flushChunk(db, state, result);
        await yieldToEventLoop();
        // Only a yield resets the budget, so a run of small files cannot
        // stretch one uninterrupted block across the whole pass.
        state.lines = 0;
      }
    }

    // Flush this file's tail, then mark it: the fingerprint row commits after
    // the rows it describes, and the write never spans the yield above.
    flushChunk(db, state, result);
    markScanned(db, file);
  }

  // Only reachable when the walk succeeded — an unreadable root returned early,
  // so it can never be mistaken for "every session was deleted".
  pruneScanRows(db, new Set(files.map((file) => file.relPath)), stored);

  return result;
}

function parseLine(line: string, sessionId: string): UsageRecordInput | null {
  let entry: ParsedEntry;
  try {
    entry = JSON.parse(line) as ParsedEntry;
  } catch {
    return null;
  }
  const message = entry.message;
  if (!message || message.role !== "assistant" || !message.usage) return null;
  // Without the message's own timestamp the live writer can never produce a
  // matching key, so every run would insert it again. Skip rather than
  // fabricate one.
  if (typeof message.timestamp !== "number") return null;

  const usage = normalizeTokenUsage(message.usage, message.provider);
  if (!usage) return null;

  try {
    return buildChatUsageRecord(
      sessionId,
      message,
      { provider: null, model: null },
      usage,
      Date.now(),
    );
  } catch (error) {
    logWarn("[Usage] backfill build failed:", error);
    return null;
  }
}
