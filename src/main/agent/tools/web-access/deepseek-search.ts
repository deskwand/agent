/** Adapted from nicobailon/pi-web-access v0.13.0 (commit 7bdc30a), MIT License. */
import type { DeepSeekWebSearchAuth } from "./config-adapter";
import {
  readResponseJson,
  throwProviderHttpError,
  withRequestTimeout,
  type SearchOptions,
  type SearchResult,
  type SearchResponse,
} from "./types";

const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEEPSEEK_SEARCH_TOOL = "web_search_20250305";
const DEEPSEEK_MAX_USES = 3;
const DEEPSEEK_MAX_TOKENS = 8192;
const DEEPSEEK_TIMEOUT_MS = 60_000;

/**
 * 官方端点是 /anthropic/v1/messages（baseUrl 来自 OpenAI 兼容配置，
 * 可能是 https://api.deepseek.com 或 https://api.deepseek.com/v1，
 * 也可能是官方文档推荐的 Anthropic 端点 https://api.deepseek.com/anthropic）；
 * 本地代理等自定义网关是 {base}/v1/messages。按 host 区分，并剥离
 * /anthropic 尾缀避免双前缀。
 */
export function deepseekMessagesUrl(baseUrl: string): string {
  let base = (baseUrl || DEEPSEEK_BASE_URL)
    .replace(/\/+$/, "")
    .replace(/\/v1$/, "")
    .replace(/\/anthropic$/, "");
  let hostname: string;
  try {
    hostname = new URL(base).hostname;
  } catch {
    throw new Error(
      `Invalid DeepSeek baseUrl "${baseUrl}": expected an absolute URL like https://api.deepseek.com`,
    );
  }
  return hostname === "api.deepseek.com"
    ? `${base}/anthropic/v1/messages`
    : `${base}/v1/messages`;
}

function extractWebSearchResult(
  data: Record<string, unknown>,
  max: number,
): { answer: string; results: SearchResult[] } {
  const content = Array.isArray(data.content) ? data.content : [];
  const answerParts: string[] = [];
  const results: SearchResult[] = [];
  const seen = new Set<string>();
  const add = (title: unknown, url: unknown) => {
    if (typeof url !== "string" || !url.trim() || seen.has(url)) return;
    if (results.length >= max) return;
    seen.add(url);
    results.push({
      title: typeof title === "string" && title.trim() ? title : url,
      url,
      snippet: "",
    });
  };
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const record = block as Record<string, unknown>;
    if (record.type === "web_search_tool_result") {
      const items = record.content;
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        if (!item || typeof item !== "object") continue;
        const entry = item as Record<string, unknown>;
        if (entry.type === "web_search_result") {
          add(entry.title, entry.url);
        }
      }
    } else if (record.type === "text" && typeof record.text === "string") {
      answerParts.push(record.text);
    }
  }
  return { answer: answerParts.join("\n").trim(), results };
}

export async function searchWithDeepSeek(
  query: string,
  options: SearchOptions = {},
  auth: DeepSeekWebSearchAuth,
): Promise<SearchResponse> {
  const response = await fetch(deepseekMessagesUrl(auth.baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(auth.apiKey ? { "x-api-key": auth.apiKey } : {}),
    },
    body: JSON.stringify({
      model: auth.model,
      max_tokens: DEEPSEEK_MAX_TOKENS,
      thinking: { type: "disabled" },
      tools: [
        {
          type: DEEPSEEK_SEARCH_TOOL,
          name: "web_search",
          max_uses: DEEPSEEK_MAX_USES,
        },
      ],
      messages: [{ role: "user", content: query }],
    }),
    signal: withRequestTimeout(options.signal, DEEPSEEK_TIMEOUT_MS),
  });
  if (!response.ok) await throwProviderHttpError(response, "DeepSeek");
  const max = Math.min(Math.max(Math.floor(options.numResults ?? 5), 1), 20);
  const { answer, results } = extractWebSearchResult(
    await readResponseJson<Record<string, unknown>>(response),
    max,
  );
  if (!answer && !results.length) {
    throw new Error("DeepSeek web search returned no answer or sources");
  }
  return { answer, results };
}
