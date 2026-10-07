/**
 * @module main/feed/feed-service
 *
 * 把管线的五步串起来，管住库、未读数、清理与开关（设计 §6、§7、§9）。
 * 所有外部依赖都是注入的，所以这个文件能整条用假实现跑测试。
 */
import type {
  DatabaseInstance,
  FeedItemRow,
  FeedRunStatus,
  FeedTrigger,
} from "../db/database";
import type { FeedConfig } from "../config/config-store";
import type { QueryResultData } from "../agent/tools/web-access/types";
import {
  collectSignals,
  type FeedSignalSources,
  type FeedSignals,
} from "./feed-signals";
import { planQueries, type FeedComplete } from "./feed-queries";
import {
  clampPublished,
  collectCandidates,
  normalizeUrlKey,
} from "./feed-collect";
import type { SourceBucket } from "./sources/index";
import { fetchCandidateBodies, type FeedFetchPage } from "./feed-fetch";
import { composeItems } from "./feed-compose";
import { writeExcerpts } from "./feed-excerpt";
import {
  downloadFeedImage,
  pruneOrphanImages,
  type FeedImageDownloader,
} from "./feed-image";
import { buildFeedImageUrl } from "./feed-image-protocol";
import type {
  FeedBodyPayload,
  FeedPhase,
  FeedSnapshot,
} from "../../shared/feed";
import { logError, logWarn } from "../utils/logger";

export const REFRESH_THROTTLE_MS = 10 * 60 * 1000;
export const RETENTION_DAYS = 30;
export const MAX_ITEMS_KEPT = 1000;
export const MAX_CONSECUTIVE_FAILURES = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

/** 共享类型定义在 src/shared/feed.ts，这里只做转出，避免两边各写一份形状。 */
export type {
  FeedItemWithMeta,
  FeedPhase,
  FeedRunSummary,
  FeedSnapshot,
} from "../../shared/feed";

export interface FeedServiceDeps {
  db: DatabaseInstance;
  getConfig: () => FeedConfig;
  setFeedConfig: (patch: Partial<FeedConfig>) => void;
  fetchSignalsSources: () => FeedSignalSources;
  locale: () => string;
  complete: FeedComplete;
  searchWeb: (payload: { queries: string[] }) => Promise<QueryResultData[]>;
  /** 固定消息源；与搜索并行，谁失败都不影响对方。 */
  fetchSources: () => Promise<SourceBucket[]>;
  fetchPages: FeedFetchPage;
  downloadImage: FeedImageDownloader;
  imagesDir: string;
  now: () => number;
  id: () => string;
  onPhase: (phase: FeedPhase) => void;
  onUpdated: (payload: {
    unreadCount: number;
    runId: string | null;
    status: FeedRunStatus;
    phase?: FeedPhase;
  }) => void;
}

export class FeedService {
  private running = false;

  constructor(private readonly deps: FeedServiceDeps) {}

  /** 启动时调用：收尾遗留的 run + 清孤儿图（设计 §7、§8.9）。 */
  async recover(): Promise<void> {
    const interrupted = this.deps.db.feedRuns.markInterrupted(this.deps.now());
    if (interrupted > 0) {
      logWarn(`[feed] marked ${interrupted} interrupted run(s) as failed`);
    }
    const referenced = new Set(this.deps.db.feedItems.listImageFileNames());
    await pruneOrphanImages({ dir: this.deps.imagesDir, referenced });
  }

  async refresh(trigger: FeedTrigger): Promise<{
    started: boolean;
    reason?: "busy" | "running" | "tooSoon" | "skipped";
  }> {
    if (this.running) return { started: false, reason: "running" };

    const now = this.deps.now();
    if (trigger === "manual") {
      const latest = this.deps.db.feedRuns.latest();
      if (latest && now - latest.started_at < REFRESH_THROTTLE_MS) {
        return { started: false, reason: "tooSoon" };
      }
    }

    const runId = this.deps.id();
    this.running = true;
    this.deps.db.feedRuns.insert({
      id: runId,
      started_at: now,
      finished_at: null,
      status: "running",
      trigger,
      error: null,
      queries: null,
      topics: null,
      candidate_count: 0,
      item_count: 0,
    });

    let status: FeedRunStatus = "failed";
    try {
      const outcome = await this.runPipeline(runId, now);
      status = outcome.status;
      // status 只用于内部事件，不外泄给 IPC 调用方（它读的是 feed.list 的快照）
      const { status: _status, ...result } = outcome;
      return result;
    } finally {
      this.running = false;
      // status 必须用本次 run 自己的结果：读 latest() 可能在
      // 「空信号 → 删掉刚写的 run 行」那条路上拿到上一次 run 的状态
      this.deps.onUpdated({
        unreadCount: this.deps.db.feedItems.unreadCount(),
        runId,
        status,
      });
    }
  }

