/** Adapted from nicobailon/pi-web-access v0.13.0 (commit 7bdc30a), MIT License. */
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import pLimit from "p-limit";
import TurndownService from "turndown";
import type { Lookup } from "./ssrf-protection";
import { fetchRemoteUrl, validateRemoteUrl } from "./ssrf-protection";
import { extractGitHub } from "./github-extract";
import { extractPDFToMarkdown, isPDF } from "./pdf-extract";
import { extractWithParallel } from "./parallel";
import { extractRSCContent } from "./rsc-extract";
import { extractWithUrlContext } from "./gemini-url-context";
import type { WebSearchRuntime } from "./gemini-search";
import { withRequestTimeout, type ExtractedContent } from "./types";

const DEFAULT_TIMEOUT_MS = 30_000;
const MIN_USEFUL_CONTENT = 500;
const MAX_HTML_BYTES = 5 * 1024 * 1024;
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const fetchLimit = pLimit(3);
const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});

class ResponseTooLargeError extends Error {}

async function readResponseWithLimit(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  if (!response.body) return new ArrayBuffer(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    if (signal?.aborted) {
      await reader.cancel(signal.reason).catch(() => undefined);
      throw signal.reason;
    }
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new ResponseTooLargeError();
    }
    chunks.push(value);
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output.buffer as ArrayBuffer;
}

export interface ExtractOptions {
  forceClone?: boolean;
  workspaceDir: string;
  tempDir: string;
  runtime: WebSearchRuntime;
  lookup?: Lookup;
  /** Test seam. Production requests use the DNS-pinned transport. */
  fetch?: typeof fetch;
}

function aborted(url: string): ExtractedContent {
  return {
    url,
    title: "",
    content: "",
    error: "Request cancelled",
    errorCode: "CANCELLED",
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isYouTubeUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return (
      host === "youtube.com" || host === "youtu.be" || host === "m.youtube.com"
    );
  } catch {
    return false;
  }
}

