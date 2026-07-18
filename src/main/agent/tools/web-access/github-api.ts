/** Adapted from nicobailon/pi-web-access v0.13.0 (commit 7bdc30a), MIT License. */

import { withRequestTimeout } from "./types";

const GITHUB_API = "https://api.github.com";
const MAX_GITHUB_API_BYTES = 5 * 1024 * 1024;

async function readLimitedText(response: Response): Promise<string | null> {
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > MAX_GITHUB_API_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_GITHUB_API_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
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

export async function fetchGitHubApi<T>(
  path: string,
  signal?: AbortSignal,
  accept = "application/vnd.github+json",
): Promise<T | null> {
  const response = await fetch(`${GITHUB_API}${path}`, {
    headers: {
      Accept: accept,
      "User-Agent": "DeskWand-Web-Access",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: withRequestTimeout(signal, 30_000),
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  const text = await readLimitedText(response);
  if (text === null) return null;
  if (accept === "application/vnd.github.raw+json") return text as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
