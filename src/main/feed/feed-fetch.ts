/**
 * @module main/feed/feed-fetch
 *
 * 管线 ③：对候选抓正文，截断到 3000 字符（设计 §6.4）。
 * 单条失败只降级为搜索片段；正文与片段都空时 body 为 null，调用方丢弃该条。
 */
import type { ExtractedContent } from "../agent/tools/web-access/types";
import type { FeedCandidate } from "./feed-collect";
import { logWarn } from "../utils/logger";

export const BODY_MAX_CHARS = 3000;
const MIN_USEFUL_BODY_CHARS = 80;

export interface FeedFetchedCandidate extends FeedCandidate {
  body: string | null;
  bodyStatus: "ok" | "snippet_only";
  imageUrl?: string;
}

export type FeedFetchPage = (urls: string[]) => Promise<ExtractedContent[]>;

export async function fetchCandidateBodies(input: {
  candidates: FeedCandidate[];
  fetchPages: FeedFetchPage;
}): Promise<FeedFetchedCandidate[]> {
  let pages: ExtractedContent[] = [];
  if (input.candidates.length > 0) {
    try {
      pages = await input.fetchPages(input.candidates.map((item) => item.url));
    } catch (error) {
      logWarn("[feed] fetch pages failed, falling back to snippets:", error);
    }
  }

  return input.candidates.map((candidate) => {
    const page = pages.find((item) => item.url === candidate.url);
    const content = page?.content?.trim() ?? "";
    if (page && !page.error && content.length >= MIN_USEFUL_BODY_CHARS) {
      return {
        ...candidate,
        body: content.slice(0, BODY_MAX_CHARS),
        bodyStatus: "ok" as const,
        imageUrl: page.imageUrl,
      };
    }
    const snippet = candidate.snippet.trim();
    return {
      ...candidate,
      body: snippet ? snippet.slice(0, BODY_MAX_CHARS) : null,
      bodyStatus: "snippet_only" as const,
      imageUrl: page?.imageUrl,
    };
  });
}
