import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  IMAGE_MAX_BYTES,
  downloadFeedImage,
  extensionForContentType,
  imageFileName,
  pruneOrphanImages,
} from "../../main/feed/feed-image";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "feed-image-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("extensionForContentType", () => {
  it("只认白名单里的图片类型", () => {
    expect(extensionForContentType("image/jpeg")).toBe("jpg");
    expect(extensionForContentType("image/png; charset=binary")).toBe("png");
    expect(extensionForContentType("image/webp")).toBe("webp");
    expect(extensionForContentType("text/html")).toBeNull();
    expect(extensionForContentType("image/svg+xml")).toBeNull();
  });
});

describe("imageFileName", () => {
  it("文件名只由 sha1 与扩展名拼出，与远程路径无关", () => {
    const name = imageFileName(
      "https://evil.com/../../etc/passwd.jpg",
      "image/jpeg",
    );
    expect(name).toMatch(/^[a-f0-9]{40}\.jpg$/);
  });

  it("同 URL 稳定、不同 URL 不同", () => {
    const a1 = imageFileName("https://a.com/x.jpg", "image/jpeg");
    const a2 = imageFileName("https://a.com/x.jpg", "image/jpeg");
    const b = imageFileName("https://a.com/y.jpg", "image/jpeg");
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
  });

  it("类型不在白名单时返回 null", () => {
    expect(imageFileName("https://a.com/x.svg", "image/svg+xml")).toBeNull();
  });
});

describe("downloadFeedImage", () => {
  it("正常下载写盘并返回文件名", async () => {
    const download = vi.fn().mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "image/jpeg",
    });
    const result = await downloadFeedImage({
      url: "https://a.com/x.jpg",
      dir,
      download,
    });
    expect(result?.fileName).toMatch(/\.jpg$/);
    expect(readdirSync(dir)).toEqual([result?.fileName]);
  });

  it("超过 300KB 直接丢弃，不落盘", async () => {
    const download = vi.fn().mockResolvedValue({
      bytes: new Uint8Array(IMAGE_MAX_BYTES + 1),
      contentType: "image/jpeg",
    });
    expect(
      await downloadFeedImage({ url: "https://a.com/x.jpg", dir, download }),
    ).toBeNull();
    expect(readdirSync(dir)).toEqual([]);
  });

  it("非图片类型丢弃", async () => {
    const download = vi.fn().mockResolvedValue({
      bytes: new Uint8Array([1]),
      contentType: "text/html",
    });
    expect(
      await downloadFeedImage({ url: "https://a.com/x", dir, download }),
    ).toBeNull();
    expect(readdirSync(dir)).toEqual([]);
  });

  it("下载器返回 null（超时 / 403）时返回 null 且不抛", async () => {
    const download = vi.fn().mockResolvedValue(null);
    expect(
      await downloadFeedImage({ url: "https://a.com/x.jpg", dir, download }),
    ).toBeNull();
  });

  it("下载器抛错时返回 null 且不抛", async () => {
    const download = vi.fn().mockRejectedValue(new Error("boom"));
    expect(
      await downloadFeedImage({ url: "https://a.com/x.jpg", dir, download }),
    ).toBeNull();
  });
});

describe("pruneOrphanImages", () => {
  it("删掉库里没有引用的文件，保留有引用的", async () => {
    writeFileSync(join(dir, "keep.jpg"), "x");
    writeFileSync(join(dir, "orphan.jpg"), "x");
    const removed = await pruneOrphanImages({
      dir,
      referenced: new Set(["keep.jpg"]),
    });
    expect(removed).toBe(1);
    expect(readdirSync(dir)).toEqual(["keep.jpg"]);
  });

  it("目录不存在时不抛", async () => {
    expect(
      await pruneOrphanImages({ dir: join(dir, "nope"), referenced: new Set() }),
    ).toBe(0);
  });
});
