/**
 * 动态（Feed）的共享类型：主进程（db / service / IPC）与渲染层（preload / store / 组件）
 * 都从这里引，避免两边各写一份形状。定义只此一处。
 */

export type FeedRunStatus = "running" | "ok" | "partial" | "failed";
export type FeedTrigger = "enable" | "schedule" | "manual";
export type FeedBodyStatus = "ok" | "snippet_only";
export type FeedImageStatus = "ok" | "failed" | "none";

export const FEED_PHASES = [
  "signals",
  "queries",
  "collect",
  "fetch",
  "compose",
  "excerpt",
  "image",
] as const;

export type FeedPhase = (typeof FEED_PHASES)[number];

export interface FeedItemRow {
  id: string;
  run_id: string;
  title: string;
  summary: string | null;
  url: string;
  url_key: string;
  source_host: string;
  topic: string | null;
  relevance: string | null;
  body: string | null;
  body_status: FeedBodyStatus;
  /** 模型写的本地化摘录；NULL = 写失败或 compose 兜底产物。 */
  excerpt: string | null;
  /** 模型写的口播稿；NULL = 这条不可听。 */
  script: string | null;
  image_url: string | null;
  image_file: string | null;
  image_status: FeedImageStatus;
  created_at: number;
  /** 源自带的真实发布时间（epoch ms）；搜索结果没有则 null。 */
  published_at: number | null;
  read_at: number | null;
  dismissed_at: number | null;
  unprocessed: number;
}

export interface FeedRunRow {
  id: string;
  started_at: number;
  finished_at: number | null;
  status: FeedRunStatus;
  trigger: FeedTrigger;
  error: string | null;
  queries: string | null;
  topics: string | null;
  candidate_count: number;
  item_count: number;
}

export interface FeedRunPatch {
  status: FeedRunStatus;
  finished_at: number;
  error: string | null;
  candidate_count: number;
  item_count: number;
}

/** 一条 run 里其余信息的子集，界面要用它渲染头部与依据区。 */
export interface FeedRunSummary {
  id: string;
  started_at: number;
  finished_at: number | null;
  status: FeedRunStatus;
  error: string | null;
  queries: string | null;
  candidate_count: number;
  item_count: number;
}

/** 对外（IPC / store / 组件）的条目：**不带 body / excerpt / script**，带主进程签好的配图 URL。 */
export type FeedItemWithMeta = Omit<
  FeedItemRow,
  "body" | "excerpt" | "script"
> & {
  imageUrl: string | null;
};

export interface FeedSnapshot {
  enabled: boolean;
  items: FeedItemWithMeta[];
  unreadCount: number;
  lastRun: FeedRunSummary | null;
}

export interface FeedRunReason {
  q: string;
  topic: string;
  reason: string;
}

export function parseRunReasons(queries: string | null): FeedRunReason[] {
  if (!queries) return [];
  try {
    const parsed = JSON.parse(queries);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is FeedRunReason =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as FeedRunReason).q === "string",
    );
  } catch {
    return [];
  }
}

/** 一次收听的条目上限：护栏，不是产品语义（设计 §7.7）。主进程用它兜 IPC 边界。 */
export const FEED_LISTEN_MAX_ITEMS = 20;

/** `feed.getBody` 的返回：右栏选中时才取，`bodyStatus` 决定要不要显示「只抓到片段」。 */
export interface FeedBodyPayload {
  body: string | null;
  bodyStatus: FeedBodyStatus;
  /** 本地化摘录；为 null 时右栏回退显示 body。 */
  excerpt: string | null;
  /** 有没有口播稿 —— 右栏据此决定「听这条」出不出现。 */
  hasScript: boolean;
}
