import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createUsageSchema, queryUsage } from "../../main/usage/usage-store";
import { backfillUsageFromSessions } from "../../main/usage/usage-backfill";
import {
  backfillSubagentUsageFromSessions,
  parentSessionIdOf,
} from "../../main/usage/usage-subagent-backfill";

const PARENT_ID = "0bb1a867-5c43-45cb-b21a-c662684cb036";

/** 一行：子会话文件头。`parentSession` 指向 deskwand 会话根里的父会话文件。 */
function header(childId: string, parentSession?: string): string {
  return JSON.stringify({
    type: "session",
    version: 3,
    id: childId,
    timestamp: "2026-09-15T15:05:33.888Z",
    cwd: "/tmp/project",
    ...(parentSession ? { parentSession } : {}),
  });
}

function assistant(
  id: string,
  provider: string,
  model: string,
  ts: number,
  u: object,
): string {
  return JSON.stringify({
    type: "message",
    id,
    timestamp: new Date(ts).toISOString(),
    message: { role: "assistant", provider, model, timestamp: ts, usage: u },
  });
}

describe("backfillSubagentUsageFromSessions", () => {
  let root: string;
  let deskwandRoot: string;
  let db: DatabaseSync;

  beforeEach(() => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "deskwand-subagent-"));
    root = path.join(base, "sessions");
    deskwandRoot = path.join(base, "pi-sessions");
    fs.mkdirSync(path.join(root, "--tmp-project--"), { recursive: true });
    fs.mkdirSync(path.join(deskwandRoot, PARENT_ID), { recursive: true });
    db = new DatabaseSync(":memory:");
    createUsageSchema(db);
  });
  afterEach(() => db.close());

  const parentPath = () =>
    path.join(
      deskwandRoot,
      PARENT_ID,
      "2026-09-06T14-13-51-088Z_01a07711.jsonl",
    );

  it("imports assistant messages of a child session, keyed by child+entry", async () => {
    fs.writeFileSync(
      path.join(root, "--tmp-project--", "child.jsonl"),
      [
        header("child-1", parentPath()),
        assistant(
          "e1",
          "deskwand:deepseek",
          "deepseek-flash",
          1_760_000_000_000,
          {
            input: 100,
            output: 20,
            cacheRead: 3000,
            cacheWrite: 0,
          },
        ),
        // user 行与非 assistant 行必须被忽略
        JSON.stringify({
          type: "message",
          id: "u1",
          message: { role: "user", content: [] },
        }),
        JSON.stringify({
          type: "model_change",
          id: "m1",
          provider: "x",
          modelId: "y",
        }),
      ].join("\n"),
    );

    const result = await backfillSubagentUsageFromSessions(
      db,
      root,
      deskwandRoot,
    );
    expect(result).toMatchObject({
      scanned: 1,
      inserted: 1,
      filesChanged: 1,
      rootUnreadable: false,
    });

    const row = db
      .prepare("SELECT * FROM usage_records WHERE source = 'subagent'")
      .get() as unknown as Record<string, unknown>;
    expect(row).toMatchObject({
      ts: 1_760_000_000_000,
      session_id: PARENT_ID,
      provider: "deskwand:deepseek",
      model: "deepseek-flash",
      input: 100,
      output: 20,
      cache_read: 3000,
      dedup_key: "submsg:child-1:e1",
    });
  });

  it("is idempotent across passes", async () => {
    fs.writeFileSync(
      path.join(root, "--tmp-project--", "child.jsonl"),
      [
        header("child-1", parentPath()),
        assistant("e1", "p", "m", 1, { input: 5, output: 6 }),
      ].join("\n"),
    );
    await backfillSubagentUsageFromSessions(db, root, deskwandRoot);
    const second = await backfillSubagentUsageFromSessions(
      db,
      root,
      deskwandRoot,
    );
    // 第二次不重扫（指纹命中），且行数不变
    expect(second.filesChanged).toBe(0);
    expect(second.filesUnchanged).toBe(1);
    const count = db
      .prepare("SELECT COUNT(*) AS n FROM usage_records")
      .get() as unknown as { n: number };
    expect(count.n).toBe(1);
  });

  it("keeps its fingerprints in its own table, out of the chat pass's pruner", async () => {
    // 主回填的 pruneScanRows() 会删掉 usage_scan_files 里不在它自己遍历结果里的行，
    // 所以子代理指纹必须落在自己的表里 —— 否则每轮启动都被删一次、每轮重读全部文件
    fs.writeFileSync(
      path.join(root, "--tmp-project--", "child.jsonl"),
      [
        header("child-1", parentPath()),
        assistant("e1", "p", "m", 1, { input: 5, output: 6 }),
      ].join("\n"),
    );
    await backfillSubagentUsageFromSessions(db, root, deskwandRoot);
    const mine = db
      .prepare("SELECT COUNT(*) AS n FROM usage_scan_subagent_files")
      .get() as unknown as { n: number };
    const theirs = db
      .prepare("SELECT COUNT(*) AS n FROM usage_scan_files")
      .get() as unknown as { n: number };
    expect(mine.n).toBe(1);
    expect(theirs.n).toBe(0);
  });

  it("skips sessions that are not deskwand subagents", async () => {
    // 用户自己跑的 pi CLI 会话：没有 parentSession
    fs.writeFileSync(
      path.join(root, "--tmp-project--", "cli.jsonl"),
      [
        header("cli-1"),
        assistant("e1", "openai", "gpt-5.4", 1, { input: 1, output: 1 }),
      ].join("\n"),
    );
    // 别的工具发起的子代理：parentSession 不在 deskwand 会话根内
    fs.writeFileSync(
      path.join(root, "--tmp-project--", "other.jsonl"),
      [
        header("other-1", "/somewhere/else/sessions/abc/def.jsonl"),
        assistant("e1", "openai", "gpt-5.4", 1, { input: 2, output: 2 }),
      ].join("\n"),
    );

    const result = await backfillSubagentUsageFromSessions(
      db,
      root,
      deskwandRoot,
    );
    expect(result.inserted).toBe(0);
    // 仍记指纹，避免每轮重读
    expect(result.filesChanged).toBe(2);
    const count = db
      .prepare("SELECT COUNT(*) AS n FROM usage_records")
      .get() as unknown as { n: number };
    expect(count.n).toBe(0);
  });

  it("splits one child session across the models it used", async () => {
    fs.writeFileSync(
      path.join(root, "--tmp-project--", "child.jsonl"),
      [
        header("child-1", parentPath()),
        assistant(
          "e1",
          "deskwand:deepseek",
          "deepseek-flash",
          1_760_000_000_000,
          {
            input: 10,
            output: 1,
          },
        ),
        assistant(
          "e2",
          "deskwand:deepseek",
          "deepseek-v4-flash-vision-exp",
          1_760_000_001_000,
          {
            input: 20,
            output: 2,
          },
        ),
      ].join("\n"),
    );
    await backfillSubagentUsageFromSessions(db, root, deskwandRoot);
    const span = queryUsage(db, "all", 1_800_000_000_000);
    const models = span.byModel.map((r) => `${r.provider}/${r.model}`).sort();
    expect(models).toEqual([
      "deskwand:deepseek/deepseek-flash",
      "deskwand:deepseek/deepseek-v4-flash-vision-exp",
    ]);
  });

  it("survives the chat pass running between two subagent passes", async () => {
    // 真实启动顺序：子代理 pass → （下次启动）主对话 pass → 子代理 pass。
    // 主回填的 pruneScanRows() 会把不在**它自己**遍历结果里的指纹行删掉，
    // 所以这里验证子代理指纹没被它带走 —— 否则每轮都要重读全部文件。
    const chatRoot = path.join(path.dirname(root), "pi-sessions");
    fs.writeFileSync(
      path.join(root, "--tmp-project--", "child.jsonl"),
      [
        header("child-1", parentPath()),
        assistant("e1", "p", "m", 1, { input: 5, output: 6 }),
      ].join("\n"),
    );

    await backfillSubagentUsageFromSessions(db, root, deskwandRoot);
    await backfillUsageFromSessions(db, chatRoot);
    const again = await backfillSubagentUsageFromSessions(
      db,
      root,
      deskwandRoot,
    );

    expect(again.filesChanged).toBe(0);
    expect(again.filesUnchanged).toBe(1);
  });

  it("re-imports a resumed child session without duplicating rows", async () => {
    const file = path.join(root, "--tmp-project--", "child.jsonl");
    const first = [
      header("child-1", parentPath()),
      assistant("e1", "p", "m", 1, { input: 5, output: 6 }),
    ];
    fs.writeFileSync(file, first.join("\n"));
    await backfillSubagentUsageFromSessions(db, root, deskwandRoot);

    // 会话被 resume：同一文件追加新消息（文件变了 → 指纹失效 → 重读整个文件）
    fs.writeFileSync(
      file,
      [
        ...first,
        assistant("e2", "p", "m", 2, { input: 7, output: 8 }),
        assistant("e3", "p2", "m2", 3, { input: 9, output: 10 }),
      ].join("\n"),
    );
    const second = await backfillSubagentUsageFromSessions(
      db,
      root,
      deskwandRoot,
    );

    expect(second.filesChanged).toBe(1);
    expect(second.inserted).toBe(2);
    expect(second.skipped).toBe(1); // e1 已导入过
    const count = db
      .prepare("SELECT COUNT(*) AS n FROM usage_records")
      .get() as unknown as { n: number };
    expect(count.n).toBe(3);
  });

  it("prunes the fingerprint of a vanished file but keeps its rows", async () => {
    const file = path.join(root, "--tmp-project--", "child.jsonl");
    fs.writeFileSync(
      file,
      [
        header("child-1", parentPath()),
        assistant("e1", "p", "m", 1, { input: 5, output: 6 }),
      ].join("\n"),
    );
    await backfillSubagentUsageFromSessions(db, root, deskwandRoot);
    fs.rmSync(file);

    const second = await backfillSubagentUsageFromSessions(
      db,
      root,
      deskwandRoot,
    );
    expect(second.filesChanged).toBe(0);
    const prints = db
      .prepare("SELECT COUNT(*) AS n FROM usage_scan_subagent_files")
      .get() as unknown as { n: number };
    // 指纹被清掉（否则表会随用户删过的会话无限增长），但已导入的用量保留
    expect(prints.n).toBe(0);
    const rows = db
      .prepare("SELECT COUNT(*) AS n FROM usage_records")
      .get() as unknown as { n: number };
    expect(rows.n).toBe(1);
  });

  it("counts a message that has usage but no entry id instead of dropping it silently", async () => {
    fs.writeFileSync(
      path.join(root, "--tmp-project--", "child.jsonl"),
      [
        header("child-1", parentPath()),
        JSON.stringify({
          type: "message",
          timestamp: "2026-09-15T15:05:34.000Z",
          message: {
            role: "assistant",
            provider: "p",
            model: "m",
            timestamp: 1,
            usage: { input: 5, output: 6 },
          },
        }),
      ].join("\n"),
    );
    const result = await backfillSubagentUsageFromSessions(
      db,
      root,
      deskwandRoot,
    );
    expect(result.malformed).toBe(1);
    expect(result.scanned).toBe(0);
  });

  it("reports an unreadable root instead of pretending the corpus is empty", async () => {
    const result = await backfillSubagentUsageFromSessions(
      db,
      path.join(root, "nope"),
      deskwandRoot,
    );
    expect(result.rootUnreadable).toBe(true);
    expect(result.inserted).toBe(0);
  });
});

