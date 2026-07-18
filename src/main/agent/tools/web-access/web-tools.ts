import { randomUUID } from "node:crypto";
import {
  defineTool,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
  MAX_WEB_ACCESS_DOMAIN_FILTERS,
  MAX_WEB_ACCESS_DOMAIN_LENGTH,
  MAX_WEB_ACCESS_QUERY_LENGTH,
  MAX_WEB_ACCESS_URL_LENGTH,
  MAX_WEB_ACCESS_URLS,
  MAX_WEB_SEARCH_QUERIES,
  type WebAccessAuthProvider,
  type WebAccessConfig,
  type WebAccessCredential,
  type WebAccessErrorCode,
  type WebAccessToolDetails,
} from "../../../../shared/web-access";
import { WebAccessCache } from "./cache";
import type {
  ResolvedWebAccessAuth,
  ResolveWebAccessProviderAuth,
} from "./config-adapter";
import { fetchAllContent } from "./extract";
import { normalizeFetchContentParams } from "./fetch-params";
import {
  search,
  type FullSearchOptions,
  type WebSearchRuntime,
} from "./gemini-search";
import {
  getWebAccessSessionTempDir,
  removeAllWebAccessTempDirs,
  removeWebAccessTempDir,
} from "./session-temp";
import type {
  ExtractedContent,
  QueryResultData,
  StoredWebAccessResult,
} from "./types";

export {
  getWebAccessSessionTempDir,
  removeAllWebAccessTempDirs,
  removeWebAccessTempDir,
};

const MAX_INLINE_CONTENT = 30_000;

export interface CreateWebAccessToolsOptions {
  workspaceDir: string;
  sessionId: string;
  getConfig: () => WebAccessConfig;
  resolveProviderAuth: ResolveWebAccessProviderAuth;
  cache: WebAccessCache;
}

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  details: WebAccessToolDetails;
};

function errorResult(
  text: string,
  errorCode: NonNullable<WebAccessToolDetails["errorCode"]>,
): ToolResult {
  return {
    content: [{ type: "text", text }],
    details: { errorCode },
  };
}

function recencyEnum() {
  return Type.Union([
    Type.Literal("day"),
    Type.Literal("week"),
    Type.Literal("month"),
    Type.Literal("year"),
  ]);
}

function safeDiagnosticMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(
      /((?:api[-_ ]?key|token|secret|authorization|bearer)\s*[:=]\s*)[^\s,;]+/gi,
      "$1***",
    )
    .slice(0, 300);
}

async function buildRuntime(
  config: WebAccessConfig,
  resolveAuth: (
    provider: WebAccessAuthProvider,
    credential: WebAccessCredential,
  ) => Promise<ResolvedWebAccessAuth | undefined>,
  needs: { openai?: boolean; gemini?: boolean },
  authErrorsFatal = false,
): Promise<WebSearchRuntime> {
  const authErrors: Partial<Record<WebAccessAuthProvider, string>> = {};
  const resolveOptional = async (
    provider: WebAccessAuthProvider,
    credential: WebAccessCredential,
    needed: boolean | undefined,
  ): Promise<ResolvedWebAccessAuth | undefined> => {
    if (!needed) return undefined;
    try {
      return await resolveAuth(provider, credential);
    } catch (error) {
      const message = `Authentication failed for ${provider}: ${safeDiagnosticMessage(error)}`;
      if (authErrorsFatal) throw new Error(message);
      authErrors[provider] = message;
      return undefined;
    }
  };
  const [openai, gemini] = await Promise.all([
    resolveOptional("openai", config.openai, needs.openai),
    resolveOptional("gemini", config.gemini, needs.gemini),
  ]);
  return {
    defaultProvider: config.defaultProvider,
    openai:
      openai?.provider === "openai" || openai?.provider === "openai-codex"
        ? openai
        : undefined,
    gemini: gemini?.provider === "gemini" ? gemini : undefined,
    exaApiKey: config.exaApiKey.trim() || undefined,
    braveApiKey: config.braveApiKey.trim() || undefined,
    parallelApiKey: config.parallelApiKey.trim() || undefined,
    tavilyApiKey: config.tavilyApiKey.trim() || undefined,
    perplexityApiKey: config.perplexityApiKey.trim() || undefined,
    ...(Object.keys(authErrors).length ? { authErrors } : {}),
  };
}

function uniqueStrings(
  values: unknown[],
  maxItems: number,
  maxLength: number,
): string[] {
  return Array.from(
    new Set(
      values.flatMap((value) => {
        if (typeof value !== "string") return [];
        const normalized = value.trim();
        return normalized && normalized.length <= maxLength ? [normalized] : [];
      }),
    ),
  ).slice(0, maxItems);
}