  private async runPipeline(
    runId: string,
    now: number,
  ): Promise<{ started: boolean; reason?: "skipped"; status: FeedRunStatus }> {
    const config = this.deps.getConfig();

    this.deps.onPhase("signals");
    let signals: FeedSignals;
    try {
      signals = collectSignals({
        sources: this.deps.fetchSignalsSources(),
        blockedTopics: config.blockedTopics,
        now,
      });
    } catch (error) {
      logError("[feed] signals failed:", error);
      this.finish(runId, "failed", String(error), 0, 0);
      return { started: false, reason: "skipped", status: "failed" };
    }
    if (
      signals.interests.length === 0 &&
      signals.recentQuestions.length === 0
    ) {
      // 没有信号不是失败：删掉刚写下的 run 行，保持「从未成功过」的语义
      this.deps.db.feedRuns.delete(runId);
      // 这一条没有留下任何 run 行（信号为空不是失败）
      return { started: false, reason: "skipped", status: "partial" };
    }

    this.deps.onPhase("queries");
    const planned = await planQueries({
      signals,
      blockedTopics: config.blockedTopics,
      locale: this.deps.locale(),
      complete: this.deps.complete,
    });
    if (planned.queries.length === 0) {
      this.deps.db.feedRuns.setMeta(runId, {
        queries: "[]",
        topics: "[]",
        candidate_count: 0,
      });
      this.finish(runId, "partial", null, 0, 0);
      return { started: false, reason: "skipped", status: "partial" };
    }

    this.deps.onPhase("collect");
    const [searchResults, sourceBuckets] = await Promise.all([
      this.deps.searchWeb({
        queries: planned.queries.map((query) => query.q),
      }),
      this.deps.fetchSources(),
    ]);
    const succeeded = searchResults.filter((result) => !result.error);
    const hasSourceItems = sourceBuckets.some(
      (bucket) => bucket.items.length > 0,
    );
    // 搜索与源都空手才算这次什么都没拿到（设计 §9）
    if (succeeded.length === 0 && !hasSourceItems) {
      this.finish(
        runId,
        "failed",
        searchResults[0]?.error ?? "search failed",
        0,
        0,
      );
      return { started: false, status: "failed" };
    }

    const candidates = collectCandidates({
      results: searchResults,
      queries: planned.queries,
      knownUrlKeys: this.knownUrlKeys(),
      sourceBuckets: sourceBuckets.map((bucket) => bucket.items),
    });
    this.writeRunMeta(runId, planned, candidates.length);
    if (candidates.length === 0) {
      this.finish(runId, "partial", null, 0, 0);
      return { started: false, status: "partial" };
    }

    this.deps.onPhase("fetch");
    const fetched = await fetchCandidateBodies({
      candidates,
      fetchPages: this.deps.fetchPages,
    });

    this.deps.onPhase("compose");
    const composed = await composeItems({
      candidates: fetched.filter((candidate) => candidate.body !== null),
      locale: this.deps.locale(),
      complete: this.deps.complete,
    });

    if (composed.length === 0) {
      this.finish(runId, "partial", null, candidates.length, 0);
      return { started: false, status: "partial" };
    }

    this.deps.onPhase("excerpt");
    const drafts = await writeExcerpts({
      drafts: composed,
      locale: this.deps.locale(),
      complete: this.deps.complete,
    });

    this.deps.onPhase("image");
    const inserted: FeedItemRow[] = [];
    for (const draft of drafts) {
      const image = await this.storeImage(draft.candidate.imageUrl);
      const row: FeedItemRow = {
        id: this.deps.id(),
        run_id: runId,
        title: draft.title,
        summary: draft.summary,
        url: draft.candidate.url,
        url_key: draft.candidate.urlKey,
        source_host: draft.candidate.host,
        topic: draft.topic,
        relevance: draft.relevance,
        body: draft.candidate.body,
        body_status: draft.candidate.bodyStatus,
        excerpt: draft.excerpt,
        image_url: draft.candidate.imageUrl ?? null,
        image_file: image?.fileName ?? null,
        image_status: image
          ? "ok"
          : draft.candidate.imageUrl
            ? "failed"
            : "none",
        created_at: now,
        read_at: null,
        dismissed_at: null,
        unprocessed: draft.unprocessed,
        published_at: clampPublished(draft.candidate.publishedAt, now),
      };
      try {
        this.deps.db.feedItems.insert(row);
        inserted.push(row);
      } catch (error) {
        // url_key 唯一索引冲突 = 这条之前推过，跳过即可
        logWarn("[feed] item insert skipped:", draft.candidate.url, error);
      }
    }

    this.finish(runId, "ok", null, candidates.length, inserted.length);
    await this.cleanup();
    return { started: true, status: "ok" };
  }

