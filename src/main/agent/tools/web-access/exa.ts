/** Adapted from nicobailon/pi-web-access v0.13.0 (commit 7bdc30a), MIT License. */
import {
  readResponseJson,
  readResponseText,
  throwProviderHttpError,
  withRequestTimeout,
  type ExtractedContent,
  type SearchOptions,
  type SearchResponse,
} from "./types";

const EXA_ANSWER_URL = "https://api.exa.ai/answer";
const EXA_SEARCH_URL = "https://api.exa.ai/search";
const EXA_MCP_URL = "https://mcp.exa.ai/mcp";
const REQUEST_TIMEOUT_MS = 60_000;

interface ExaResult {
  title?: string;
  url?: string;
  text?: string;
  highlights?: string[];
}

interface ExaMcpResponse {
  result?: {
    content?: Array<{ type?: string; text?: string }>;
    isError?: boolean;
  };
  error?: { code?: number; message?: string };
}

function normalizedHighlights(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string =>
          typeof item === "string" && Boolean(item.trim()),
      )
    : [];
}

function mapResults(results: ExaResult[] | undefined, max: number) {
  return (results ?? [])
    .flatMap((item, index) =>
      item.url
        ? [
            {
              title: item.title || `Source ${index + 1}`,
              url: item.url,
              snippet:
                normalizedHighlights(item.highlights)[0] || item.text || "",
            },
          ]
        : [],
    )
    .slice(0, max);
}

function buildAnswer(results: ExaResult[] | undefined): string {
  return (results ?? [])
    .flatMap((item, index) => {
      if (!item.url) return [];
      const text =
        normalizedHighlights(item.highlights).join(" ") ||
        item.text?.trim().slice(0, 1000) ||
        "";
      return text
        ? [
            `${text}\nSource: ${item.title || `Source ${index + 1}`} (${item.url})`,
          ]
        : [];
    })
    .join("\n\n");
}

function mapInlineContent(
  results: ExaResult[] | undefined,
): ExtractedContent[] {
  return (results ?? []).flatMap((item) =>
    item.url && item.text?.trim()
      ? [
          {
            url: item.url,
            title: item.title || "",
            content: item.text,
            error: null,
          },
        ]
      : [],
  );
}

function recencyToStartDate(
  filter: NonNullable<SearchOptions["recencyFilter"]>,
) {
  const days = { day: 1, week: 7, month: 30, year: 365 }[filter];
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function mapDomainFilter(domainFilter: string[] | undefined): {
  includeDomains?: string[];
  excludeDomains?: string[];
} {
  const includeDomains = (domainFilter ?? [])
    .filter((domain) => !domain.trim().startsWith("-"))
    .map((domain) => domain.trim())
    .filter(Boolean);
  const excludeDomains = (domainFilter ?? [])
    .filter((domain) => domain.trim().startsWith("-"))
    .map((domain) => domain.trim().slice(1).trim())
    .filter(Boolean);
  return {
    ...(includeDomains.length ? { includeDomains } : {}),
    ...(excludeDomains.length ? { excludeDomains } : {}),
  };
}

function buildMcpQuery(query: string, options: SearchOptions): string {
  const parts = [query];
  for (const domain of options.domainFilter ?? []) {
    const value = domain.trim();
    if (!value) continue;
    parts.push(
      value.startsWith("-") ? `-site:${value.slice(1)}` : `site:${value}`,
    );
  }
  if (options.recencyFilter) {
    const labels = {
      day: "past 24 hours",
      week: "past week",
      month: "past month",
      year: "past year",
    };
    parts.push(labels[options.recencyFilter]);
  }
  return parts.join(" ");
}

function parseMcpText(text: string, includeContent: boolean): SearchResponse {
  const blocks = text
    .split(/(?=^Title:\s*)/m)
    .map((block) => block.trim())
    .filter(Boolean);
  const parsed = blocks.flatMap((block) => {
    const title = block.match(/^Title:\s*(.+)/m)?.[1]?.trim();
    const url = block.match(/^URL:\s*(https?:\/\/\S+)/m)?.[1]?.trim();
    const content =
      block.match(/(?:^|\n)(?:Text|Content):\s*([\s\S]+)/i)?.[1]?.trim() || "";
    return url ? [{ title: title || url, url, content }] : [];
  });
  const answer = parsed
    .flatMap((item) =>
      item.content
        ? [`${item.content}\nSource: ${item.title} (${item.url})`]
        : [],
    )
    .join("\n\n");
  const inlineContent: ExtractedContent[] = includeContent
    ? parsed.flatMap((item) =>
        item.content
          ? [
              {
                url: item.url,
                title: item.title,
                content: item.content,
                error: null,
              },
            ]
          : [],
      )
    : [];
  return {
    answer: answer || text.trim(),
    results: parsed.map((item) => ({
      title: item.title,
      url: item.url,
      snippet: item.content.replace(/\s+/g, " ").slice(0, 500),
    })),
    ...(inlineContent.length ? { inlineContent } : {}),
  };
}

function parseMcpResponse(raw: string): ExaMcpResponse | null {
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload) continue;
    try {
      const parsed = JSON.parse(payload) as ExaMcpResponse;
      if (parsed.result || parsed.error) return parsed;
    } catch {
      continue;
    }
  }
  try {
    const parsed = JSON.parse(raw) as ExaMcpResponse;
    return parsed.result || parsed.error ? parsed : null;
  } catch {
    return null;
  }
}

