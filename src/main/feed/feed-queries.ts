/**
 * @module main/feed/feed-queries
 *
 * 管线 ①：把信号变成 3-6 个搜索查询词。走轻量任务模型。
 * 失败降级：重试一次 → 仍失败则拿记忆里的兴趣直接当查询词（设计 §6.2、§9）。
 */
import type { FeedSignals } from "./feed-signals";
import { logWarn } from "../utils/logger";

export const MIN_QUERIES = 3;
export const MAX_QUERIES = 6;

export interface FeedQuery {
  q: string;
  topic: string;
  reason: string;
}

export interface FeedQueries {
  topics: { label: string }[];
  queries: FeedQuery[];
}

export type FeedComplete = (input: {
  systemPrompt: string;
  userPrompt: string;
}) => Promise<string>;

function normalizeTopic(value: string): string {
  return value.replace(/[\s\p{P}]+/gu, "").toLowerCase();
}

function blockedSet(blockedTopics: string[]): Set<string> {
  return new Set(blockedTopics.map(normalizeTopic));
}

function isBlocked(value: string, blocked: Set<string>): boolean {
  return blocked.has(normalizeTopic(value));
}

function stripFences(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```[a-zA-Z]*\s*([\s\S]*?)\s*```$/.exec(trimmed);
  return fenced ? fenced[1].trim() : trimmed;
}

function firstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

export function buildQueriesPrompt(
  signals: FeedSignals,
  locale: string,
): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = [
    "You plan web searches for a personal news feed.",
    "Output STRICT JSON only. No prose, no markdown fences.",
    `Write in the user's language (locale: ${locale}).`,
    "Abstract the user's questions into topics. Never copy a private sentence verbatim into a query.",
    "Each query must be a useful web search phrase, and must carry a short reason why it matters to this user.",
    'Schema: {"topics":[{"label":string}],"queries":[{"q":string,"topic":string,"reason":string}]}',
    `${MIN_QUERIES}-${MAX_QUERIES} queries.`,
    "Never propose a topic that appears in blockedTopics.",
  ].join("\n");

  const userPrompt = JSON.stringify({
    interests: signals.interests,
    preferences: signals.preferences,
    recentQuestions: signals.recentQuestions,
    blockedTopics: signals.blockedTopics,
  });

  return { systemPrompt, userPrompt };
}

export function parseQueriesResponse(
  text: string,
  blockedTopics: string[],
): FeedQueries | null {
  const json = firstJsonObject(stripFences(text));
  if (!json) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as { topics?: unknown; queries?: unknown };
  if (!Array.isArray(record.queries)) return null;

  const blocked = blockedSet(blockedTopics);
  const queries: FeedQuery[] = [];
  for (const entry of record.queries) {
    if (typeof entry !== "object" || entry === null) continue;
    const value = entry as { q?: unknown; topic?: unknown; reason?: unknown };
    const q = typeof value.q === "string" ? value.q.trim() : "";
    const topic = typeof value.topic === "string" ? value.topic.trim() : "";
    const reason = typeof value.reason === "string" ? value.reason.trim() : "";
    if (!q || !topic || !reason || isBlocked(topic, blocked)) continue;
    queries.push({ q, topic, reason });
    if (queries.length >= MAX_QUERIES) break;
  }

  const topics: { label: string }[] = [];
  if (Array.isArray(record.topics)) {
    for (const entry of record.topics) {
      if (typeof entry !== "object" || entry === null) continue;
      const label = (entry as { label?: unknown }).label;
      const trimmed = typeof label === "string" ? label.trim() : "";
      if (!trimmed || isBlocked(trimmed, blocked)) continue;
      if (topics.some((item) => item.label === trimmed)) continue;
      topics.push({ label: trimmed });
    }
  }

  return { topics, queries };
}

/** 两次都拿不到合法 JSON 时的确定性兜底：拿记忆里的兴趣当查询词。 */
function fallbackQueries(
  signals: FeedSignals,
  blockedTopics: string[],
): FeedQueries {
  const blocked = blockedSet(blockedTopics);
  const queries: FeedQuery[] = [];
  for (const interest of signals.interests) {
    if (isBlocked(interest, blocked)) continue;
    // reason 留空：主进程不写用户可见文案（见 tests/i18n/main-cjk-coverage），
    // 界面遇到空 reason 就不显示那一行
    queries.push({ q: interest, topic: interest, reason: "" });
    if (queries.length >= MAX_QUERIES) break;
  }
  return {
    topics: queries.map((query) => ({ label: query.topic })),
    queries,
  };
}

export async function planQueries(input: {
  signals: FeedSignals;
  blockedTopics: string[];
  locale: string;
  complete: FeedComplete;
}): Promise<FeedQueries> {
  // 屏蔽主题只有一个来源：input.blockedTopics（signals 里那份可能过时）
  const prompt = buildQueriesPrompt(
    { ...input.signals, blockedTopics: input.blockedTopics },
    input.locale,
  );
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const text = await input.complete(prompt);
      const parsed = parseQueriesResponse(text, input.blockedTopics);
      if (parsed && parsed.queries.length > 0) return parsed;
      logWarn("[feed] queries response unusable, attempt", attempt + 1);
    } catch (error) {
      logWarn("[feed] queries call failed, attempt", attempt + 1, error);
    }
  }
  return fallbackQueries(input.signals, input.blockedTopics);
}
