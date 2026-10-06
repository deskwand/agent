import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  closeDatabase,
  initDatabase,
  type DatabaseInstance,
} from "../../main/db/database";
import { FeedService } from "../../main/feed/feed-service";
import type { FeedPhase } from "../../main/feed/feed-service";

const NOW = 1_700_000_000_000;

let dir: string;
let db: DatabaseInstance;

const modelReply = JSON.stringify({
  topics: [{ label: "Rust 异步运行时" }],
  queries: [{ q: "tokio", topic: "Rust 异步运行时", reason: "你在调 tokio" }],
  items: [
    {
      candidateId: 0,
      title: "标题",
      summary: "摘要",
      topic: "Rust 异步运行时",
      relevance: "相关",
      keep: true,
    },
  ],
});

function makeService(overrides: Record<string, unknown> = {}) {
  let counter = 0;
  const phases: FeedPhase[] = [];
  const events: unknown[] = [];
  const service = new FeedService({
    db,
    getConfig: () => ({ enabled: true, blockedTopics: [] }),
    setFeedConfig: vi.fn(),
    fetchSignalsSources: () => ({
      readCoreMemory: () => ({ "interests:Rust": "Rust 异步运行时" }),
      listRecentSessions: () => [],
      readUserMessages: () => [],
    }),
    locale: () => "zh",
    complete: vi.fn(async () => modelReply),
    searchWeb: vi.fn(async () => [
      {
        query: "tokio",
        answer: "",
        error: null,
        results: [{ url: "https://a.com/1", title: "A", snippet: "片段" }],
      },
    ]),
    fetchPages: vi.fn(async () => [
      {
        url: "https://a.com/1",
        title: "A",
        content: "正".repeat(200),
        error: null,
      },
    ]),
    downloadImage: vi.fn(async () => ({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "image/jpeg",
    })),
    imagesDir: join(dir, "feed-images"),
    now: () => NOW,
    id: () => `id${(counter += 1)}`,
    onPhase: (phase: FeedPhase) => phases.push(phase),
    onUpdated: (payload: unknown) => events.push(payload),
    ...overrides,
  });
  return { service, phases, events };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "feed-service-"));
  db = initDatabase(join(dir, "cowork.db"));
});
afterEach(() => {
  closeDatabase();
  rmSync(dir, { recursive: true, force: true });
});

describe("FeedService.refresh", () => {
  it("跑通全链路：写 run、写条目、未读为 1、依次推阶段", async () => {
    const { service, phases } = makeService();
    const result = await service.refresh("manual");
    expect(result.started).toBe(true);
    expect(db.feedItems.countAll()).toBe(1);
    expect(db.feedItems.unreadCount()).toBe(1);
    expect(db.feedRuns.latest()?.status).toBe("ok");
    expect(db.feedRuns.latest()?.item_count).toBe(1);
    expect(phases).toEqual([
      "signals",
      "queries",
      "collect",
      "fetch",
      "compose",
      "image",
    ]);
  });

  it("信号全空时跳过，不写 run", async () => {
    const { service } = makeService({
      fetchSignalsSources: () => ({
        readCoreMemory: () => ({}),
        listRecentSessions: () => [],
        readUserMessages: () => [],
      }),
    });
    expect(await service.refresh("manual")).toEqual({
      started: false,
      reason: "skipped",
    });
    expect(db.feedRuns.latest()).toBeNull();
  });

  it("全部搜索失败时 run 记为 failed 且不写条目", async () => {
    const { service } = makeService({
      searchWeb: vi.fn(async () => [
        { query: "tokio", answer: "", results: [], error: "no provider" },
      ]),
    });
    await service.refresh("manual");
    expect(db.feedRuns.latest()?.status).toBe("failed");
    expect(db.feedItems.countAll()).toBe(0);
    expect(db.feedRuns.latest()?.error).toBeTruthy();
  });

  it("搜索成功但没有可用候选时记为 partial（不是 failed）", async () => {
    const { service } = makeService({
      searchWeb: vi.fn(async () => [
        { query: "tokio", answer: "", error: null, results: [] },
      ]),
    });
    await service.refresh("manual");
    expect(db.feedRuns.latest()?.status).toBe("partial");
  });

  it("配图下载失败时条目仍然入库，image_status = failed", async () => {
    const { service } = makeService({
      fetchPages: vi.fn(async () => [
        {
          url: "https://a.com/1",
          title: "A",
          content: "正".repeat(200),
          error: null,
          imageUrl: "https://a.com/x.jpg",
        },
      ]),
      downloadImage: vi.fn(async () => null),
    });
    await service.refresh("manual");
    const item = db.feedItems.listVisible(10)[0];
    expect(item?.image_status).toBe("failed");
    expect(item?.image_file).toBeNull();
  });

  it("没有 og:image 时 image_status = none，不调下载器", async () => {
    const downloadImage = vi.fn();
    const { service } = makeService({ downloadImage });
    await service.refresh("manual");
    expect(db.feedItems.listVisible(10)[0]?.image_status).toBe("none");
    expect(downloadImage).not.toHaveBeenCalled();
  });

  it("手动刷新在 10 分钟内被限流，自动路径不受限", async () => {
    // 每次读时钟都前进一秒：否则两条 run 的 started_at 相同，latest() 取谁都不确定
    let clock = NOW;
    const { service } = makeService({ now: () => (clock += 1000) });
    await service.refresh("manual");
    expect(await service.refresh("manual")).toEqual({
      started: false,
      reason: "tooSoon",
    });
    // 自动路径不该被限流拦住：它确实又跑了一次（写了新的 run 行）
    await service.refresh("schedule");
    expect(db.feedRuns.latest()?.trigger).toBe("schedule");
  });

  it("setEnabled(true) 会立刻生成一次且 trigger = enable", async () => {
    const { service } = makeService();
    await service.setEnabled(true);
    expect(db.feedRuns.latest()?.trigger).toBe("enable");
  });

  it("setEnabled(false) 不删任何行，也不生成", async () => {
    const { service } = makeService();
    await service.refresh("manual");
    await service.setEnabled(false);
    expect(db.feedItems.countAll()).toBe(1);
    expect(db.feedRuns.latest()?.trigger).toBe("manual");
  });

  it("同一次 refresh 内部不重入", async () => {
    const gate: { release: (() => void) | null } = { release: null };
    const fetchPages = vi.fn(
      () =>
        new Promise<never[]>((resolve) => {
          gate.release = () => resolve([]);
        }),
    );
    const { service } = makeService({ fetchPages });
    const first = service.refresh("manual");
    await vi.waitFor(() => expect(fetchPages).toHaveBeenCalled());
    expect(await service.refresh("schedule")).toEqual({
      started: false,
      reason: "running",
    });
    gate.release?.();
    await first;
  });
});