function formatSearch(query: QueryResultData): string {
  if (query.error) return `## Query: ${query.query}\n\nError: ${query.error}`;
  const sources = query.results
    .map((result, index) => {
      const snippet = result.snippet.replace(/\s+/g, " ").trim().slice(0, 500);
      return `${index + 1}. [${result.title}](${result.url})${snippet ? ` — ${snippet}` : ""}`;
    })
    .join("\n");
  const provider = query.provider ? `Provider: ${query.provider}\n\n` : "";
  return `## Query: ${query.query}\n\n${provider}${query.answer}${sources ? `\n\n### Sources\n${sources}` : ""}`;
}

function classifyError(
  error: unknown,
  signal?: AbortSignal,
): WebAccessErrorCode {
  if (signal?.aborted) return "CANCELLED";
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  if (name === "AbortError" && !normalized.includes("timeout")) {
    return "CANCELLED";
  }
  if (name === "TimeoutError" || normalized.includes("timeout")) {
    return "REQUEST_TIMEOUT";
  }
  if (/\b429\b|rate.?limit|too many requests/.test(normalized)) {
    return "RATE_LIMITED";
  }
  if (
    /\b(401|403)\b|unauthorized|forbidden|authentication|api key (?:is )?required|invalid key/.test(
      normalized,
    )
  ) {
    return "AUTHENTICATION_FAILED";
  }
  return "PROVIDER_UNAVAILABLE";
}

function preferredErrorCode(codes: WebAccessErrorCode[]): WebAccessErrorCode {
  const precedence: WebAccessErrorCode[] = [
    "CANCELLED",
    "AUTHENTICATION_FAILED",
    "RATE_LIMITED",
    "REQUEST_TIMEOUT",
  ];
  return (
    precedence.find((code) => codes.includes(code)) ?? "PROVIDER_UNAVAILABLE"
  );
}

function preferredFetchErrorCode(
  results: ExtractedContent[],
): WebAccessErrorCode {
  const codes = new Set(
    results.flatMap((result) => (result.errorCode ? [result.errorCode] : [])),
  );
  const precedence: WebAccessErrorCode[] = [
    "CANCELLED",
    "FETCH_BLOCKED",
    "CONTENT_TOO_LARGE",
    "RATE_LIMITED",
    "REQUEST_TIMEOUT",
    "AUTHENTICATION_FAILED",
    "UNSUPPORTED_CONTENT",
  ];
  return precedence.find((code) => codes.has(code)) ?? "UNSUPPORTED_CONTENT";
}

function findUrl(
  urls: ExtractedContent[],
  selector: { url?: string; urlIndex?: number },
): ExtractedContent | undefined {
  if (selector.url !== undefined) {
    return urls.find((item) => item.url === selector.url);
  }
  if (selector.urlIndex !== undefined) return urls[selector.urlIndex];
  return undefined;
}

