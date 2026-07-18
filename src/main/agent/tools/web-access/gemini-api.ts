/** Adapted from nicobailon/pi-web-access v0.13.0 (commit 7bdc30a), MIT License. */
import type { GeminiApiAuth } from "./config-adapter";
import {
  readResponseJson,
  throwProviderHttpError,
  withRequestTimeout,
  type SearchOptions,
  type SearchResponse,
} from "./types";

interface GroundingChunk {
  web?: { uri?: string; title?: string };
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    groundingMetadata?: { groundingChunks?: GroundingChunk[] };
  }>;
}

async function resolveRedirect(
  proxyUrl: string,
  signal: AbortSignal | undefined,
): Promise<string | null> {
  try {
    const response = await fetch(proxyUrl, {
      method: "HEAD",
      redirect: "manual",
      signal: withRequestTimeout(signal, 5_000),
    });
    return response.headers.get("location");
  } catch {
    return null;
  }
}

async function resolveGroundingChunks(
  chunks: GroundingChunk[] | undefined,
  max: number,
  signal: AbortSignal | undefined,
) {
  const results: SearchResponse["results"] = [];
  const seen = new Set<string>();
  for (const chunk of chunks ?? []) {
    let url = chunk.web?.uri;
    if (!url) continue;
    if (
      url.includes("vertexaisearch.cloud.google.com/grounding-api-redirect")
    ) {
      url = (await resolveRedirect(url, signal)) || url;
    }
    if (seen.has(url)) continue;
    seen.add(url);
    results.push({ title: chunk.web?.title || url, url, snippet: "" });
    if (results.length >= max) break;
  }
  return results;
}

export async function searchWithGeminiApi(
  query: string,
  options: SearchOptions = {},
  auth: GeminiApiAuth,
): Promise<SearchResponse | null> {
  if (!auth.apiKey.trim()) return null;
  const baseUrl = auth.baseUrl.replace(/\/+$/, "");
  const response = await fetch(
    `${baseUrl}/v1beta/models/gemini-2.5-flash:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": auth.apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: query }] }],
        tools: [{ google_search: {} }],
      }),
      signal: withRequestTimeout(options.signal, 60_000),
    },
  );
  if (!response.ok) await throwProviderHttpError(response, "Gemini");
  const data = await readResponseJson<GeminiResponse>(response);
  const candidate = data.candidates?.[0];
  const answer =
    candidate?.content?.parts
      ?.flatMap((part) => (part.text ? [part.text] : []))
      .join("\n") || "";
  const max = Math.min(Math.max(Math.floor(options.numResults ?? 5), 1), 20);
  const results = await resolveGroundingChunks(
    candidate?.groundingMetadata?.groundingChunks,
    max,
    options.signal,
  );
  return answer || results.length ? { answer, results } : null;
}
