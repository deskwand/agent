/**
 * @module main/feed/feed-collect
 *
 * 管线 ②：纯确定性。URL 归一化、同批去重、跨天去重、按 query 轮流取够 12 条。
 * 排序刻意从简（设计 §6.3）：轮流取而不是按分数排 —— 结果只影响取哪 12 条。
 */
import type { QueryResultData } from "../agent/tools/web-access/types";
import type { SourceItem } from "./sources/catalog";
import type { FeedQuery } from "./feed-queries";

export const CANDIDATE_LIMIT = 12;
export const RESULTS_PER_QUERY = 6;

const TRACKING_PREFIXES = ["utm_", "mc_", "_hs", "pk_"];
const TRACKING_KEYS = new Set([
  "fbclid",
  "gclid",
  "ref",
  "ref_src",
  "spm",
  "from",
  "igshid",
]);

function isTrackingParam(key: string): boolean {
  const lower = key.toLowerCase();
  if (TRACKING_KEYS.has(lower)) return true;
  return TRACKING_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

export interface FeedCandidate {
  id: number;
  title: string;
  url: string;
  urlKey: string;
  host: string;
  snippet: string;
  topic: string;
  reason: string;
  /** 源自带的发布时间（epoch ms）；搜索结果没有则 null。 */
  publishedAt: number | null;
}

export function normalizeUrlKey(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase();
  const path = url.pathname.replace(/\/+$/, "");
  const params = new URLSearchParams(url.search);
  const kept: [string, string][] = [];
  for (const [key, value] of params.entries()) {
    if (isTrackingParam(key)) continue;
    kept.push([key, value]);
  }
  kept.sort((a, b) =>
    a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0]),
  );
  const search = kept.length
    ? `?${kept.map(([key, value]) => `${key}=${value}`).join("&")}`
    : "";
  return `${host}${path}${search}`;
}

export function normalizeTitle(value: string): string {
  return value.replace(/[\s\p{P}]+/gu, "").toLowerCase();
}

/** 源站时区写错会给出来未来的时间；钳到本次 run 的开始时间，否则界面会写「3 小时后」。 */
export function clampPublished(
  value: number | null,
  now: number,
): number | null {
  if (value === null) return null;
  return value > now ? now : value;
}

/** 把一组桶拉平成一个序列：每轮每个桶取一条，取空了的桶跳过。 */
function roundRobin(buckets: FeedCandidate[][]): FeedCandidate[] {
  const out: FeedCandidate[] = [];
  let round = 0;
  let exhausted = false;
  while (!exhausted) {
    exhausted = true;
    for (const bucket of buckets) {
      if (bucket.length <= round) continue;
      exhausted = false;
      out.push(bucket[round]);
    }
    round += 1;
  }
  return out;
}

/** 源条目 → 候选。topic 与 reason 留空：那两个字段由 ④ 交给模型填（主进程不写用户可见文案）。 */
function sourceItemsToCandidates(items: SourceItem[]): FeedCandidate[] {
  const out: FeedCandidate[] = [];
  for (const item of items) {
    // 缺 URL / 相对路径 / 非 http(s) 一律丢（normalizeUrlKey 返回 null），
    // 顺带保证下面那行 new URL() 不会抛
    const urlKey = normalizeUrlKey(item.url);
    if (!urlKey) continue;
    out.push({
      id: -1,
      title: item.title,
      url: item.url,
      urlKey,
      host: new URL(item.url).hostname.replace(/^www\./, "").toLowerCase(),
      snippet: item.snippet,
      topic: "",
      reason: "",
      publishedAt: item.publishedAt,
    });
  }
  return out;
}

export function collectCandidates(input: {
  results: QueryResultData[];
  queries: FeedQuery[];
  knownUrlKeys: Set<string>;
  /** 每个源一个桶；搜索与源交替取（设计 §5.2）。 */
  sourceBuckets?: SourceItem[][];
  max?: number;
}): FeedCandidate[] {
  const limit = input.max ?? CANDIDATE_LIMIT;
  const byQuery = new Map<string, FeedCandidate[]>();

  for (const result of input.results) {
    if (result.error) continue;
    const query = input.queries.find((item) => item.q === result.query);
    if (!query) continue;
    const bucket: FeedCandidate[] = [];
    for (const item of result.results.slice(0, RESULTS_PER_QUERY)) {
      const urlKey = normalizeUrlKey(item.url);
      if (!urlKey) continue;
      bucket.push({
        id: -1,
        title: item.title.trim(),
        url: item.url,
        urlKey,
        host: new URL(item.url).hostname.replace(/^www\./, "").toLowerCase(),
        snippet: item.snippet.trim(),
        topic: query.topic,
        reason: query.reason,
        publishedAt: null,
      });
    }
    byQuery.set(result.query, bucket);
  }

  const searchBuckets = input.queries
    .map((query) => byQuery.get(query.q) ?? [])
    .filter((bucket) => bucket.length > 0);
  const sourceBuckets = (input.sourceBuckets ?? [])
    .map(sourceItemsToCandidates)
    .filter((bucket) => bucket.length > 0);

  // 两侧各自按桶轮流拉平，再交替合并：一轮消耗搜索一个名额、源一个名额。
  // **不能按桶下标配对** —— 查询词只有 3-6 个（设计 §4）而健康的源常有 8 个以上，
  // 配对会让源在第一轮里就把 12 条名额吃光（源占 2/3），而「源可能挤掉搜索」
  // 正是这个设计唯一要防的事。
  const searchQueue = roundRobin(searchBuckets);
  const sourceQueue = roundRobin(sourceBuckets);
  const ordered: FeedCandidate[] = [];
  const rounds = Math.max(searchQueue.length, sourceQueue.length);
  for (let index = 0; index < rounds; index += 1) {
    if (searchQueue[index]) ordered.push(searchQueue[index]);
    if (sourceQueue[index]) ordered.push(sourceQueue[index]);
  }

  const seenUrls = new Set<string>();
  const seenTitles = new Set<string>();
  const candidates: FeedCandidate[] = [];

  for (const candidate of ordered) {
    if (candidates.length >= limit) break;
    const titleKey = normalizeTitle(candidate.title);
    if (input.knownUrlKeys.has(candidate.urlKey)) continue;
    if (seenUrls.has(candidate.urlKey)) continue;
    if (titleKey && seenTitles.has(titleKey)) continue;
    seenUrls.add(candidate.urlKey);
    if (titleKey) seenTitles.add(titleKey);
    candidates.push({ ...candidate, id: candidates.length });
  }

  return candidates;
}
