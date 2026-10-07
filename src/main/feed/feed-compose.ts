/**
 * @module main/feed/feed-compose
 *
 * 管线 ④：从候选里挑出最终 ≤8 条，写成标题 + 摘要 + 相关性。
 *
 * 防幻觉的硬要求：**模型只回 candidateId，URL 与来源由代码回填** ——
 * 模型无法让一个候选池里不存在的链接进入库（设计 §6.5）。
 */
import type { FeedFetchedCandidate } from "./feed-fetch";
import type { FeedComplete } from "./feed-queries";
import { logWarn } from "../utils/logger";

export const MAX_ITEMS = 8;

export interface ComposedItem {
  candidateId: number;
  title: string;
  summary: string;
  topic: string;
  relevance: string;
}

export interface FeedItemDraft {
  candidate: FeedFetchedCandidate;
  title: string;
  summary: string | null;
  topic: string | null;
  relevance: string | null;
  excerpt: string | null;
  unprocessed: number;
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

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function buildComposePrompt(
  candidates: FeedFetchedCandidate[],
  locale: string,
): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = [
    "You write a personal news feed for one user.",
    "Output STRICT JSON only. No prose, no markdown fences.",
    `Write titles and summaries in the user's language (locale: ${locale}).`,
    "Pick only items that are genuinely relevant to this user. Drop the rest with keep:false.",
    "You MUST reference each kept item by candidateId. Never output a URL.",
    "The first sentence of a summary must state the conclusion; put the important words first in the title.",
    "Do not invent facts that are not in the provided text.",
    'Schema: {"items":[{"candidateId":number,"title":string,"summary":string,"topic":string,"relevance":string,"keep":boolean}]}',
    `At most ${MAX_ITEMS} items with keep:true.`,
  ].join("\n");

  const userPrompt = JSON.stringify({
    candidates: candidates.map((candidate) => ({
      id: candidate.id,
      title: candidate.title,
      topic: candidate.topic,
      reason: candidate.reason,
      text: (candidate.body ?? candidate.snippet).slice(0, 3000),
    })),
  });

  return { systemPrompt, userPrompt };
}

export function parseComposeResponse(
  text: string,
  candidates: FeedFetchedCandidate[],
): ComposedItem[] | null {
  const json = firstJsonObject(stripFences(text));
  if (!json) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const items = (raw as { items?: unknown }).items;
  if (!Array.isArray(items)) return null;

  const validIds = new Set(candidates.map((candidate) => candidate.id));
  const out: ComposedItem[] = [];
  for (const entry of items) {
    if (typeof entry !== "object" || entry === null) continue;
    const value = entry as Record<string, unknown>;
    if (value.keep === false) continue;
    const candidateId = value.candidateId;
    if (typeof candidateId !== "number" || !validIds.has(candidateId)) continue;
    const title = asString(value.title);
    const summary = asString(value.summary);
    if (!title || !summary) continue;
    out.push({
      candidateId,
      title,
      summary,
      topic: asString(value.topic),
      relevance: asString(value.relevance),
    });
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

/** 两次都拿不到合法 JSON 时的确定性兜底：候选前 8 条原样入库并标记未加工。 */
function fallbackDrafts(candidates: FeedFetchedCandidate[]): FeedItemDraft[] {
  return candidates.slice(0, MAX_ITEMS).map((candidate) => ({
    candidate,
    title: candidate.title,
    summary: null,
    topic: candidate.topic,
    relevance: candidate.reason,
    unprocessed: 1,
    excerpt: null,
  }));
}

export async function composeItems(input: {
  candidates: FeedFetchedCandidate[];
  locale: string;
  complete: FeedComplete;
}): Promise<FeedItemDraft[]> {
  if (input.candidates.length === 0) return [];
  const prompt = buildComposePrompt(input.candidates, input.locale);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const text = await input.complete(prompt);
      const parsed = parseComposeResponse(text, input.candidates);
      if (parsed === null) {
        logWarn("[feed] compose response unusable, attempt", attempt + 1);
        continue;
      }
      if (parsed.length === 0) return [];
      return parsed.map((item) => {
        const candidate = input.candidates.find(
          (entry) => entry.id === item.candidateId,
        ) as FeedFetchedCandidate;
        return {
          candidate,
          title: item.title,
          summary: item.summary,
          topic: item.topic || candidate.topic,
          relevance: item.relevance || candidate.reason,
          unprocessed: 0,
          excerpt: null,
        };
      });
    } catch (error) {
      logWarn("[feed] compose call failed, attempt", attempt + 1, error);
    }
  }

  return fallbackDrafts(input.candidates);
}
