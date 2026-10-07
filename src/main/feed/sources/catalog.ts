/**
 * @module main/feed/sources/catalog
 *
 * 动态的固定消息源清单。九成是数据。
 *
 * 三条硬约定：
 *  1. URL 只在这里出现，是常量 —— 模型与运行期都产不出 URL（与 ④ 的「只回 candidateId」同源）。
 *  2. 主进程不写用户可见文案（tests/i18n/main-cjk-coverage）：所以源没有名字，
 *     条目也不带 topic / reason —— 那两个字段由 ④ 交给模型填。源在界面上零痕迹。
 *  3. 响应认不出来时 parse 返回 null（不是抛错）：36氪 那种「200 + 反爬 HTML」是假成功，
 *     按形状判定，不能只看状态码。
 */
import { parseFeed } from "@rowanmanning/feed-parser";

export interface SourceItem {
  title: string;
  url: string;
  snippet: string;
  /** epoch ms；源自带发布时间，没有则 null。 */
  publishedAt: number | null;
}

export interface SourceSpec {
  id: string;
  url: string;
  /** 认不出来返回 null。 */
  parse: (body: string) => SourceItem[] | null;
  /** 每个源一次最多取几条：源只是补充，不该靠数量占位。 */
  maxItems: number;
}

const MAX_ITEMS = 20;

/** RSS 的 description 里常带 HTML；这里是给模型与回退正文用的纯文本。 */
export function stripHtml(value: string): string {
  return (
    value
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]*>/g, " ")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#0?39;/gi, "'")
      .replace(/&nbsp;/gi, " ")
      // &amp; 放最后：先解其他实体，避免 &amp;lt; 被二次解码
      .replace(/&amp;/gi, "&")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** ISO 8601 字符串 → epoch ms。 */