  private async storeImage(
    imageUrl: string | undefined,
  ): Promise<{ fileName: string } | null> {
    if (!imageUrl) return null;
    return downloadFeedImage({
      url: imageUrl,
      dir: this.deps.imagesDir,
      download: this.deps.downloadImage,
    });
  }

  /**
   * 跨天去重用的已推送 URL 集合。**必须含已移除的条目**（设计 §6.3）：
   * 用 visible 的话，用户标记「不感兴趣」的链接第二天会重新进候选、
   * 再在写库时撞唯一索引被丢掉 —— 白白吃掉一个候选名额。
   */
  private knownUrlKeys(): Set<string> {
    return new Set(this.deps.db.feedItems.listUrlKeys());
  }

  private writeRunMeta(
    runId: string,
    planned: { queries: unknown; topics: unknown },
    candidateCount: number,
  ): void {
    // 不在这里写 SQL：表结构归 db 访问对象管，编排层不碰表
    this.deps.db.feedRuns.setMeta(runId, {
      queries: JSON.stringify(planned.queries),
      topics: JSON.stringify(planned.topics),
      candidate_count: candidateCount,
    });
  }

  private finish(
    runId: string,
    status: FeedRunStatus,
    error: string | null,
    candidateCount: number,
    itemCount: number,
  ): void {
    this.deps.db.feedRuns.finish(runId, {
      status,
      finished_at: this.deps.now(),
      error,
      candidate_count: candidateCount,
      item_count: itemCount,
    });
  }

  // ---- 读与改 ----

  list(): FeedSnapshot {
    const items = this.deps.db.feedItems
      .listVisible(MAX_ITEMS_KEPT)
      .map((row) => {
        const { body: _body, excerpt: _excerpt, ...rest } = row;
        // DB 里存的是文件名，对外给签名 URL：渲染层无法自造 URL
        return {
          ...rest,
          imageUrl: row.image_file ? buildFeedImageUrl(row.image_file) : null,
        };
      });
    return {
      enabled: this.deps.getConfig().enabled === true,
      items,
      unreadCount: this.deps.db.feedItems.unreadCount(),
      lastRun: this.deps.db.feedRuns.latest(),
    };
  }

  getBody(id: string): FeedBodyPayload | null {
    const row = this.deps.db.feedItems.get(id);
    if (!row) return null;
    return {
      body: row.body,
      bodyStatus: row.body_status,
      excerpt: row.excerpt,
    };
  }

  markRead(id: string): number {
    this.deps.db.feedItems.markRead(id, this.deps.now());
    return this.deps.db.feedItems.unreadCount();
  }

  markAllRead(): number {
    this.deps.db.feedItems.markAllRead(this.deps.now());
    return this.deps.db.feedItems.unreadCount();
  }

  dismiss(id: string): number {
    this.deps.db.feedItems.dismiss(id, this.deps.now());
    return this.deps.db.feedItems.unreadCount();
  }

  async clearAll(): Promise<number> {
    this.deps.db.feedItems.deleteAll();
    const referenced = new Set(this.deps.db.feedItems.listImageFileNames());
    await pruneOrphanImages({ dir: this.deps.imagesDir, referenced });
    return this.deps.db.feedItems.unreadCount();
  }

  setBlockedTopics(topics: string[]): void {
    this.deps.setFeedConfig({ blockedTopics: topics });
  }

  async setEnabled(enabled: boolean): Promise<void> {
    this.deps.setFeedConfig({ enabled });
    if (enabled) {
      await this.refresh("enable");
    }
  }

  /** 保留期清理：条目 30 天 / 总数 1000；run 记录 90 天。 */
  async cleanup(): Promise<void> {
    const now = this.deps.now();
    this.deps.db.feedItems.deleteOlderThan(now - RETENTION_DAYS * DAY_MS);
    this.deps.db.feedItems.pruneToMax(MAX_ITEMS_KEPT);
    this.deps.db.feedRuns.pruneOlderThan(now - 90 * DAY_MS);
    const referenced = new Set(this.deps.db.feedItems.listImageFileNames());
    await pruneOrphanImages({ dir: this.deps.imagesDir, referenced });
  }

  /** 连续失败次数与最后一次尝试时间，供调度器封顶（设计 §9）。 */
  consecutiveFailures(): number {
    return this.deps.db.feedRuns.countConsecutiveFailures();
  }

  lastAttemptAt(): number | null {
    return this.deps.db.feedRuns.lastAttemptAt();
  }

  hasExceededFailureBudget(): boolean {
    return this.consecutiveFailures() >= MAX_CONSECUTIVE_FAILURES;
  }
}

/** 供调度器与测试复用：把一个候选 URL 变成去重键。 */
export const toUrlKey = normalizeUrlKey;
