/**
 * @module main/feed/feed-collect
 *
 * 管线 ②：纯确定性。URL 归一化、同批去重、跨天去重、按 query 轮流取够 12 条。
 * 排序刻意从简（设计 §6.3）：轮流取而不是按分数排 —— 结果只影响取哪 12 条。
 */
import type { QueryResultData } from "../agent/tools/web-access/types";
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

export function collectCandidates(input: {
  results: QueryResultData[];
  queries: FeedQuery[];
  knownUrlKeys: Set<string>;
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
      });
    }
    byQuery.set(result.query, bucket);
  }

  const seenUrls = new Set<string>();
  const seenTitles = new Set<string>();
  const candidates: FeedCandidate[] = [];

  let exhausted = false;
  let round = 0;
  while (!exhausted && candidates.length < limit) {
    exhausted = true;
    for (const query of input.queries) {
      const bucket = byQuery.get(query.q);
      if (!bucket || bucket.length <= round) continue;
      exhausted = false;
      const candidate = bucket[round];
      const titleKey = normalizeTitle(candidate.title);
      if (input.knownUrlKeys.has(candidate.urlKey)) continue;
      if (seenUrls.has(candidate.urlKey)) continue;
      if (titleKey && seenTitles.has(titleKey)) continue;
      seenUrls.add(candidate.urlKey);
      if (titleKey) seenTitles.add(titleKey);
      candidates.push({ ...candidate, id: candidates.length });
      if (candidates.length >= limit) break;
    }
    round += 1;
  }

  return candidates;
}