async function extractWithJina(
  url: string,
  signal: AbortSignal | undefined,
): Promise<ExtractedContent | null> {
  const response = await fetch(`https://r.jina.ai/${url}`, {
    headers: { Accept: "text/markdown", "X-No-Cache": "true" },
    signal: withRequestTimeout(signal, DEFAULT_TIMEOUT_MS),
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  let content: string;
  try {
    const buffer = await readResponseWithLimit(
      response,
      MAX_HTML_BYTES,
      signal,
    );
    content = new TextDecoder().decode(buffer);
  } catch (error) {
    if (!(error instanceof ResponseTooLargeError)) throw error;
    return {
      url,
      title: "",
      content: "",
      error: "Jina response exceeds 5 MB",
      errorCode: "CONTENT_TOO_LARGE",
    };
  }
  if (content.trim().length < MIN_USEFUL_CONTENT) return null;
  const title =
    content.match(/^#{1,2}\s+(.+)$/m)?.[1]?.trim() || new URL(url).hostname;
  return { url, title, content, error: null };
}

function textTitle(text: string, url: string): string {
  return (
    text
      .match(/^#{1,2}\s+(.+)$/m)?.[1]
      ?.replace(/\*+/g, "")
      .trim() ||
    new URL(url).pathname.split("/").filter(Boolean).pop() ||
    url
  );
}

async function extractViaHttp(
  url: string,
  signal: AbortSignal | undefined,
  options: ExtractOptions,
): Promise<ExtractedContent> {
  const timeout = AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    const response = await fetchRemoteUrl(
      url,
      {
        signal: requestSignal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/122 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/pdf,text/plain,application/json,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
      },
      { lookup: options.lookup, fetch: options.fetch },
    );
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      const errorCode =
        response.status === 401 || response.status === 403
          ? "FETCH_BLOCKED"
          : response.status === 429
            ? "RATE_LIMITED"
            : response.status === 408 || response.status === 504
              ? "REQUEST_TIMEOUT"
              : undefined;
      return {
        url,
        title: "",
        content: "",
        error: `HTTP ${response.status}: ${response.statusText}`,
        errorCode,
      };
    }
    const contentType = response.headers.get("content-type") || "";
    const pdf = isPDF(url, contentType);
    const maxBytes = pdf ? MAX_PDF_BYTES : MAX_HTML_BYTES;
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > maxBytes) {
      await response.body?.cancel().catch(() => undefined);
      return {
        url,
        title: "",
        content: "",
        error: `Response too large (${Math.round(contentLength / 1024 / 1024)} MB)`,
        errorCode: "CONTENT_TOO_LARGE",
      };
    }
    if (pdf) {
      try {
        const buffer = await readResponseWithLimit(
          response,
          MAX_PDF_BYTES,
          requestSignal,
        );
        const result = await extractPDFToMarkdown(buffer, url);
        return {
          url,
          title: result.title,
          content: result.content,
          error: null,
        };
      } catch (error) {
        if (!(error instanceof ResponseTooLargeError)) throw error;
        return {
          url,
          title: "",
          content: "",
          error: "PDF exceeds 20 MB",
          errorCode: "CONTENT_TOO_LARGE",
        };
      }
    }
    if (
      /^(image|audio|video)\//.test(contentType) ||
      contentType.includes("application/zip")
    ) {
      await response.body?.cancel().catch(() => undefined);
      return {
        url,
        title: "",
        content: "",
        error: `Unsupported content type: ${contentType.split(";")[0]}`,
        errorCode: "UNSUPPORTED_CONTENT",
      };
    }
    let text: string;
    try {
      const buffer = await readResponseWithLimit(
        response,
        MAX_HTML_BYTES,
        requestSignal,
      );
      text = new TextDecoder().decode(buffer);
    } catch (error) {
      if (!(error instanceof ResponseTooLargeError)) throw error;
      return {
        url,
        title: "",
        content: "",
        error: "Response exceeds 5 MB",
        errorCode: "CONTENT_TOO_LARGE",
      };
    }
    const isHtml =
      contentType.includes("text/html") ||
      contentType.includes("application/xhtml+xml");
    if (!isHtml)
      return { url, title: textTitle(text, url), content: text, error: null };

    const { document } = parseHTML(text);
    // linkedom provides the DOM surface Readability uses at runtime, but its
    // Document declaration is intentionally separate from lib.dom's type.
    const article = new Readability(document as unknown as Document).parse();
    if (article?.content) {
      const content = turndown.turndown(article.content);
      if (content.length >= MIN_USEFUL_CONTENT) {
        return { url, title: article.title || "", content, error: null };
      }
    }
    const rsc = extractRSCContent(text);
    if (rsc?.content && rsc.content.length >= MIN_USEFUL_CONTENT) {
      return { url, title: rsc.title, content: rsc.content, error: null };
    }
    return {
      url,
      title: article?.title || "",
      content: article?.content ? turndown.turndown(article.content) : "",
      error: "Could not extract complete readable content",
    };
  } catch (error) {
    if (signal?.aborted) return aborted(url);
    const message = errorMessage(error);
    const normalized = message.toLowerCase();
    if (
      (error instanceof Error && error.name === "TimeoutError") ||
      normalized.includes("timeout") ||
      normalized.includes("abort")
    ) {
      return {
        url,
        title: "",
        content: "",
        error: "Request timed out",
        errorCode: "REQUEST_TIMEOUT",
      };
    }
    return {
      url,
      title: "",
      content: "",
      error: message,
      errorCode: /blocked|internal address/i.test(message)
        ? "FETCH_BLOCKED"
        : undefined,
    };
  }
}

export async function extractContent(
  url: string,
  signal: AbortSignal | undefined,
  options: ExtractOptions,
): Promise<ExtractedContent> {
  if (signal?.aborted) return aborted(url);
  if (isYouTubeUrl(url)) {
    return {
      url,
      title: "",
      content: "",
      error: "YouTube extraction is not available in this release",
      errorCode: "UNSUPPORTED_CONTENT",
    };
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {
      url,
      title: "",
      content: "",
      error: "Invalid URL",
      errorCode: "UNSUPPORTED_CONTENT",
    };
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return {
      url,
      title: "",
      content: "",
      error: "Only HTTP and HTTPS URLs are supported",
      errorCode: "UNSUPPORTED_CONTENT",
    };
  }
  try {
    await validateRemoteUrl(parsed, { lookup: options.lookup });
  } catch (error) {
    return {
      url,
      title: "",
      content: "",
      error: errorMessage(error),
      errorCode: "FETCH_BLOCKED",
    };
  }

  try {
    const github = await extractGitHub(url, signal, {
      forceClone: options.forceClone,
      tempDir: options.tempDir,
    });
    if (github) return github;
  } catch {
    if (signal?.aborted) return aborted(url);
    // Continue with the public page when GitHub API or clone access fails.
  }

  const primary = await extractViaHttp(url, signal, options);
  if (
    !primary.error ||
    primary.errorCode === "CONTENT_TOO_LARGE" ||
    primary.errorCode === "UNSUPPORTED_CONTENT"
  ) {
    return primary;
  }
  if (signal?.aborted) return aborted(url);

  try {
    const jina = await extractWithJina(url, signal);
    if (jina) return jina;
  } catch {
    if (signal?.aborted) return aborted(url);
    // Continue through configured API fallbacks.
  }
  if (options.runtime.parallelApiKey) {
    try {
      const parallel = await extractWithParallel(
        url,
        signal,
        options.runtime.parallelApiKey,
      );
      if (parallel) return parallel;
    } catch {
      if (signal?.aborted) return aborted(url);
      // Continue to Gemini URL Context.
    }
  }
  if (options.runtime.gemini) {
    try {
      const gemini = await extractWithUrlContext(
        url,
        signal,
        options.runtime.gemini,
      );
      if (gemini) return gemini;
    } catch {
      if (signal?.aborted) return aborted(url);
      // Return the primary extraction error below.
    }
  }
  return primary;
}

export async function fetchAllContent(
  urls: string[],
  signal: AbortSignal | undefined,
  options: ExtractOptions,
): Promise<ExtractedContent[]> {
  return Promise.all(
    urls.map((url) => fetchLimit(() => extractContent(url, signal, options))),
  );
}
