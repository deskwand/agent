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
  /** True when the corpus fingerprint matched and the scan was skipped entirely. */
  corpusUnchanged: boolean;
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

const CORPUS_KEY = "backfill_corpus_signature";

/**
 * Bump whenever the parsing or normalization of session entries changes.
 *
 * The corpus fingerprint below only notices *new or changed session files*. A
 * stored fingerprint therefore pins whatever the importer did at that time: fix
 * a parsing bug (dedup key, provider field mapping, …) without bumping this and
 * existing installs never re-import their history — silently, because nothing
 * about the corpus changed.
 *
 * Bumping it invalidates every stored signature, so the next launch performs one
 * full rescan (rows stay deduped, so that is wasteful but never wrong).
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

interface CorpusScan {
  /** session id → absolute .jsonl paths */
  filesBySession: Array<{ sessionId: string; files: string[] }>;
  /** Cheap fingerprint: file count, total bytes and newest mtime. */
  signature: string;
}

/**
 * Walk the corpus and fingerprint it. Measured at ~36ms for 687 files / 478MB,
 * versus ~2.1s to actually parse it — this is what makes an unchanged corpus
 * cheap to recognise.
 *
 * Byte total (not just mtime) is part of the fingerprint: a session file can
 * grow within the same mtime tick, and mtime granularity alone would miss it.
 */
function scanCorpus(sessionsRoot: string): CorpusScan {
  const filesBySession: Array<{ sessionId: string; files: string[] }> = [];
  let fileCount = 0;
  let totalBytes = 0;
  let newestMtimeMs = 0;

  let sessionDirs: string[];
  try {
    sessionDirs = readdirSync(sessionsRoot);
  } catch {
    return { filesBySession, signature: `v${BACKFILL_PARSER_VERSION}:0:0:0` };
  }

  for (const sessionId of sessionDirs) {
    const dir = join(sessionsRoot, sessionId);
    let files: string[];
    try {
      if (!statSync(dir).isDirectory()) continue;
      files = readdirSync(dir)
        .filter((name) => name.endsWith(".jsonl"))
        .map((name) => join(dir, name));
    } catch {
      continue;
    }
    for (const file of files) {
      try {
        const stat = statSync(file);
        fileCount += 1;
        totalBytes += stat.size;
        newestMtimeMs = Math.max(newestMtimeMs, Math.floor(stat.mtimeMs));
      } catch {
        // Unreadable mid-walk: leave it out of the fingerprint so the next run
        // revisits the corpus.
      }
    }
    filesBySession.push({ sessionId, files });
  }

  return {
    filesBySession,
    signature: `v${BACKFILL_PARSER_VERSION}:${fileCount}:${totalBytes}:${newestMtimeMs}`,
  };
}

function readStoredSignature(db: DatabaseSync): string | null {
  try {
    const row = db
      .prepare("SELECT value FROM usage_meta WHERE key = ?")
      .get(CORPUS_KEY) as { value?: string } | undefined;
    return row?.value ?? null;
  } catch {
    return null;
  }
}

function writeStoredSignature(db: DatabaseSync, signature: string): void {
  db.prepare(
    "INSERT OR REPLACE INTO usage_meta (key, value) VALUES (?, ?)",
  ).run(CORPUS_KEY, signature);
}

interface PassState {
  pending: UsageRecordInput[];
  lines: number;
}

/**
 * Commit the buffered rows as one short transaction.
 *
 * Chunked rather than one transaction for the whole pass: the pass now yields
 * between chunks, and holding a write transaction open across a yield would let
 * unrelated main-process writes join it — a later rollback would then discard
 * them too. Short transactions plus idempotent keys keep retries safe.
 */
function flushChunk(
  db: DatabaseSync,
  state: PassState,
  result: BackfillResult,
): void {
  if (state.pending.length === 0) {
    state.lines = 0;
    return;
  }
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
  state.lines = 0;
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
 * Two properties keep this off the UI's critical path:
 *  1. an unchanged corpus short-circuits after the ~36ms fingerprint walk,
 *     instead of re-parsing 478MB on every app launch;
 *  2. the pass yields to the event loop every `LINE_BUDGET` lines, so the
 *     Electron main thread keeps serving IPC (measured: the same scan used to
 *     block the loop for its entire ~2.2s duration).
 *
 * Only `~/.deskwand/pi-sessions` is scanned. Subagent and aux calls were never
 * persisted anywhere, so they have no history to import.
 */
export async function backfillUsageFromSessions(
  db: DatabaseSync,
  sessionsRoot: string,
): Promise<BackfillResult> {
  const result: BackfillResult = {
    scanned: 0,
    inserted: 0,
    skipped: 0,
    corpusUnchanged: false,
  };

  const corpus = scanCorpus(sessionsRoot);
  if (readStoredSignature(db) === corpus.signature) {
    result.corpusUnchanged = true;
    return result;
  }

  const state: PassState = { pending: [], lines: 0 };

  for (const { sessionId, files } of corpus.filesBySession) {
    for (const file of files) {
      let content: string;
      try {
        content = readFileSync(file, "utf-8");
      } catch {
        continue;
      }

      for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        state.lines += 1;
        const record = parseLine(line, sessionId);
        if (record) {
          result.scanned += 1;
          state.pending.push(record);
        }
        if (state.lines >= LINE_BUDGET) {
          flushChunk(db, state, result);
          await yieldToEventLoop();
        }
      }
    }
  }

  flushChunk(db, state, result);

  // Separate transaction: the fingerprint only lands once every chunk did. If
  // this write fails, the next run simply re-scans (the rows are already
  // deduped, so that is wasteful but never wrong).
  db.exec("BEGIN");
  try {
    writeStoredSignature(db, corpus.signature);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

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
