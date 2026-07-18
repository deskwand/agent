/** Adapted from nicobailon/pi-web-access v0.13.0 (commit 7bdc30a), MIT License. */
import {
  readResponseJson,
  throwProviderHttpError,
  withRequestTimeout,
  type SearchOptions,
  type SearchResponse,
} from "./types";

const BRAVE_API_URL = "https://api.search.brave.com/res/v1/web/search";

interface BraveResult {
  title?: string;
  url?: string;
  description?: string;
}

function normalizeDomain(raw: string): string | null {
  const excluded = raw.trim().startsWith("-");
  const value = excluded ? raw.trim().slice(1) : raw.trim();
  if (!value) return null;
  try {
    return new URL(value.includes("://") ? value : `https://${value}`).hostname;
  } catch {
    return null;
  }
}

function buildQuery(query: string, domainFilter?: string[]): string {
  const clauses = (domainFilter ?? []).flatMap((raw) => {
    const domain = normalizeDomain(raw);
    if (!domain) return [];
    return [
      raw.trim().startsWith("-") ? `NOT site:${domain}` : `site:${domain}`,
    ];
  });
  return [query, ...clauses].join(" ");
}

export async function searchWithBrave(
  query: string,
  options: SearchOptions = {},
  apiKey: string,
): Promise<SearchResponse> {
  if (!apiKey.trim()) throw new Error("Brave API key is required");
  const max = Math.min(Math.max(Math.floor(options.numResults ?? 5), 1), 20);
  const params = new URLSearchParams({
    q: buildQuery(query, options.domainFilter),
    count: String(options.domainFilter?.length ? 20 : max),
  });
  if (options.recencyFilter) {
    const freshness = {
      day: "pd",
      week: "pw",
      month: "pm",
      year: "py",
    }[options.recencyFilter];
    params.set("freshness", freshness);
  }
  const response = await fetch(`${BRAVE_API_URL}?${params}`, {
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": apiKey,
    },
    signal: withRequestTimeout(options.signal, 30_000),
  });
  if (!response.ok) await throwProviderHttpError(response, "Brave");
  const data = await readResponseJson<{
    web?: { results?: BraveResult[] };
  }>(response);
  const results = (data.web?.results ?? [])
    .filter((item): item is BraveResult & { url: string } => Boolean(item.url))
    .map((item) => ({
      title: item.title || item.url,
      url: item.url,
      snippet: item.description || "",
    }))
    .slice(0, max);
  return {
    answer: results
      .map((item) => `${item.snippet}\nSource: ${item.url}`)
      .join("\n\n"),
    results,
  };
}