function isoMs(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/** 秒级时间戳 → epoch ms。 */
function secondsToMs(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? value * 1000
    : null;
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

/** 取数组：给了 key 就从对象里取那个字段（HN 的 hits、GitHub 的 items）。 */
function asArray(value: unknown, key?: string): Record<string, unknown>[] {
  const root =
    key && value && typeof value === "object"
      ? (value as Record<string, unknown>)[key]
      : value;
  return Array.isArray(root)
    ? root.filter(
        (item): item is Record<string, unknown> =>
          typeof item === "object" && item !== null,
      )
    : [];
}

/** RSS / Atom / RDF 都走这一条 —— arXiv 的 API 返回 Atom，也用它。 */
export function parseRssFeed(body: string): SourceItem[] | null {
  let feed: ReturnType<typeof parseFeed>;
  try {
    feed = parseFeed(body);
  } catch {
    // 不是 feed（反爬页、错误页、HTML）—— 不是错误，是这个源这次没有内容
    return null;
  }
  if (feed.items.length === 0) return null;
  return feed.items.map((item) => ({
    title: text(item.title),
    url: text(item.url),
    snippet: stripHtml(item.description ?? item.content ?? ""),
    publishedAt: item.published ? item.published.getTime() : null,
  }));
}

export function parseHackerNews(body: string): SourceItem[] | null {
  const hits = asArray(parseJson(body), "hits");
  if (hits.length === 0) return null;
  return hits.map((hit) => ({
    title: text(hit.title),
    // Ask HN / Show HN 没有外链，回落到讨论页
    url:
      text(hit.url) ||
      `https://news.ycombinator.com/item?id=${text(hit.objectID)}`,
    snippet: stripHtml(text(hit.story_text)),
    publishedAt: secondsToMs(hit.created_at_i),
  }));
}

export function parseHuggingFace(body: string): SourceItem[] | null {
  const rows = asArray(parseJson(body));
  if (rows.length === 0) return null;
  return rows.map((row) => {
    const paper = (row.paper ?? {}) as Record<string, unknown>;
    const paperId = text(paper.id);
    return {
      title: text(row.title),
      url: paperId ? `https://huggingface.co/papers/${paperId}` : "",
      snippet: stripHtml(text(row.summary)),
      publishedAt: isoMs(row.publishedAt),
    };
  });
}

export function parseLobsters(body: string): SourceItem[] | null {
  const rows = asArray(parseJson(body));
  if (rows.length === 0) return null;
  return rows.map((row) => ({
    title: text(row.title),
    url: text(row.url) || text(row.comments_url),
    snippet: stripHtml(text(row.description_plain) || text(row.description)),
    publishedAt: isoMs(row.created_at),
  }));
}

export function parseDevTo(body: string): SourceItem[] | null {
  const rows = asArray(parseJson(body));
  if (rows.length === 0) return null;
  return rows.map((row) => ({
    title: text(row.title),
    url: text(row.url),
    snippet: stripHtml(text(row.description)),
    publishedAt: isoMs(row.published_timestamp),
  }));
}

/** 默认 filter 不返回正文，所以 snippet 只能是空串 —— 正文靠 ③ 抓。 */
export function parseStackExchange(body: string): SourceItem[] | null {
  const rows = asArray(parseJson(body), "items");
  if (rows.length === 0) return null;
  return rows.map((row) => ({
    title: stripHtml(text(row.title)),
    url: text(row.link),
    snippet: "",
    publishedAt: secondsToMs(row.creation_date),
  }));
}

export function parseGitHub(body: string): SourceItem[] | null {
  const rows = asArray(parseJson(body), "items");
  if (rows.length === 0) return null;
  return rows.map((row) => ({
    title: text(row.full_name),
    url: text(row.html_url),
    snippet: stripHtml(
      [
        text(row.description),
        text(row.language) && `language: ${text(row.language)}`,
      ]
        .filter(Boolean)
        .join(" · "),
    ),
    publishedAt: isoMs(row.pushed_at),
  }));
}

/** 中文与英文的 RSS 站；一行一个。 */
const RSS_SOURCES: [string, string][] = [
  ["sspai", "https://sspai.com/feed"],
  ["infoq-cn", "https://www.infoq.cn/feed"],
  ["ifanr", "https://www.ifanr.com/feed"],
  ["leiphone", "https://www.leiphone.com/feed"],
  ["qbitai", "https://www.qbitai.com/feed"],
  ["solidot", "https://www.solidot.org/index.rss"],
  ["v2ex", "https://www.v2ex.com/index.xml"],
  ["ruanyifeng", "https://www.ruanyifeng.com/blog/atom.xml"],
  ["techcrunch", "https://techcrunch.com/feed/"],
  ["theverge", "https://www.theverge.com/rss/index.xml"],
  ["arstechnica", "https://feeds.arstechnica.com/arstechnica/index"],
  ["mit-tech-review", "https://www.technologyreview.com/feed/"],
  ["pypi", "https://pypi.org/rss/updates.xml"],
];

export const SOURCES: SourceSpec[] = [
  ...RSS_SOURCES.map(
    ([id, url]): SourceSpec => ({
      id,
      url,
      parse: parseRssFeed,
      maxItems: MAX_ITEMS,
    }),
  ),
  {
    id: "hackernews",
    // 一次请求拿完整首页。Algolia 的 tags=front_page 直接给带分数的完整条目，
    // 不需要 Firebase 那套「取 id 列表再逐条取详情」的 N+1。
    url: "https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=20",
    parse: parseHackerNews,
    maxItems: MAX_ITEMS,
  },
  {
    id: "huggingface-papers",
    url: "https://huggingface.co/api/daily_papers",
    parse: parseHuggingFace,
    maxItems: MAX_ITEMS,
  },
  {
    id: "lobsters",
    url: "https://lobste.rs/hottest.json",
    parse: parseLobsters,
    maxItems: MAX_ITEMS,
  },
  {
    id: "devto",
    url: "https://dev.to/api/articles?per_page=20",
    parse: parseDevTo,
    maxItems: MAX_ITEMS,
  },
  {
    id: "stackexchange",
    url: "https://api.stackexchange.com/2.3/questions?order=desc&sort=hot&site=stackoverflow&pagesize=20",
    parse: parseStackExchange,
    maxItems: MAX_ITEMS,
  },
  {
    id: "arxiv",
    // 走检索 API 而不是它的 RSS：那份 cs.AI 有 1 MB，这份 10 条只有 25 KB。
    url: "https://export.arxiv.org/api/query?search_query=cat:cs.AI&sortBy=submittedDate&sortOrder=descending&max_results=20",
    parse: parseRssFeed,
    maxItems: MAX_ITEMS,
  },
  {
    id: "github",
    // 固定查询：近一周有推送、星标 500 以上的仓库，按星排序。
    url: "https://api.github.com/search/repositories?q=stars:%3E500+pushed:%3E2026-09-30&sort=stars&order=desc&per_page=20",
    parse: parseGitHub,
    maxItems: MAX_ITEMS,
  },
];
