/** Adapted from nicobailon/pi-web-access v0.13.0 (commit 7bdc30a), MIT License. */
import type { OpenAIWebSearchAuth } from "./config-adapter";
import {
  readResponseText,
  throwProviderHttpError,
  withRequestTimeout,
  type SearchOptions,
  type SearchResult,
  type SearchResponse,
} from "./types";

const CODEX_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    return JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function accountId(token: string): string | undefined {
  const auth = decodeJwtPayload(token)?.["https://api.openai.com/auth"];
  if (!auth || typeof auth !== "object") return undefined;
  const value = (auth as Record<string, unknown>).chatgpt_account_id;
  return typeof value === "string" ? value : undefined;
}

function normalizeDomain(raw: string): string | null {
  const value = raw.trim().replace(/^-/, "");
  try {
    return new URL(value.includes("://") ? value : `https://${value}`).hostname;
  } catch {
    return null;
  }
}

function webSearchTool(options: SearchOptions): Record<string, unknown> {
  const allowed: string[] = [];
  const blocked: string[] = [];
  for (const raw of options.domainFilter ?? []) {
    const domain = normalizeDomain(raw);
    if (!domain) continue;
    (raw.trim().startsWith("-") ? blocked : allowed).push(domain);
  }
  return {
    type: "web_search",
    ...(allowed.length || blocked.length
      ? {
          filters: {
            ...(allowed.length ? { allowed_domains: allowed } : {}),
            ...(blocked.length ? { blocked_domains: blocked } : {}),
          },
        }
      : {}),
  };
}

async function parseResponse(
  response: Response,
): Promise<Record<string, unknown>> {
  const text = await readResponseText(response);
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    let final: Record<string, unknown> | null = null;
    for (const line of text.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const event = JSON.parse(payload) as Record<string, unknown>;
        const responseValue = event.response;
        if (responseValue && typeof responseValue === "object") {
          final = responseValue as Record<string, unknown>;
        }
      } catch {
        continue;
      }
    }
    if (final) return final;
    throw new Error("OpenAI API returned an unreadable response");
  }
}

function extractOutput(
  data: Record<string, unknown>,
  max: number,
): SearchResponse {
  const output = Array.isArray(data.output) ? data.output : [];
  const answerParts: string[] = [];
  const results: SearchResult[] = [];
  const seen = new Set<string>();
  const add = (url: unknown, title: unknown) => {
    if (typeof url !== "string" || seen.has(url) || results.length >= max)
      return;
    seen.add(url);
    results.push({
      title: typeof title === "string" ? title : url,
      url,
      snippet: "",
    });
  };
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (record.type === "web_search_call") {
      const action = record.action;
      if (action && typeof action === "object") {
        const sources = (action as Record<string, unknown>).sources;
        if (Array.isArray(sources)) {
          for (const source of sources) {
            if (source && typeof source === "object") {
              const value = source as Record<string, unknown>;
              add(value.url, value.title);
            }
          }
        }
      }
    }
    const content = record.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const value = part as Record<string, unknown>;
      if (typeof value.text === "string") answerParts.push(value.text);
      if (Array.isArray(value.annotations)) {
        for (const annotation of value.annotations) {
          if (annotation && typeof annotation === "object") {
            const entry = annotation as Record<string, unknown>;
            add(entry.url, entry.title);
          }
        }
      }
    }
  }
  return { answer: answerParts.join("\n").trim(), results };
}

export async function searchWithOpenAI(
  query: string,
  options: SearchOptions = {},
  auth: OpenAIWebSearchAuth,
): Promise<SearchResponse> {
  const useCodex = auth.provider === "openai-codex";
  const url = useCodex
    ? CODEX_RESPONSES_URL
    : `${auth.baseUrl.replace(/\/+$/, "")}/responses`;
  const headers: Record<string, string> = {
    ...auth.headers,
    Authorization: `Bearer ${auth.apiKey}`,
    "Content-Type": "application/json",
    "OpenAI-Beta": "responses=experimental",
  };
  if (useCodex) {
    const id = accountId(auth.apiKey);
    if (id) headers["chatgpt-account-id"] = id;
    headers.originator = "deskwand";
  }
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: auth.model,
      instructions: "Search the web and answer using cited web sources only.",
      input: [{ role: "user", content: [{ type: "input_text", text: query }] }],
      tools: [webSearchTool(options)],
      include: ["web_search_call.action.sources"],
      store: false,
      stream: useCodex,
      tool_choice: "required",
      parallel_tool_calls: true,
    }),
    signal: withRequestTimeout(options.signal, 60_000),
  });
  if (!response.ok) await throwProviderHttpError(response, "OpenAI");
  const max = Math.min(Math.max(Math.floor(options.numResults ?? 5), 1), 20);
  const result = extractOutput(await parseResponse(response), max);
  if (!result.answer && !result.results.length) {
    throw new Error("OpenAI web search returned no answer or sources");
  }
  return result;
}
