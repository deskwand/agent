import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

const SRC = path.join(__dirname, "../../main/session/session-manager.ts");
function readSrc(): string {
  return fs.readFileSync(SRC, "utf-8");
}

describe("SessionManager JSONL read path (spec §4.2)", () => {
  it("defines setEntriesReader injection point", () => {
    expect(readSrc()).toContain("setEntriesReader");
  });

  it("getMessages consults readMessagesFromEntries before SQLite", () => {
    const src = readSrc();
    const getMessagesIdx = src.indexOf("getMessages(sessionId: string): Message[]");
    const consultIdx = src.indexOf("readMessagesFromEntries(sessionId)", getMessagesIdx);
    expect(getMessagesIdx).toBeGreaterThan(-1);
    expect(consultIdx).toBeGreaterThan(-1);
    expect(consultIdx).toBeGreaterThan(getMessagesIdx);
  });
});

describe("saveMessage narrowing (spec §4.1)", () => {
  it("no longer calls db.messages.create", () => {
    const src = readSrc();
    const saveIdx = src.indexOf("saveMessage(message: Message): void");
    const getMessagesIdx = src.indexOf("getMessages(sessionId: string): Message[]");
    expect(saveIdx).toBeGreaterThan(-1);
    expect(getMessagesIdx).toBeGreaterThan(saveIdx);
    const body = src.slice(saveIdx, getMessagesIdx);
    expect(body).not.toContain("db.messages.create");
    expect(body).toContain("messageCache");
  });
});

describe("synthetic messages runtime-only (spec §5)", () => {
  it("goal/summary/error messages no longer persisted via saveMessage", () => {
    const src = readSrc();
    expect(src).not.toContain("saveMessage(goalUserMsg)");
    expect(src).not.toContain("saveMessage(goalRespMsg)");
    expect(src).not.toContain("saveMessage(summaryMsg)");
    expect(src).not.toContain("saveMessage(respMsg)");
    expect(src).not.toContain("saveMessage(assistantMessage)");
  });
});

describe("forkSession via forkFrom (spec §4.1)", () => {
  it("uses forkSessionFile instead of SQLite message copy", () => {
    const src = readSrc();
    expect(src).toContain("forkSessionFile");
    expect(src).not.toContain("`fork-${newSession.id}");
  });
});
