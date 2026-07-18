/**
 * Adapted from nicobailon/pi-web-access v0.13.0 (commit 7bdc30a), MIT License.
 */
import {
  MAX_WEB_ACCESS_URL_LENGTH,
  MAX_WEB_ACCESS_URLS,
} from "../../../../shared/web-access";

export interface FetchContentParams {
  url?: unknown;
  urls?: unknown;
  forceClone?: unknown;
}

export interface NormalizedFetchContentParams {
  urlList: string[];
  options: { forceClone?: boolean };
}

function normalizeUrls(value: unknown, limit = MAX_WEB_ACCESS_URLS): string[] {
  if (limit <= 0) return [];
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized && normalized.length <= MAX_WEB_ACCESS_URL_LENGTH
      ? [normalized]
      : [];
  }
  if (!Array.isArray(value)) return [];
  const urls: string[] = [];
  for (const entry of value) {
    urls.push(...normalizeUrls(entry, limit - urls.length));
    if (urls.length >= limit) break;
  }
  return urls;
}

export function normalizeFetchContentParams(
  params: FetchContentParams,
): NormalizedFetchContentParams {
  const urls = normalizeUrls(params.urls);
  const selected = urls.length > 0 ? urls : normalizeUrls(params.url);
  const urlList = Array.from(new Set(selected)).slice(0, MAX_WEB_ACCESS_URLS);
  const options =
    typeof params.forceClone === "boolean"
      ? { forceClone: params.forceClone }
      : {};
  return { urlList, options };
}