async function searchMcp(
  query: string,
  options: SearchOptions,
): Promise<SearchResponse | null> {
  const response = await fetch(EXA_MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "web_search_exa",
        arguments: {
          query: buildMcpQuery(query, options),
          numResults: Math.min(
            Math.max(Math.floor(options.numResults ?? 5), 1),
            20,
          ),
          livecrawl: "fallback",
          type: "auto",
          contextMaxCharacters: options.includeContent ? 50_000 : 3_000,
        },
      },
    }),
    signal: withRequestTimeout(options.signal, REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) await throwProviderHttpError(response, "Exa MCP");
  const data = parseMcpResponse(await readResponseText(response));
  if (!data) throw new Error("Exa MCP returned an empty response");
  if (data.error?.message || data.result?.isError) {
    const text = data.result?.content?.find(
      (item) => item.type === "text" && item.text?.trim(),
    )?.text;
    throw new Error(data.error?.message || text || "Exa MCP returned an error");
  }
  const text = data.result?.content?.find(
    (item) => item.type === "text" && item.text?.trim(),
  )?.text;
  return text ? parseMcpText(text, Boolean(options.includeContent)) : null;
}

export async function searchWithExa(
  query: string,
  options: SearchOptions = {},
  apiKey?: string,
): Promise<SearchResponse | null> {
  if (!apiKey?.trim()) return searchMcp(query, options);
  const max = Math.min(Math.max(Math.floor(options.numResults ?? 5), 1), 20);
  const useSearch =
    Boolean(options.includeContent) ||
    Boolean(options.recencyFilter) ||
    Boolean(options.domainFilter?.length) ||
    max !== 5;
  const url = useSearch ? EXA_SEARCH_URL : EXA_ANSWER_URL;
  const body = useSearch
    ? {
        query,
        type: "auto",
        numResults: max,
        ...mapDomainFilter(options.domainFilter),
        ...(options.recencyFilter
          ? { startPublishedDate: recencyToStartDate(options.recencyFilter) }
          : {}),
        contents: {
          text: options.includeContent ? true : { maxCharacters: 3_000 },
          highlights: true,
        },
      }
    : { query, text: true };
  const response = await fetch(url, {
    method: "POST",
    headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: withRequestTimeout(options.signal, REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) await throwProviderHttpError(response, "Exa");
  if (!useSearch) {
    const data = await readResponseJson<{
      answer?: string;
      citations?: ExaResult[];
    }>(response);
    return {
      answer: data.answer || "",
      results: mapResults(data.citations, max),
    };
  }
  const data = await readResponseJson<{ results?: ExaResult[] }>(response);
  const inlineContent = options.includeContent
    ? mapInlineContent(data.results)
    : [];
  return {
    answer: buildAnswer(data.results),
    results: mapResults(data.results, max),
    ...(inlineContent.length ? { inlineContent } : {}),
  };
}
