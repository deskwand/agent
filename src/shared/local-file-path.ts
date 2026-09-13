const windowsDrivePathPattern = /^[A-Za-z]:[\\/]/;
const uncPathPattern = /^\\\\[^\\]/;

export function decodePathSafely(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function isWindowsDrivePath(value: string): boolean {
  return windowsDrivePathPattern.test(value);
}

export function isUncPath(value: string): boolean {
  return uncPathPattern.test(value);
}

function detectPlatform(platform?: NodeJS.Platform): NodeJS.Platform {
  return (
    platform ?? (typeof process !== "undefined" ? process.platform : "linux")
  );
}

export function localPathFromFileUrl(
  fileUrl: string,
  platform?: NodeJS.Platform,
): string | null {
  if (!fileUrl || !fileUrl.startsWith("file://")) {
    return null;
  }

  const isWindows = detectPlatform(platform) === "win32";

  try {
    const url = new URL(fileUrl);
    const pathname = decodePathSafely(url.pathname || "");
    const hostname = decodePathSafely(url.hostname || "");

    if (hostname && hostname.toLowerCase() !== "localhost") {
      if (isWindows) {
        const normalizedPathname = pathname.replace(/\//g, "\\");
        return `\\\\${hostname}${normalizedPathname}`;
      }
      return `//${hostname}${pathname}`;
    }

    if (!pathname) {
      return null;
    }

    if (/^\/[A-Za-z]:\//.test(pathname)) {
      return pathname.slice(1);
    }

    return pathname;
  } catch {
    const fallback = decodePathSafely(fileUrl.replace(/^file:\/\//i, ""));
    if (!fallback) {
      return null;
    }

    if (fallback.toLowerCase().startsWith("localhost/")) {
      return fallback.slice("localhost".length);
    }

    if (fallback.startsWith("//")) {
      if (isWindows) {
        return `\\\\${fallback.slice(2).replace(/\//g, "\\")}`;
      }
      return fallback;
    }

    return fallback;
  }
}

export function localPathFromAppUrlPathname(
  pathname: string,
  platform?: NodeJS.Platform,
): string | null {
  const decodedPathname = decodePathSafely(pathname || "");
  if (!decodedPathname) {
    return null;
  }

  const isWindows = detectPlatform(platform) === "win32";

  if (/^\/[A-Za-z]:\//.test(decodedPathname)) {
    return decodedPathname.slice(1);
  }

  if (/^\/\/[^/]+\/.+/.test(decodedPathname)) {
    if (isWindows) {
      return `\\\\${decodedPathname.slice(2).replace(/\//g, "\\")}`;
    }
    return decodedPathname;
  }

  if (/^\/(?:Users|home|opt|tmp|var|Volumes|mnt)\//.test(decodedPathname)) {
    return decodedPathname;
  }

  return null;
}

const webLikeUrlPattern = /^(?:https?:\/\/|mailto:|file:\/\/|#)/i;

/** 去掉 href 里混入的换行与首尾空白（从 markdown 摘出的路径常带这些）。 */
export function normalizePathCandidate(value: string): string {
  return value.replace(/\r/g, "").replace(/\n+/g, "").trim();
}

function encodeFilePath(pathValue: string): string {
  return encodeURI(pathValue).replace(/#/g, "%23").replace(/\?/g, "%3F");
}

/**
 * 本地绝对路径 → file:// URL。
 * 非本地路径（http/mailto/#/已是 file://）与空串返回 null。
 * 这是渲染进程唯一可用的实现（沙盒里没有 node 的 url.pathToFileURL）。
 */
export function toFileUrl(pathValue: string): string | null {
  const normalizedPathValue = normalizePathCandidate(pathValue);
  if (!normalizedPathValue) {
    return null;
  }

  if (webLikeUrlPattern.test(normalizedPathValue)) {
    return null;
  }

  if (normalizedPathValue.startsWith("/")) {
    return `file://${encodeFilePath(normalizedPathValue)}`;
  }

  if (isWindowsDrivePath(normalizedPathValue)) {
    const normalized = normalizedPathValue.replace(/\\/g, "/");
    return `file:///${encodeFilePath(normalized)}`;
  }

  if (isUncPath(normalizedPathValue)) {
    const normalized = normalizedPathValue
      .replace(/^\\\\+/, "")
      .replace(/\\/g, "/");
    return `file://${encodeFilePath(normalized)}`;
  }

  return null;
}
