/** Adapted from nicobailon/pi-web-access v0.13.0 (commit 7bdc30a), MIT License. */
import {
  readResponseJson,
  throwProviderHttpError,
  withRequestTimeout,
  type ExtractedContent,
  type SearchOptions,
  type SearchResponse,
} from "./types";

const PARALLEL_SEARCH_URL = "https://api.parallel.ai/v1/search";
const PARALLEL_EXTRACT_URL = "https://api.parallel.ai/v1/extract";

interface ParallelResult {
  title?: string;
  url?: string;
  excerpts?: string[];
  full_content?: string;
}

function recencyToAfterDate(
  filter: NonNullable<SearchOptions["recencyFilter"]>,
): string {
  const days = { day: 1, week: 7, month: 30, year: 365 }[filter];
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

function normalizedDomain(raw: string): string | null {
  const value = raw.trim().replace(/^-/, "");
  if (!value) return null;
  try {
    return new URL(value.includes("://") ? value : `https://${value}`).hostname;
  } catch {
    return null;
  }
}

function sourcePolicy(options: SearchOptions): Record<string, unknown> {
  const includeDomains: string[] = [];
  const excludeDomains: string[] = [];
  for (const raw of options.domainFilter ?? []) {
    const domain = normalizedDomain(raw);
    if (!domain) continue;
    (raw.trim().startsWith("-") ? excludeDomains : includeDomains).push(domain);
  }
  return {
    ...(includeDomains.length ? { include_domains: includeDomains } : {}),
    ...(excludeDomains.length ? { exclude_domains: excludeDomains } : {}),
    ...(options.recencyFilter
      ? { after_date: recencyToAfterDate(options.recencyFilter) }
      : {}),
  };
}

async function post(
  url: string,
  body: Record<string, unknown>,
  apiKey: string,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  if (!apiKey.trim()) throw new Error("Parallel API key is required");
  const response = await fetch(url, {
    method: "POST",
    headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: withRequestTimeout(signal, 60_000),
  });
  if (!response.ok) await throwProviderHttpError(response, "Parallel");
  return readResponseJson<Record<string, unknown>>(response);
}

function excerpts(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string =>
          typeof item === "string" && Boolean(item.trim()),
      )
    : [];
}

export async function searchWithParallel(
  query: string,
  options: SearchOptions = {},
  apiKey: string,
): Promise<SearchResponse> {
  const policy = sourcePolicy(options);
  const data = await post(
    PARALLEL_SEARCH_URL,
    {
      objective: query,
      search_queries: [query],
      advanced_settings: {
        max_results: Math.min(
          Math.max(Math.floor(options.numResults ?? 5), 1),
          20,
        ),
        ...(Object.keys(policy).length ? { source_policy: policy } : {}),
      },
    },
    apiKey,
    options.signal,
  );
  const source = Array.isArray(data.results)
    ? (data.results as ParallelResult[])
    : [];
  const results = source.flatMap((item, index) =>
    item.url
      ? [
          {
            title: item.title || `Source ${index + 1}`,
            url: item.url,
            snippet:
              excerpts(item.excerpts)[0]
                ?.replace(/\s+/g, " ")
                .trim()
                .slice(0, 200) || "",
          },
        ]
      : [],
  );
  const answer = source
    .flatMap((item, index) => {
      const text = excerpts(item.excerpts).join(" ");
      return item.url && text
        ? [
            `${text}\nSource: ${item.title || `Source ${index + 1}`} (${item.url})`,
          ]
        : [];
    })
    .join("\n\n");
  const inlineContent: ExtractedContent[] = options.includeContent
    ? source.flatMap((item) => {
        const text = excerpts(item.excerpts).join("\n\n");
        return item.url && text
          ? [
              {
                url: item.url,
                title: item.title || "",
                content: text,
                error: null,
              },
            ]
          : [];
      })
    : [];
  return {
    answer,
    results,
    ...(inlineContent.length ? { inlineContent } : {}),
  };
}

function findExtractResult(
  data: Record<string, unknown>,
  url: string,
): ParallelResult | undefined {
  return Array.isArray(data.results)
    ? ((data.results as ParallelResult[]).find((item) => item.url === url) ??
        (data.results[0] as ParallelResult | undefined))
    : undefined;
}

function mapExtractResult(
  result: ParallelResult | undefined,
): ExtractedContent | null {
  if (!result?.url) return null;
  const content =
    result.full_content?.trim() || excerpts(result.excerpts).join("\n\n");
  return content.length >= 500
    ? { url: result.url, title: result.title || "", content, error: null }
    : null;
}

export async function extractWithParallel(
  url: string,
  signal: AbortSignal | undefined,
  apiKey: string,
): Promise<ExtractedContent | null> {
  const first = await post(
    PARALLEL_EXTRACT_URL,
    { urls: [url] },
    apiKey,
    signal,
  );
  const firstResult = findExtractResult(first, url);
  const mapped = mapExtractResult(firstResult);
  if (mapped) return mapped;
  if (!firstResult) return null;
  const retry = await post(
    PARALLEL_EXTRACT_URL,
    { urls: [url], advanced_settings: { full_content: true } },
    apiKey,
    signal,
  );
  return mapExtractResult(findExtractResult(retry, url));
}
