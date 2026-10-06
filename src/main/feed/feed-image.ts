/**
 * @module main/feed/feed-image
 *
 * 管线 ⑤：把入选条目的配图下载到 userData/feed-images/（设计 §6.6、§8.9）。
 *
 * 三条硬规则：
 * 1. 文件名只由 sha1(url) + 白名单扩展名拼出 —— 远程文件名一个字符都不进路径；
 * 2. 单张超过 300KB 直接丢弃（这是本功能最大的一笔磁盘开销的唯一闸门）；
 * 3. 任何失败都只返回 null，让调用方把 image_status 记成 failed。
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { logWarn } from "../utils/logger";

export const IMAGE_MAX_BYTES = 300 * 1024;

const CONTENT_TYPE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export type FeedImageDownloader = (
  url: string,
) => Promise<{ bytes: Uint8Array; contentType: string } | null>;

export function extensionForContentType(contentType: string): string | null {
  const base = contentType.split(";")[0].trim().toLowerCase();
  return CONTENT_TYPE_EXTENSIONS[base] ?? null;
}

export function imageFileName(url: string, contentType: string): string | null {
  const extension = extensionForContentType(contentType);
  if (!extension) return null;
  const hash = createHash("sha1").update(url, "utf8").digest("hex");
  return `${hash}.${extension}`;
}

export async function downloadFeedImage(input: {
  url: string;
  dir: string;
  download: FeedImageDownloader;
}): Promise<{ fileName: string } | null> {
  try {
    const response = await input.download(input.url);
    if (!response) return null;
    if (response.bytes.byteLength > IMAGE_MAX_BYTES) {
      logWarn("[feed] image too large, dropped:", input.url);
      return null;
    }
    const fileName = imageFileName(input.url, response.contentType);
    if (!fileName) return null;

    await mkdir(input.dir, { recursive: true });
    const target = join(input.dir, fileName);
    // 先写临时名再改名：避免崩溃留下半个文件被下次启动的孤儿扫描误判
    const temp = `${target}.tmp`;
    await writeFile(temp, response.bytes);
    await rename(temp, target);
    return { fileName };
  } catch (error) {
    logWarn("[feed] image download failed:", input.url, error);
    return null;
  }
}

/** 启动时清掉库里已无引用的图（中途崩溃、写入一半的）。 */
export async function pruneOrphanImages(input: {
  dir: string;
  referenced: Set<string>;
}): Promise<number> {
  let entries: string[];
  try {
    entries = await readdir(input.dir);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const entry of entries) {
    if (input.referenced.has(entry)) continue;
    try {
      await unlink(join(input.dir, entry));
      removed += 1;
    } catch (error) {
      logWarn("[feed] failed to remove orphan image:", entry, error);
    }
  }
  return removed;
}