describe("FeedService 读与改", () => {
  it("list 返回未读数与最近一次 run，且条目不含 body", async () => {
    const { service } = makeService();
    await service.refresh("manual");
    const snapshot = service.list();
    expect(snapshot.unreadCount).toBe(1);
    expect(snapshot.lastRun).toBeTruthy();
    expect(Object.keys(snapshot.items[0])).not.toContain("body");
  });

  it("list 的条目里 imageUrl 是主进程签好的 URL（不是文件名）", async () => {
    const { service } = makeService({
      fetchPages: vi.fn(async () => [
        {
          url: "https://a.com/1",
          title: "A",
          content: "正".repeat(200),
          error: null,
          imageUrl: "https://a.com/x.jpg",
        },
      ]),
    });
    await service.refresh("manual");
    expect(service.list().items[0].imageUrl).toContain(
      "deskwand-feed-image://",
    );
  });

  it("getBody 单独取正文", async () => {
    const { service } = makeService();
    await service.refresh("manual");
    const id = service.list().items[0].id;
    expect(service.getBody(id)?.body).toContain("正");
    expect(service.getBody("nope")).toBeNull();
  });

  it("markRead / markAllRead / dismiss 返回新的未读数", async () => {
    const { service } = makeService();
    await service.refresh("manual");
    const id = service.list().items[0].id;
    expect(service.markRead(id)).toBe(0);
    expect(service.markAllRead()).toBe(0);
    expect(service.dismiss(id)).toBe(0);
  });

  it("clearAll 删条目与配图，但保留 feed_runs", async () => {
    const { service } = makeService();
    await service.refresh("manual");
    expect(await service.clearAll()).toBe(0);
    expect(db.feedItems.countAll()).toBe(0);
    expect(db.feedRuns.latest()).toBeTruthy();
  });

  it("recover 把没结束的 run 标成 failed/interrupted", async () => {
    const { service } = makeService();
    db.feedRuns.insert({
      id: "stale",
      started_at: NOW - 1000,
      finished_at: null,
      status: "running",
      trigger: "schedule",
      error: null,
      queries: null,
      topics: null,
      candidate_count: 0,
      item_count: 0,
    });
    await service.recover();
    expect(db.feedRuns.latest()?.status).toBe("failed");
    expect(db.feedRuns.latest()?.error).toBe("interrupted");
  });

  it("被标记「不感兴趣」的链接第二天不会再进候选（跨天去重含已移除）", async () => {
    const { service } = makeService();
    await service.refresh("manual");
    const id = service.list().items[0].id;
    service.dismiss(id);

    // 第二次生成：搜索仍然返回同一个 URL，但它已经被移除过，不该再进候选
    // （id 换前缀，否则两个 service 的自增计数器会撞上同一个 run id）
    let seq = 0;
    const second = makeService({
      now: () => NOW + 25 * 60 * 60 * 1000,
      id: () => `b${(seq += 1)}`,
    });
    await second.service.refresh("schedule");
    expect(db.feedItems.countAll()).toBe(1);
    expect(db.feedRuns.latest()?.status).toBe("partial");
  });

  it("连续失败 3 次后 hasExceededFailureBudget 为真", async () => {
    const { service } = makeService({
      searchWeb: vi.fn(async () => [
        { query: "tokio", answer: "", results: [], error: "boom" },
      ]),
    });
    expect(service.hasExceededFailureBudget()).toBe(false);
    await service.refresh("schedule");
    await service.refresh("schedule");
    await service.refresh("schedule");
    expect(service.consecutiveFailures()).toBe(3);
    expect(service.hasExceededFailureBudget()).toBe(true);
  });
});

describe("FeedService.cleanup", () => {
  it("删掉超过 30 天的条目", async () => {
    const { service } = makeService();
    await service.refresh("manual");
    expect(db.feedItems.countAll()).toBe(1);
    const later = makeService({ now: () => NOW + 31 * 24 * 60 * 60 * 1000 });
    await later.service.cleanup();
    expect(db.feedItems.countAll()).toBe(0);
  });
});
