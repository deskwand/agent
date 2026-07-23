import type { MemorySessionStateRecord } from "./memory-types";
import { loadJsonFile, saveJsonFile } from "./memory-utils";

interface SessionStateFile {
  sessions: Record<string, MemorySessionStateRecord>;
}

interface StoredSessionStateRecord extends Omit<
  MemorySessionStateRecord,
  "lastReviewedMessageCount"
> {
  lastReviewedMessageCount?: number;
  lastProcessedMessageCount?: number;
}

interface StoredSessionStateFile {
  sessions?: Record<string, StoredSessionStateRecord>;
}

function normalizeMessageCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

export class MemorySessionStateStore {
  private readonly state: SessionStateFile;

  constructor(private readonly filePath: string) {
    const loaded = loadJsonFile<StoredSessionStateFile>(filePath, {
      sessions: {},
    });
    const sessions: Record<string, MemorySessionStateRecord> = {};
    for (const [sessionId, record] of Object.entries(loaded.sessions || {})) {
      if (!record || typeof record !== "object") {
        continue;
      }
      sessions[sessionId] = {
        sessionId: record.sessionId || sessionId,
        sourceWorkspace: record.sourceWorkspace,
        lastReviewedMessageCount: normalizeMessageCount(
          record.lastReviewedMessageCount ?? record.lastProcessedMessageCount,
        ),
        lastIngestedAt: record.lastIngestedAt,
        lastError: record.lastError,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      };
    }
    this.state = { sessions };
  }

  getPath(): string {
    return this.filePath;
  }

  get(sessionId: string): MemorySessionStateRecord | undefined {
    return this.state.sessions[sessionId];
  }

  getAll(): MemorySessionStateRecord[] {
    return Object.values(this.state.sessions);
  }

  set(record: MemorySessionStateRecord): void {
    this.state.sessions[record.sessionId] = record;
    this.save();
  }

  delete(sessionId: string): void {
    if (this.state.sessions[sessionId]) {
      delete this.state.sessions[sessionId];
      this.save();
    }
  }

  deleteBySourceWorkspace(sourceWorkspace: string): void {
    let changed = false;
    for (const [sessionId, record] of Object.entries(this.state.sessions)) {
      if (record.sourceWorkspace === sourceWorkspace) {
        delete this.state.sessions[sessionId];
        changed = true;
      }
    }
    if (changed) {
      this.save();
    }
  }

  clear(): void {
    this.state.sessions = {};
    this.save();
  }

  save(): void {
    saveJsonFile(this.filePath, this.state);
  }
}
