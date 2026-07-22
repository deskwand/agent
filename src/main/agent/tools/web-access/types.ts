import type {
  WebAccessErrorCode,
  WebSearchProvider,
} from "../../../../shared/web-access";

export interface SearchOptions {
  numResults?: number;
  recencyFilter?: "day" | "week" | "month" | "year";
  domainFilter?: string[];
  includeContent?: boolean;
  signal?: AbortSignal;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface ExtractedContent {
  url: string;
  title: string;
  content: string;
  error: string | null;
  errorCode?: WebAccessErrorCode;
}

export interface SearchResponse {
  answer: string;
  results: SearchResult[];
  inlineContent?: ExtractedContent[];
}

export interface QueryResultData {
  query: string;
  answer: string;
  results: SearchResult[];
  error: string | null;
  provider?: Exclude<WebSearchProvider, "auto">;
}

export const MAX_PROVIDER_RESPONSE_BYTES = 5 * 1024 * 1024;

export async function readResponseText(
  response: Response,
  maxBytes = MAX_PROVIDER_RESPONSE_BYTES,
): Promise<string> {
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(
      `Provider response exceeds ${Math.round(maxBytes / 1024 / 1024)} MB`,
    );
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error(
        `Provider response exceeds ${Math.round(maxBytes / 1024 / 1024)} MB`,
      );
    }
    chunks.push(value);
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(output);
}

export async function readResponseJson<T>(response: Response): Promise<T> {
  const text = await readResponseText(response);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("Provider returned an unreadable JSON response");
  }
}

export async function throwProviderHttpError(
  response: Response,
  provider: string,
): Promise<never> {
  await response.body?.cancel().catch(() => undefined);
  throw new Error(
    `${provider} API error ${response.status}${response.statusText ? `: ${response.statusText}` : ""}`,
  );
}

export function withRequestTimeout(
  signal: AbortSignal | undefined,
  timeoutMs: number,
): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export type StoredWebAccessResult =
  | {
      id: string;
      type: "search";
      timestamp: number;
      queries: QueryResultData[];
      urls: ExtractedContent[];
    }
  | {
      id: string;
      type: "fetch";
      timestamp: number;
      urls: ExtractedContent[];
    };
