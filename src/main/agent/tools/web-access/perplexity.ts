/** Adapted from nicobailon/pi-web-access v0.13.0 (commit 7bdc30a), MIT License. */
import {
  readResponseJson,
  throwProviderHttpError,
  withRequestTimeout,
  type SearchOptions,
  type SearchResult,
  type SearchResponse,
} from "./types";

const PERPLEXITY_API_URL = "https://api.perplexity.ai/chat/completions";
const requestTimestamps: number[] = [];

function checkRateLimit(): void {
  const now = Date.now();
  while (requestTimestamps[0] && requestTimestamps[0] < now - 60_000) {
    requestTimestamps.shift();
  }
  if (requestTimestamps.length >= 10)
    throw new Error("Perplexity rate limit reached");
  requestTimestamps.push(now);
}

export async function searchWithPerplexity(
  query: string,
  options: SearchOptions = {},
  apiKey: string,
): Promise<SearchResponse> {
  if (!apiKey.trim()) throw new Error("Perplexity API key is required");
  checkRateLimit();
  const body: Record<string, unknown> = {
    model: "sonar",
    messages: [{ role: "user", content: query }],
    max_tokens: 1024,
    return_related_questions: false,
  };
  if (options.recencyFilter) body.search_recency_filter = options.recencyFilter;
  if (options.domainFilter?.length)
    body.search_domain_filter = options.domainFilter;
  const response = await fetch(PERPLEXITY_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: withRequestTimeout(options.signal, 60_000),
  });
  if (!response.ok) await throwProviderHttpError(response, "Perplexity");
  const data = await readResponseJson<{
    choices?: Array<{ message?: { content?: string } }>;
    citations?: Array<string | { url?: string; title?: string }>;
  }>(response);
  const max = Math.min(Math.max(Math.floor(options.numResults ?? 5), 1), 20);
  const results: SearchResult[] = [];
  for (const [index, citation] of (data.citations ?? [])
    .slice(0, max)
    .entries()) {
    if (typeof citation === "string") {
      results.push({
        title: `Source ${index + 1}`,
        url: citation,
        snippet: "",
      });
    } else if (citation.url) {
      results.push({
        title: citation.title || `Source ${index + 1}`,
        url: citation.url,
        snippet: "",
      });
    }
  }
  return { answer: data.choices?.[0]?.message?.content || "", results };
}
