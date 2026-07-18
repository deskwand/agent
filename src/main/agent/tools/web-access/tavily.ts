/** Adapted from nicobailon/pi-web-access v0.13.0 (commit 7bdc30a), MIT License. */
import {
  readResponseJson,
  throwProviderHttpError,
  withRequestTimeout,
  type ExtractedContent,
  type SearchOptions,
  type SearchResponse,
} from "./types";

const TAVILY_API_URL = "https://api.tavily.com/search";

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
  raw_content?: string;
}

function domains(values: string[] | undefined, excluded: boolean): string[] {
  return (values ?? []).flatMap((raw) => {
    if (raw.trim().startsWith("-") !== excluded) return [];
    const value = excluded ? raw.trim().slice(1) : raw.trim();
    try {
      return [
        new URL(value.includes("://") ? value : `https://${value}`).hostname,
      ];
    } catch {
      return [];
    }
  });
}

export async function searchWithTavily(
  query: string,
  options: SearchOptions = {},
  apiKey: string,
): Promise<SearchResponse> {
  if (!apiKey.trim()) throw new Error("Tavily API key is required");
  const includeDomains = domains(options.domainFilter, false);
  const excludeDomains = domains(options.domainFilter, true);
  const body = {
    query,
    search_depth: "basic",
    max_results: Math.min(Math.max(Math.floor(options.numResults ?? 5), 1), 20),
    include_answer: "basic",
    include_raw_content: options.includeContent ? "markdown" : false,
    ...(options.recencyFilter ? { time_range: options.recencyFilter } : {}),
    ...(includeDomains.length ? { include_domains: includeDomains } : {}),
    ...(excludeDomains.length ? { exclude_domains: excludeDomains } : {}),
  };
  const response = await fetch(TAVILY_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: withRequestTimeout(options.signal, 60_000),
  });
  if (!response.ok) await throwProviderHttpError(response, "Tavily");
  const data = await readResponseJson<{
    answer?: string;
    results?: TavilyResult[];
  }>(response);
  const results = (data.results ?? []).flatMap((item, index) =>
    item.url
      ? [
          {
            title: item.title || `Source ${index + 1}`,
            url: item.url,
            snippet: item.content?.replace(/\s+/g, " ").trim() || "",
          },
        ]
      : [],
  );
  const inlineContent: ExtractedContent[] = options.includeContent
    ? (data.results ?? []).flatMap((item) =>
        item.url && item.raw_content?.trim()
          ? [
              {
                url: item.url,
                title: item.title || "",
                content: item.raw_content,
                error: null,
              },
            ]
          : [],
      )
    : [];
  return {
    answer: data.answer || "",
    results,
    ...(inlineContent.length ? { inlineContent } : {}),
  };
}
