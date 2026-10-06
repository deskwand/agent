/**
 * @module main/feed/feed-image-protocol
 *
 * 为什么要有这一层：CSP 是 img-src 'self' data: blob:，
 * 渲染层加载不了远程图，也读不了 userData 下的文件路径。
 * 所以配图必须由主进程通过一个自定义 scheme 提供（设计 §8.9）。
 *
 * 与 video-protocol.ts 的关系：只照抄它的注册/服务模式，**不复用它的 scheme**
 * —— 那个 handler 用 isKnownVideoFile 做安全校验，为了服务图片去筛松它不划算。
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { Readable } from "node:stream";
import { protocol } from "electron";

export const FEED_IMAGE_PROTOCOL_SCHEME = "deskwand-feed-image";

const ALLOWED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);
const SAFE_FILE_NAME = /^[a-f0-9]{40}\.(jpg|jpeg|png|webp|gif)$/;

const MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

/** 必须在 app ready 之前调用，否则 scheme 不会被当成标准协议。 */
export function registerFeedImageProtocolScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: FEED_IMAGE_PROTOCOL_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true },
    },
  ]);
}

export function buildFeedImageUrl(fileName: string): string {
  return `${FEED_IMAGE_PROTOCOL_SCHEME}://local/${encodeURIComponent(fileName)}`;
}

/**
 * 文件名 → 绝对路径。**任何越界一律返回 null**：
 * 文件名必须完全匹配 sha1 + 白名单扩展名，所以 `../`、子目录、任意扩展名都进不来。
 */
export function resolveFeedImagePath(
  dir: string,
  fileName: string,
): string | null {
  if (!SAFE_FILE_NAME.test(fileName)) return null;
  const extension = extname(fileName).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) return null;
  const base = normalize(dir);
  const resolved = normalize(join(base, fileName));
  if (!resolved.startsWith(`${base}/`)) return null;
  return resolved;
}

export async function installFeedImageProtocol(dir: string): Promise<void> {
  await protocol.handle(FEED_IMAGE_PROTOCOL_SCHEME, async (request) => {
    const fileName = decodeURIComponent(
      new URL(request.url).pathname.replace(/^\//, ""),
    );
    const filePath = resolveFeedImagePath(dir, fileName);
    if (!filePath) return new Response("Not found", { status: 404 });

    let size: number;
    try {
      size = (await stat(filePath)).size;
    } catch {
      return new Response("Not found", { status: 404 });
    }

    const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream;
    return new Response(stream, {
      status: 200,
      headers: {
        "content-type":
          MIME_TYPES[extname(fileName).toLowerCase()] ??
          "application/octet-stream",
        "content-length": String(size),
        "cache-control": "no-store",
      },
    });
  });
}
