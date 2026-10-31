import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
import {
  AgentRunner,
  REWIND_DISPOSE_TIMEOUT_MS,
  rewriteSessionFileTo,
} from "../../main/agent/agent-runner";

const HEADER = {
  type: "session",
  version: 3,
  id: "sess-1",
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

/** 写一个 6 条消息的线性会话，返回文件路径。 */
function writeSession(dir: string, name = "sess.jsonl"): string {
  const file = join(dir, name);
  const lines = [
    HEADER,
    msg("u1", null, "user", "第一问"),
    msg("a1", "u1", "assistant", "第一答"),
    msg("u2", "a1", "user", "第二问"),
    msg("a2", "u2", "assistant", "第二答"),
    msg("u3", "a2", "user", "第三问"),
    msg("a3", "u3", "assistant", "第三答"),
  ];
  writeFileSync(
    file,
    lines.map((line) => `${JSON.stringify(line)}\n`).join(""),
  );
  return file;
}

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rewind-file-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.useRealTimers();
});

describe("rewriteSessionFileTo", () => {
  it("truncates after the keep entry and leaves the file reopenable", async () => {
    const file = writeSession(dir);
    const before = readFileSync(file, "utf8");

    const result = await rewriteSessionFileTo(file, "a1");

    expect(result.keptEntries).toBe(2); // u1, a1
    const reopened = PiSessionManager.open(file);
    expect(reopened.getLeafId()).toBe("a1");
    expect(reopened.getEntryCount()).toBe(2);
    // 比对 id 而不是字节：pi 可能在 load 时迁移/归一化 entry，序列化字节不可依赖
    expect(reopened.getBranch("a1").map((entry) => entry.id)).toEqual([
      "u1",
      "a1",
    ]);
    expect(readFileSync(result.backupPath, "utf8")).toBe(before);
  });

  it("keeps the trailing newline so reopening does not append a line", async () => {
    const file = writeSession(dir);
    await rewriteSessionFileTo(file, "a1");
    expect(readFileSync(file, "utf8").endsWith("\n")).toBe(true);
  });

  it("only prunes backups of this session file", async () => {
    const file = writeSession(dir);
    const other = writeSession(dir, "other.jsonl");
    writeFileSync(`${other}.rewind-1.bak`, "x");

    await rewriteSessionFileTo(file, "a1");
    // 伪造一份更旧的备份，验证下一次调用只清本文件的旧快照
    writeFileSync(join(dir, "sess.jsonl.rewind-1.bak"), "stale");
    await rewriteSessionFileTo(file, "u1");

    const names = readdirSync(dir);
    expect(
      names.filter((name) => name.startsWith("sess.jsonl.rewind-")),
    ).toHaveLength(1);
    expect(names).not.toContain("sess.jsonl.rewind-1.bak");
    expect(names).toContain("other.jsonl.rewind-1.bak");
  });

  it("refuses an unknown keep entry and leaves the file untouched", async () => {
    const file = writeSession(dir);
    const before = readFileSync(file, "utf8");
    await expect(rewriteSessionFileTo(file, "missing")).rejects.toThrow();
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("backs up the original bytes even when pi migrates on open", async () => {
    // 缺 version 的旧文件：pi 打开时会迁移并重写，所以备份必须发生在 open 之前
    const file = join(dir, "legacy.jsonl");
    const original = [
      { ...HEADER, version: undefined },
      msg("u1", null, "user", "第一问"),
      msg("a1", "u1", "assistant", "第一答"),
    ]
      .map((line) => `${JSON.stringify(line)}\n`)
      .join("");
    writeFileSync(file, original);

    await expect(rewriteSessionFileTo(file, "a1")).rejects.toThrow();

    const backups = readdirSync(dir).filter((name) =>
      name.startsWith("legacy.jsonl.rewind-"),
    );
    expect(backups).toHaveLength(1);
    expect(readFileSync(join(dir, backups[0]), "utf8")).toBe(original);
  });

  it("refuses a compaction whose firstKeptEntryId is outside the kept prefix", async () => {
    const file = join(dir, "compacted.jsonl");
    writeFileSync(
      file,
      [
        HEADER,
        msg("u1", null, "user", "第一问"),
        msg("a1", "u1", "assistant", "第一答"),
        {
          type: "compaction",
          id: "c1",
          parentId: "a1",
          timestamp: "2026-10-30T00:00:02.000Z",
          summary: "摘要",
          firstKeptEntryId: "a2", // 指向压缩点之后的条目：树不线性
          tokensBefore: 100,
        },
        msg("u2", "c1", "user", "第二问"),
      ]
        .map((line) => `${JSON.stringify(line)}\n`)
        .join(""),
    );
    const before = readFileSync(file, "utf8");
    await expect(rewriteSessionFileTo(file, "u2")).rejects.toThrow();
    expect(readFileSync(file, "utf8")).toBe(before);
  });
});

describe("AgentRunner.rewindSessionFile", () => {
  type RunnerHarness = {
    piSessions: Map<string, unknown>;
    sessionModelRuntimes: Map<string, unknown>;
    pendingSteerDeliveries: Map<string, unknown>;
    lastSteeringLengths: Map<string, unknown>;
    subagentTaps: Map<string, unknown>;
    subagentRegistryEntries: Map<string, unknown>;
    rewindSessionFile: AgentRunner["rewindSessionFile"];
  };

  /** 只装 rewind 用到的字段，避免构造完整 AgentRunner（会建 pi 会话与工具）。 */
  function makeRunner(cached: unknown): RunnerHarness {
    const runner = Object.create(AgentRunner.prototype) as RunnerHarness;
    runner.piSessions = new Map([["sess-1", cached]]);
    runner.sessionModelRuntimes = new Map([["sess-1", {}]]);
    runner.pendingSteerDeliveries = new Map();
    runner.lastSteeringLengths = new Map();
    runner.subagentTaps = new Map();
    runner.subagentRegistryEntries = new Map();
    return runner;
  }

  it("releases the cached pi session before touching the file", async () => {
    const file = writeSession(dir);
    const before = readFileSync(file, "utf8");
    vi.useFakeTimers();
    const runner = makeRunner({
      session: { dispose: vi.fn() },
      runtime: { dispose: () => new Promise(() => {}) }, // 永不 resolve
    });

    const pending = runner.rewindSessionFile("sess-1", file, "a1");
    const assertion = expect(pending).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(REWIND_DISPOSE_TIMEOUT_MS + 1);
    await assertion;

    expect(readFileSync(file, "utf8")).toBe(before);
    expect(runner.piSessions.size).toBe(0);
  });

  it("truncates after a clean dispose", async () => {
    const file = writeSession(dir);
    const dispose = vi.fn(async () => {});
    const runner = makeRunner({
      session: { dispose: vi.fn() },
      runtime: { dispose },
    });

    const result = await runner.rewindSessionFile("sess-1", file, "u2");

    expect(dispose).toHaveBeenCalledTimes(1);
    // 与 clearSdkSession 同一套清理：会话的 ModelRuntime 不能漏在注册表里
    expect(runner.sessionModelRuntimes.size).toBe(0);
    expect(result.keptEntries).toBe(3);
    expect(PiSessionManager.open(file).getLeafId()).toBe("u2");
  });
});
