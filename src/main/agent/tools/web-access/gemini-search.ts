/** Adapted from nicobailon/pi-web-access v0.13.0 (commit 7bdc30a), MIT License. */
import type {
  WebAccessAuthProvider,
  WebSearchProvider,
} from "../../../../shared/web-access";
import { searchWithBrave } from "./brave";
import type { GeminiApiAuth, OpenAIWebSearchAuth } from "./config-adapter";
import { searchWithExa } from "./exa";
import { searchWithGeminiApi } from "./gemini-api";
import { searchWithOpenAI } from "./openai-search";
import { searchWithParallel } from "./parallel";
import { searchWithPerplexity } from "./perplexity";
import { searchWithTavily } from "./tavily";
import type { SearchOptions, SearchResponse } from "./types";

export interface WebSearchRuntime {
  defaultProvider: WebSearchProvider;
  openai?: OpenAIWebSearchAuth;
  gemini?: GeminiApiAuth;
  exaApiKey?: string;
  braveApiKey?: string;
  parallelApiKey?: string;
  tavilyApiKey?: string;
  perplexityApiKey?: string;
  authErrors?: Partial<Record<WebAccessAuthProvider, string>>;
}

export interface FullSearchOptions extends SearchOptions {
  provider?: WebSearchProvider;
}

export interface AttributedSearchResponse extends SearchResponse {
  provider: Exclude<WebSearchProvider, "auto">;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError") ||
    (error instanceof Error && error.message.toLowerCase().includes("abort"))
  );
}

function shouldTryOpenAI(options: SearchOptions): boolean {
  if (options.recencyFilter) return false;
  return (
    options.numResults === undefined || Math.floor(options.numResults) === 5
  );
}

async function explicitSearch(
  provider: Exclude<WebSearchProvider, "auto">,
  query: string,
  options: SearchOptions,
  runtime: WebSearchRuntime,
): Promise<AttributedSearchResponse> {
  if (provider === "openai") {
    if (!runtime.openai) throw new Error("OpenAI search provider unavailable");
    return {
      ...(await searchWithOpenAI(query, options, runtime.openai)),
      provider,
    };
  }
  if (provider === "exa") {
    const result = await searchWithExa(query, options, runtime.exaApiKey);
    if (!result) throw new Error("Exa search returned no results");
    return { ...result, provider };
  }
  if (provider === "brave") {
    if (!runtime.braveApiKey)
      throw new Error("Brave search provider unavailable");
    return {
      ...(await searchWithBrave(query, options, runtime.braveApiKey)),
      provider,
    };
  }
  if (provider === "parallel") {
    if (!runtime.parallelApiKey)
      throw new Error("Parallel search provider unavailable");
    return {
      ...(await searchWithParallel(query, options, runtime.parallelApiKey)),
      provider,
    };
  }
  if (provider === "tavily") {
    if (!runtime.tavilyApiKey)
      throw new Error("Tavily search provider unavailable");
    return {
      ...(await searchWithTavily(query, options, runtime.tavilyApiKey)),
      provider,
    };
  }
  if (provider === "perplexity") {
    if (!runtime.perplexityApiKey)
      throw new Error("Perplexity search provider unavailable");
    return {
      ...(await searchWithPerplexity(query, options, runtime.perplexityApiKey)),
      provider,
    };
  }
  if (!runtime.gemini) throw new Error("Gemini search provider unavailable");
  const result = await searchWithGeminiApi(query, options, runtime.gemini);
  if (!result) throw new Error("Gemini search returned no results");
  return { ...result, provider: "gemini" };
}

function isProviderAvailable(
  provider: Exclude<WebSearchProvider, "auto">,
  runtime: WebSearchRuntime,
  options: SearchOptions,
): boolean {
  if (provider === "exa") return true;
  if (provider === "openai")
    return Boolean(runtime.openai) && shouldTryOpenAI(options);
  if (provider === "gemini") return Boolean(runtime.gemini);
  const keyMap: Record<string, keyof WebSearchRuntime> = {
    brave: "braveApiKey",
    parallel: "parallelApiKey",
    tavily: "tavilyApiKey",
    perplexity: "perplexityApiKey",
  };
  const key = keyMap[provider];
  return key ? Boolean(runtime[key]) : false;
}

export async function search(
  query: string,
  options: FullSearchOptions = {},
  runtime: WebSearchRuntime,
): Promise<AttributedSearchResponse> {
  throwIfAborted(options.signal);

  // Explicit provider: fail fast, no fallback
  if (options.provider && options.provider !== "auto") {
    return explicitSearch(options.provider, query, options, runtime);
  }

  const chain: Array<{
    provider: Exclude<WebSearchProvider, "auto">;
    available: boolean;
  }> = [];

  // Step 1: If user has a specific defaultProvider, try it first
  const dp = runtime.defaultProvider;
  if (dp !== "auto") {
    chain.push({
      provider: dp,
      available: isProviderAvailable(dp, runtime, options),
    });
  }

  // Step 2: Standard fallback chain (exa first — free, no key needed)
  const standardChain: Array<Exclude<WebSearchProvider, "auto">> = [
    "exa",
    "brave",
    "parallel",
    "tavily",
    "perplexity",
    "openai",
    "gemini",
  ];

  for (const provider of standardChain) {
    if (chain.some((c) => c.provider === provider)) continue; // dedup

    chain.push({
      provider,
      available: isProviderAvailable(provider, runtime, options),
    });
  }

  const errors = Object.entries(runtime.authErrors ?? {}).map(
    ([p, msg]) => `${p}: ${msg}`,
  );
  for (const attempt of chain) {
    if (!attempt.available) continue;
    throwIfAborted(options.signal);
    try {
      return await explicitSearch(attempt.provider, query, options, runtime);
    } catch (error) {
      if (isAbortError(error)) throw error;
      errors.push(
        `${attempt.provider}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  throw new Error(
    errors.length
      ? `Auto provider search failed: ${errors.join("; ")}`
      : "No search provider available",
  );
}