describe("parentSessionIdOf", () => {
  it("takes the session directory out of the parent path", () => {
    expect(
      parentSessionIdOf(
        `/home/u/.deskwand/pi-sessions/${PARENT_ID}/2026.jsonl`,
        "/home/u/.deskwand/pi-sessions",
      ),
    ).toBe(PARENT_ID);
  });

  it("rejects a parent on another Windows drive", () => {
    // 跨盘符时 win32.relative 会返回对方盘符的绝对路径（"D:\\b\\f.jsonl"），
    // 既不以 ".." 开头也不是 POSIX 绝对路径 —— 只判这两条会把 "D:" 当会话 id
    expect(
      parentSessionIdOf("D:\\b\\f.jsonl", "/home/u/.deskwand/pi-sessions"),
    ).toBeNull();
    expect(
      parentSessionIdOf(
        "D:\\pi-sessions\\0bb1a867\\2026.jsonl",
        "C:\\Users\\u\\.deskwand\\pi-sessions",
      ),
    ).toBeNull();
  });

  it("returns null for a parent outside the deskwand root", () => {
    expect(
      parentSessionIdOf(
        "/elsewhere/sessions/abc/def.jsonl",
        "/home/u/.deskwand/pi-sessions",
      ),
    ).toBeNull();
    expect(parentSessionIdOf("", "/home/u/.deskwand/pi-sessions")).toBeNull();
  });
});