export function createWebAccessTools(
  options: CreateWebAccessToolsOptions,
): ToolDefinition[] {
  const webSearch = defineTool({
    name: "web_search",
    label: "Web Search",
    description:
      "Search the web and return an answer with source citations. Use queries for multiple research angles. Set includeContent to retain full source pages for get_search_content.",
    promptSnippet:
      "Use for web research. Prefer multiple varied queries for broad research.",
    parameters: Type.Object({
      query: Type.Optional(
        Type.String({ maxLength: MAX_WEB_ACCESS_QUERY_LENGTH }),
      ),
      queries: Type.Optional(
        Type.Array(Type.String({ maxLength: MAX_WEB_ACCESS_QUERY_LENGTH }), {
          maxItems: MAX_WEB_SEARCH_QUERIES,
        }),
      ),
      numResults: Type.Optional(Type.Number({ minimum: 1, maximum: 20 })),
      includeContent: Type.Optional(Type.Boolean()),
      recencyFilter: Type.Optional(recencyEnum()),
      domainFilter: Type.Optional(
        Type.Array(Type.String({ maxLength: MAX_WEB_ACCESS_DOMAIN_LENGTH }), {
          maxItems: MAX_WEB_ACCESS_DOMAIN_FILTERS,
        }),
      ),
    }),
    async execute(_toolCallId, params, signal, onUpdate): Promise<ToolResult> {
      const queryList = uniqueStrings(
        params.queries?.length ? params.queries : [params.query],
        MAX_WEB_SEARCH_QUERIES,
        MAX_WEB_ACCESS_QUERY_LENGTH,
      );
      if (!queryList.length) {
        return errorResult(
          "No query provided. Use query or queries.",
          "UNSUPPORTED_CONTENT",
        );
      }
      const config = options.getConfig();
      let runtime: WebSearchRuntime;
      try {
        runtime = await buildRuntime(
          config,
          options.resolveProviderAuth,
          { openai: true, gemini: true },
          false,
        );
      } catch (error) {
        return errorResult(
          error instanceof Error ? error.message : String(error),
          classifyError(error),
        );
      }
      const queryResults: QueryResultData[] = [];
      const failureCodes: WebAccessErrorCode[] = [];
      const urls: ExtractedContent[] = [];
      for (const [index, query] of queryList.entries()) {
        onUpdate?.({
          content: [
            {
              type: "text",
              text: `Searching ${index + 1}/${queryList.length}: ${query}`,
            },
          ],
          details: { queryCount: queryList.length },
        });
        try {
          const searchOptions: FullSearchOptions = {
            numResults: params.numResults,
            includeContent: params.includeContent,
            recencyFilter: params.recencyFilter,
            domainFilter: uniqueStrings(
              params.domainFilter ?? [],
              MAX_WEB_ACCESS_DOMAIN_FILTERS,
              MAX_WEB_ACCESS_DOMAIN_LENGTH,
            ),
            signal,
          };
          const result = await search(query, searchOptions, runtime);
          queryResults.push({
            query,
            answer: result.answer,
            results: result.results,
            error: null,
            provider: result.provider,
          });
          for (const item of result.inlineContent ?? []) {
            if (urls.length >= MAX_WEB_ACCESS_URLS) break;
            if (!urls.some((existing) => existing.url === item.url)) {
              urls.push(item);
            }
          }
          if (params.includeContent) {
            const remaining = MAX_WEB_ACCESS_URLS - urls.length;
            const missing = result.results
              .map((item) => item.url)
              .filter((url) => !urls.some((item) => item.url === url))
              .slice(0, remaining);
            if (missing.length) {
              urls.push(
                ...(await fetchAllContent(missing, signal, {
                  workspaceDir: options.workspaceDir,
                  tempDir: getWebAccessSessionTempDir(options.sessionId),
                  runtime,
                  ssrfEnabled: config.ssrfEnabled,
                })),
              );
            }
          }
        } catch (error) {
          const errorCode = classifyError(error, signal);
          if (errorCode === "CANCELLED") {
            return errorResult(
              error instanceof Error ? error.message : "Request cancelled",
              errorCode,
            );
          }
          failureCodes.push(errorCode);
          queryResults.push({
            query,
            answer: "",
            results: [],
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      const responseId = randomUUID();
      const record: StoredWebAccessResult = {
        id: responseId,
        type: "search",
        timestamp: Date.now(),
        queries: queryResults,
        urls,
      };
      options.cache.set(options.sessionId, record);
      const successful = queryResults.filter((item) => !item.error);
      const fullText = queryResults.map(formatSearch).join("\n\n");
      const truncated = fullText.length > MAX_INLINE_CONTENT;
      const text = truncated
        ? `${fullText.slice(0, MAX_INLINE_CONTENT)}\n\n[Search output truncated. Use get_search_content with responseId ${responseId} and a query.]`
        : `${fullText}\n\n---\nresponseId: ${responseId}`;
      const provider = successful[0]?.provider;
      return {
        content: [{ type: "text", text }],
        details: {
          responseId,
          provider,
          queryCount: queryList.length,
          successful: successful.length,
          totalChars: fullText.length,
          truncated,
          ...(successful.length
            ? {}
            : { errorCode: preferredErrorCode(failureCodes) }),
        },
      };
    },
  });

  const fetchContent = defineTool({
    name: "fetch_content",
    label: "Fetch Content",
    description:
      "Fetch URL(s) and extract readable Markdown. Supports web pages, GitHub repositories, and text PDFs. Full content is stored for get_search_content.",
    promptSnippet:
      "Use to extract readable content from URL(s), GitHub repositories, or PDFs.",
    executionMode: "parallel",
    parameters: Type.Object({
      url: Type.Optional(Type.String({ maxLength: MAX_WEB_ACCESS_URL_LENGTH })),
      urls: Type.Optional(
        Type.Array(Type.String({ maxLength: MAX_WEB_ACCESS_URL_LENGTH }), {
          maxItems: MAX_WEB_ACCESS_URLS,
        }),
      ),
      forceClone: Type.Optional(Type.Boolean()),
    }),
    async execute(_toolCallId, params, signal, onUpdate): Promise<ToolResult> {
      const normalized = normalizeFetchContentParams(params);
      if (!normalized.urlList.length) {
        return errorResult("No URL provided.", "UNSUPPORTED_CONTENT");
      }
      onUpdate?.({
        content: [
          {
            type: "text",
            text: `Fetching ${normalized.urlList.length} URL(s)...`,
          },
        ],
        details: { urlCount: normalized.urlList.length },
      });
      const runtime = await buildRuntime(
        options.getConfig(),
        options.resolveProviderAuth,
        { gemini: true },
      );
      // Spread normalized.options (forceClone) before ssrfEnabled so
      // the config value always takes precedence.
      const results = await fetchAllContent(normalized.urlList, signal, {
        ...normalized.options,
        workspaceDir: options.workspaceDir,
        tempDir: getWebAccessSessionTempDir(options.sessionId),
        runtime,
        ssrfEnabled: options.getConfig().ssrfEnabled,
      });
      const responseId = randomUUID();
      options.cache.set(options.sessionId, {
        id: responseId,
        type: "fetch",
        timestamp: Date.now(),
        urls: results,
      });
      const successful = results.filter((item) => !item.error);
      if (results.length === 1) {
        const result = results[0];
        if (result.error) {
          return {
            content: [{ type: "text", text: result.error }],
            details: {
              responseId,
              urlCount: 1,
              successful: 0,
              errorCode: result.errorCode || "UNSUPPORTED_CONTENT",
            },
          };
        }
        const truncated = result.content.length > MAX_INLINE_CONTENT;
        const text = truncated
          ? `${result.content.slice(0, MAX_INLINE_CONTENT)}\n\n[Content truncated. Use get_search_content with responseId ${responseId}.]`
          : `${result.content}\n\n---\nresponseId: ${responseId}`;
        return {
          content: [{ type: "text", text }],
          details: {
            responseId,
            urlCount: 1,
            successful: 1,
            totalChars: result.content.length,
            truncated,
          },
        };
      }
      const text = results
        .map((item, index) =>
          item.error
            ? `${index}. ${item.url}: Error — ${item.error}`
            : `${index}. ${item.title || item.url} (${item.content.length} chars)`,
        )
        .join("\n");
      return {
        content: [
          {
            type: "text",
            text: `${text}\n\nresponseId: ${responseId}`,
          },
        ],
        details: {
          responseId,
          urlCount: results.length,
          successful: successful.length,
          totalChars: successful.reduce(
            (total, item) => total + item.content.length,
            0,
          ),
          ...(successful.length
            ? {}
            : { errorCode: preferredFetchErrorCode(results) }),
        },
      };
    },
  });

  const getSearchContent = defineTool({
    name: "get_search_content",
    label: "Get Search Content",
    description:
      "Retrieve full content stored by a previous web_search or fetch_content call.",
    promptSnippet:
      "Use with responseId after web_search or fetch_content when full content is needed.",
    parameters: Type.Object({
      responseId: Type.String(),
      query: Type.Optional(Type.String()),
      url: Type.Optional(Type.String()),
      urlIndex: Type.Optional(Type.Number({ minimum: 0 })),
    }),
    async execute(_toolCallId, params): Promise<ToolResult> {
      const cached = options.cache.lookup(options.sessionId, params.responseId);
      if (cached.status !== "hit") {
        return errorResult(
          cached.status === "expired"
            ? `Stored content for responseId ${params.responseId} has expired.`
            : `No stored content for responseId ${params.responseId}.`,
          cached.status === "expired" ? "CACHE_EXPIRED" : "CACHE_MISS",
        );
      }
      const record = cached.result;
      if (params.query !== undefined && record.type === "search") {
        const query = record.queries.find(
          (item) => item.query === params.query,
        );
        if (!query) {
          return errorResult(
            "Query not found in cached result.",
            "SELECTOR_NOT_FOUND",
          );
        }
        return {
          content: [{ type: "text", text: formatSearch(query) }],
          details: { responseId: record.id },
        };
      }
      const selected = findUrl(record.urls, {
        url: params.url,
        urlIndex: params.urlIndex,
      });
      if (selected) {
        return {
          content: [{ type: "text", text: selected.error || selected.content }],
          details: {
            responseId: record.id,
            totalChars: selected.content.length,
            ...(selected.errorCode
              ? { errorCode: selected.errorCode }
              : selected.error
                ? { errorCode: "UNSUPPORTED_CONTENT" }
                : {}),
          },
        };
      }
      const available = [
        ...(record.type === "search"
          ? record.queries.map((item) => `query: ${item.query}`)
          : []),
        ...record.urls.map((item, index) => `urlIndex ${index}: ${item.url}`),
      ].join("\n");
      return {
        content: [
          {
            type: "text",
            text: available || "Cached result contains no retrievable content.",
          },
        ],
        details: { responseId: record.id },
      };
    },
  });

  return [webSearch, fetchContent, getSearchContent];
}
