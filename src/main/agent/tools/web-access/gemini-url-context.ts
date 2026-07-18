/** Adapted from nicobailon/pi-web-access v0.13.0 (commit 7bdc30a), MIT License. */
import type { GeminiApiAuth } from "./config-adapter";
import {
  readResponseJson,
  withRequestTimeout,
  type ExtractedContent,
} from "./types";

export async function extractWithUrlContext(
  url: string,
  signal: AbortSignal | undefined,
  auth: GeminiApiAuth,
): Promise<ExtractedContent | null> {
  const response = await fetch(
    `${auth.baseUrl.replace(/\/+$/, "")}/v1beta/models/gemini-2.5-flash:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": auth.apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `Extract the readable content from ${url}. Return clean Markdown with the page title and factual content only.`,
              },
            ],
          },
        ],
        tools: [{ url_context: {} }],
      }),
      signal: withRequestTimeout(signal, 60_000),
    },
  );
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  const data = await readResponseJson<{
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  }>(response);
  const content =
    data.candidates?.[0]?.content?.parts
      ?.flatMap((part) => (part.text ? [part.text] : []))
      .join("\n")
      .trim() || "";
  if (!content) return null;
  const title =
    content.match(/^#\s+(.+)$/m)?.[1]?.trim() || new URL(url).hostname;
  return { url, title, content, error: null };
}
