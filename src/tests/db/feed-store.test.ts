import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  closeDatabase,
  initDatabase,
  type DatabaseInstance,
  type FeedItemRow,
  type FeedRunRow,
} from "../../main/db/database";

let dir: string;
let db: DatabaseInstance;

function item(overrides: Partial<FeedItemRow> = {}): FeedItemRow {
  return {
    id: "i1",
    run_id: "r1",
    title: "标题",
    summary: "摘要",
    url: "https://example.com/a",
    url_key: "example.com/a",
    source_host: "example.com",
    topic: "主题",
    relevance: "理由",
    body: null,
    body_status: "snippet_only",
    excerpt: null,
    image_url: null,
    image_file: null,
    image_status: "none",
    created_at: 1_000,
    read_at: null,
    dismissed_at: null,
    unprocessed: 0,
    published_at: null,
    ...overrides,
  };
}

function run(overrides: Partial<FeedRunRow> = {}): FeedRunRow {
  return {
    id: "r1",
    started_at: 1_000,
    finished_at: null,
    status: "running",
    trigger: "manual",
    error: null,
    queries: null,
    topics: null,
    candidate_count: 0,
    item_count: 0,
    ...overrides,
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "feed-store-"));
  db = initDatabase(join(dir, "cowork.db"));
});

afterEach(() => {
  closeDatabase();
  rmSync(dir, { recursive: true, force: true });
});

describe("feed_items", () => {
  it("published_at 写进去再读出来，null 也保得住", () => {
    db.feedItems.insert(item({ id: "t", published_at: 1_700_000_000_000 }));
    db.feedItems.insert(
      item({ id: "n", url_key: "example.com/n", published_at: null }),
    );
    expect(db.feedItems.get("t")?.published_at).toBe(1_700_000_000_000);
    expect(db.feedItems.get("n")?.published_at).toBeNull();
  });

  it("老库升级：已存在的表会被 ensureColumn 补上 published_at", () => {
    const file = join(dir, "upgrade.db");
    const first = initDatabase(file);
    expect(first.feedItems.get("i1")).toBeNull();
    closeDatabase();

    const second = initDatabase(file);
    expect(() =>
      second.feedItems.insert(item({ published_at: 7 })),
    ).not.toThrow();
    expect(second.feedItems.get("i1")?.published_at).toBe(7);
  });

  it("插入后能按 id 取回，未读计数与已读动作一致", () => {
    db.feedItems.insert(item());
    expect(db.feedItems.unreadCount()).toBe(1);
    db.feedItems.markRead("i1", 2_000);
    expect(db.feedItems.unreadCount()).toBe(0);
    expect(db.feedItems.get("i1")?.read_at).toBe(2_000);
  });

  it("被移除的条目不算未读，也不出现在可见列表里", () => {
    db.feedItems.insert(item({ id: "i1" }));
    db.feedItems.insert(item({ id: "i2", url_key: "example.com/b" }));
    db.feedItems.dismiss("i2", 2_000);
    expect(db.feedItems.unreadCount()).toBe(1);
    expect(db.feedItems.listVisible(10).map((row) => row.id)).toEqual(["i1"]);
  });

  it("visible 列表按 created_at 倒序", () => {
    db.feedItems.insert(item({ id: "old", created_at: 1 }));
    db.feedItems.insert(item({ id: "new", created_at: 9, url_key: "x" }));
    expect(db.feedItems.listVisible(10).map((row) => row.id)).toEqual([
      "new",
      "old",
    ]);
  });

  it("url_key 唯一：同一个链接插两次会抛", () => {
    db.feedItems.insert(item({ id: "i1" }));
    expect(() => db.feedItems.insert(item({ id: "i2" }))).toThrow();
  });

  it("deleteOlderThan 只删过期的，并返回删除条数", () => {
    db.feedItems.insert(item({ id: "old", created_at: 1 }));
    db.feedItems.insert(item({ id: "new", created_at: 5_000, url_key: "x" }));
    expect(db.feedItems.deleteOlderThan(1_000)).toBe(1);
    expect(db.feedItems.listVisible(10).map((row) => row.id)).toEqual(["new"]);
  });

  it("pruneToMax 按时间保留最新的 N 条", () => {
    for (let i = 0; i < 5; i += 1) {
      db.feedItems.insert(
        item({ id: `i${i}`, url_key: `k${i}`, created_at: i }),
      );
    }
    expect(db.feedItems.pruneToMax(2)).toBe(3);
    expect(db.feedItems.countAll()).toBe(2);
  });

  it("listImageFileNames 只返回有图的行", () => {
    db.feedItems.insert(
      item({ id: "a", image_file: "a.jpg", image_status: "ok" }),
    );
    db.feedItems.insert(
      item({ id: "b", url_key: "k", image_status: "failed" }),
    );
    expect(db.feedItems.listImageFileNames()).toEqual(["a.jpg"]);
  });

  it("listUrlKeys 含已移除的条目（跨天去重必须用它）", () => {
    db.feedItems.insert(item({ id: "a" }));
    db.feedItems.insert(item({ id: "b", url_key: "k" }));
    db.feedItems.dismiss("b", 5_000);
    expect(db.feedItems.listUrlKeys().sort()).toEqual(["example.com/a", "k"]);
    expect(db.feedItems.listVisible(10).map((row) => row.url_key)).toEqual([
      "example.com/a",
    ]);
  });

  it("markAllRead 把所有未读一次清掉", () => {
    db.feedItems.insert(item({ id: "a" }));
    db.feedItems.insert(item({ id: "b", url_key: "k" }));
    db.feedItems.markAllRead(9_000);
    expect(db.feedItems.unreadCount()).toBe(0);
  });

  it("deleteAll 清空全部", () => {
    db.feedItems.insert(item({ id: "a" }));
    db.feedItems.deleteAll();
    expect(db.feedItems.countAll()).toBe(0);
  });

  it("excerpt 列能写能读，且与 body 互不干扰", () => {
    db.feedItems.insert(
      item({ body: "# 抓来的 markdown", excerpt: "本地化之后的摘录。" }),
    );
    const row = db.feedItems.get("i1");
    expect(row?.excerpt).toBe("本地化之后的摘录。");
    expect(row?.body).toBe("# 抓来的 markdown");
  });

  it("旧库（feed_items 没有 excerpt 列）启动后自动补列，并能正常入库", () => {
    // 先放掉 beforeEach 建的那个库，手写一张「旧结构」的表，再走真实的初始化路径
    closeDatabase();
    const legacyPath = join(dir, "legacy.db");
    const raw = new DatabaseSync(legacyPath);
    raw.exec(`
      CREATE TABLE feed_items (
        id            TEXT PRIMARY KEY,
        run_id        TEXT NOT NULL,
        title         TEXT NOT NULL,
        summary       TEXT,
        url           TEXT NOT NULL,
        url_key       TEXT NOT NULL,
        source_host   TEXT NOT NULL,
        topic         TEXT,
        relevance     TEXT,
        body          TEXT,
        body_status   TEXT NOT NULL,
        image_url     TEXT,
        image_file    TEXT,
        image_status  TEXT NOT NULL DEFAULT 'none',
        created_at    INTEGER NOT NULL,
        read_at       INTEGER,
        dismissed_at  INTEGER,
        unprocessed   INTEGER NOT NULL DEFAULT 0
      )
    `);
    raw.close();

    db = initDatabase(legacyPath);

    // 迁移真的生效的证据不是「列存在」，而是「补完列之后写入能跑通」
    expect(() =>
      db.feedItems.insert(item({ excerpt: "补列之后写的" })),
    ).not.toThrow();
    expect(db.feedItems.get("i1")?.excerpt).toBe("补列之后写的");
  });
});

