import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { collectPromptImagesFromBlocks } from "../../main/agent/prompt-image-extract";
import type { ContentBlock } from "../../renderer/types";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "prompt-image-extract-"));
}

// Minimal PNG signature bytes — enough for detectImageMimeType (header sniff).
const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const SVG_TEXT = "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>";
const BMP_BYTES = Buffer.from([0x42, 0x4d, 0x36, 0x00, 0x00, 0x00]);
const TEXT_BYTES = Buffer.from("hello world, not an image");

describe("collectPromptImagesFromBlocks", () => {
  it("passes through inline image blocks", () => {
    const blocks: ContentBlock[] = [
      {
        type: "image",
        source: {
          type: "base64",
          media_type: "image/png",
          data: "aGVsbG8=",
        },
      },
    ];
    const images = collectPromptImagesFromBlocks(blocks, "/tmp");
    expect(images).toEqual([
      { type: "image", data: "aGVsbG8=", mimeType: "image/png" },
    ]);
  });

  it("reads image files referenced by file_attachment blocks", () => {
    const dir = makeTempDir();
    try {
      const relPath = path.join(".tmp", "shot.png");
      const absPath = path.join(dir, relPath);
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, PNG_BYTES);
      const blocks: ContentBlock[] = [
        {
          type: "file_attachment",
          filename: "shot.png",
          relativePath: relPath,
          size: PNG_BYTES.length,
        },
      ];
      const images = collectPromptImagesFromBlocks(blocks, dir);
      expect(images).toHaveLength(1);
      expect(images[0].mimeType).toBe("image/png");
      expect(images[0].data).toBe(PNG_BYTES.toString("base64"));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ignores non-image file attachments", () => {
    const dir = makeTempDir();
    try {
      const relPath = path.join(".tmp", "notes.txt");
      const absPath = path.join(dir, relPath);
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, TEXT_BYTES);
      const blocks: ContentBlock[] = [
        {
          type: "file_attachment",
          filename: "notes.txt",
          relativePath: relPath,
          size: TEXT_BYTES.length,
        },
      ];
      expect(collectPromptImagesFromBlocks(blocks, dir)).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ignores svg file attachments (not supported as image_url)", () => {
    const dir = makeTempDir();
    try {
      const relPath = path.join(".tmp", "drawing.svg");
      const absPath = path.join(dir, relPath);
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, SVG_TEXT);
      const blocks: ContentBlock[] = [
        {
          type: "file_attachment",
          filename: "drawing.svg",
          relativePath: relPath,
          size: SVG_TEXT.length,
        },
      ];
      expect(collectPromptImagesFromBlocks(blocks, dir)).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("skips image files larger than the size cap", () => {
    const dir = makeTempDir();
    try {
      const relPath = path.join(".tmp", "big.jpg");
      const absPath = path.join(dir, relPath);
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      // JPEG header + 4 bytes payload; cap forces it over the limit
      const big = Buffer.concat([JPEG_BYTES, Buffer.alloc(64)]);
      fs.writeFileSync(absPath, big);
      const blocks: ContentBlock[] = [
        {
          type: "file_attachment",
          filename: "big.jpg",
          relativePath: relPath,
          size: big.length,
        },
      ];
      expect(
        collectPromptImagesFromBlocks(blocks, dir, /* maxImageBytes */ 32),
      ).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ignores bmp file attachments (not supported as image_url)", () => {
    const dir = makeTempDir();
    try {
      const relPath = path.join(".tmp", "photo.bmp");
      const absPath = path.join(dir, relPath);
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, BMP_BYTES);
      const blocks: ContentBlock[] = [
        {
          type: "file_attachment",
          filename: "photo.bmp",
          relativePath: relPath,
          size: BMP_BYTES.length,
        },
      ];
      expect(collectPromptImagesFromBlocks(blocks, dir)).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses inlineDataBase64 when present", () => {
    const blocks: ContentBlock[] = [
      {
        type: "file_attachment",
        filename: "remote.png",
        relativePath: "remote.png",
        size: 0,
        mimeType: "image/png",
        inlineDataBase64: "aW1nZGF0YQ==",
      },
    ];
    const images = collectPromptImagesFromBlocks(blocks, "/tmp");
    expect(images).toEqual([
      { type: "image", data: "aW1nZGF0YQ==", mimeType: "image/png" },
    ]);
  });

  it("rejects unsupported inline mime types", () => {
    const blocks: ContentBlock[] = [
      {
        type: "file_attachment",
        filename: "remote.svg",
        relativePath: "remote.svg",
        size: 0,
        mimeType: "image/svg+xml",
        inlineDataBase64: "PHN2Zz48L3N2Zz4=",
      },
    ];
    expect(collectPromptImagesFromBlocks(blocks, "/tmp")).toEqual([]);
  });
});
