import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("electron", async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return {
    ...original,
    app: { ...(original.app as object), getPath: () => tmpdir() },
  };
});

import { SessionManager as PiSessionManager } from "@earendil-works/pi-coding-agent";
import { rewriteSessionFileTo } from "../../main/agent/agent-runner";

const HEADER = {
  type: "session",
  version: 3,
  id: "sess-compact",
  timestamp: "2026-10-30T00:00:00.000Z",
  cwd: "/tmp/project",
};

function msg(
  id: string,
  parentId: string | null,
  role: "user" | "assistant",
  text: string,
) {
  return {
    type: "message",
    id,
    parentId,
    timestamp: "2026-10-30T00:00:01.000Z",
    message: { role, content: [{ type: "text", text }], timestamp: 1 },
  };
}

/**
 * u1 → a1 → a2 → c1(firstKeptEntryId = a2) → u2 → a3
 *
 * 摘要覆盖到 a1，a2 起保留。所以：回滚到 a1/a2 之前 ⇒ 分支里没有 c1；
 * 回滚到 u2/a3 ⇒ c1 仍在分支上，摘要继续生效。
 */
function writeCompactedSession(dir: string): string {
  const file = join(dir, "compacted.jsonl");
  const lines = [
    HEADER,
    msg("u1", null, "user", "第一问"),
    msg("a1", "u1", "assistant", "第一答"),
    msg("a2", "a1", "assistant", "第一答的后半段"),
    {
      type: "compaction",
      id: "c1",
      parentId: "a2",
      timestamp: "2026-10-30T00:00:02.000Z",
      summary: "第一轮的摘要",
      firstKeptEntryId: "a2",
      tokensBefore: 1200,
    },
    msg("u2", "c1", "user", "第二问"),
    msg("a3", "u2", "assistant", "第二答"),
  ];
  writeFileSync(
    file,
    lines.map((line) => `${JSON.stringify(line)}\n`).join(""),
  );
  return file;
}

function writePlainSession(dir: string): string {
  const file = join(dir, "plain.jsonl");
  const lines = [
    HEADER,
    msg("u1", null, "user", "第一问"),
    msg("a1", "u1", "assistant", "第一答"),
    msg("u2", "a1", "user", "第二问"),
    msg("a2", "u2", "assistant", "第二答"),
  ];
  writeFileSync(
    file,
    lines.map((line) => `${JSON.stringify(line)}\n`).join(""),
  );
  return file;
}

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rewind-compaction-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

it("rewinding before a compaction brings the raw history back", async () => {
  const file = writeCompactedSession(dir);

  await rewriteSessionFileTo(file, "a1");

  const reopened = PiSessionManager.open(file);
  expect(reopened.getLeafId()).toBe("a1");
  expect(
    reopened.buildContextEntries().some((entry) => entry.type === "compaction"),
  ).toBe(false);
});

it("rewinding after a compaction keeps the summary in context", async () => {
  const file = writeCompactedSession(dir);

  await rewriteSessionFileTo(file, "u2");

  const entries = PiSessionManager.open(file).buildContextEntries();
  expect(entries.some((entry) => entry.type === "compaction")).toBe(true);
  expect(
    entries
      .filter((entry) => entry.type === "message")
      .map((entry) => entry.id),
  ).toContain("u2");
});

it("appends after a rewind under the kept leaf", async () => {
  const file = writePlainSession(dir);
  await rewriteSessionFileTo(file, "a1");

  const reopened = PiSessionManager.open(file);
  const newId = reopened.appendMessage({
    role: "user",
    content: [{ type: "text", text: "换个问法" }],
    timestamp: 2,
  } as never);

  expect(reopened.getBranch(newId).map((entry) => entry.id)).toEqual([
    "u1",
    "a1",
    newId,
  ]);
});