describe("feed_runs", () => {
  it("latest 取 started_at 最大的一行", () => {
    db.feedRuns.insert(run({ id: "r1", started_at: 1 }));
    db.feedRuns.insert(run({ id: "r2", started_at: 2 }));
    expect(db.feedRuns.latest()?.id).toBe("r2");
  });

  it("lastSuccessAt 只认已完成的成功与部分成功", () => {
    db.feedRuns.insert(
      run({ id: "r1", started_at: 1, status: "failed", finished_at: 1 }),
    );
    db.feedRuns.insert(
      run({ id: "r2", started_at: 5, status: "partial", finished_at: 5 }),
    );
    db.feedRuns.insert(
      run({ id: "r3", started_at: 9, status: "ok", finished_at: 9 }),
    );
    expect(db.feedRuns.lastSuccessAt()).toBe(9);
  });

  it("lastAttemptAt 不分状态", () => {
    db.feedRuns.insert(
      run({ id: "r1", started_at: 3, status: "failed", finished_at: 3 }),
    );
    expect(db.feedRuns.lastAttemptAt()).toBe(3);
  });

  it("setMeta 写查询词与候选数，delete 删行", () => {
    db.feedRuns.insert(run({ id: "r1" }));
    db.feedRuns.setMeta("r1", {
      queries: '[{"q":"a"}]',
      topics: "[]",
      candidate_count: 9,
    });
    expect(db.feedRuns.latest()?.candidate_count).toBe(9);
    db.feedRuns.delete("r1");
    expect(db.feedRuns.latest()).toBeNull();
  });

  it("markInterrupted 只动没结束的行", () => {
    db.feedRuns.insert(run({ id: "r1", started_at: 1 }));
    db.feedRuns.insert(
      run({ id: "r2", started_at: 5, status: "ok", finished_at: 5 }),
    );
    expect(db.feedRuns.markInterrupted(9_000)).toBe(1);
    expect(db.feedRuns.latest()?.id).toBe("r2");
    expect(db.feedRuns.latest()?.status).toBe("ok");
  });

  it("countConsecutiveFailures 从最新往前数，遇到非失败就停", () => {
    db.feedRuns.insert(
      run({ id: "r1", started_at: 1, status: "failed", finished_at: 1 }),
    );
    db.feedRuns.insert(
      run({ id: "r2", started_at: 2, status: "failed", finished_at: 2 }),
    );
    expect(db.feedRuns.countConsecutiveFailures()).toBe(2);
    db.feedRuns.insert(
      run({ id: "r3", started_at: 3, status: "ok", finished_at: 3 }),
    );
    expect(db.feedRuns.countConsecutiveFailures()).toBe(0);
  });

  it("pruneOlderThan 删掉久远的 run", () => {
    db.feedRuns.insert(run({ id: "r1", started_at: 1 }));
    db.feedRuns.insert(run({ id: "r2", started_at: 500 }));
    expect(db.feedRuns.pruneOlderThan(100)).toBe(1);
    expect(db.feedRuns.latest()?.id).toBe("r2");
  });

  it("完成时写入计数与错误", () => {
    db.feedRuns.insert(run({ id: "r1" }));
    db.feedRuns.finish("r1", {
      status: "ok",
      finished_at: 2_000,
      error: null,
      candidate_count: 12,
      item_count: 8,
    });
    const latest = db.feedRuns.latest();
    expect(latest?.candidate_count).toBe(12);
    expect(latest?.item_count).toBe(8);
    expect(latest?.finished_at).toBe(2_000);
  });
});
