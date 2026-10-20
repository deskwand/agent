import { mkdtemp, readFile, rm, truncate, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PET_IMAGE_ERROR_KEYS,
  PET_IMAGE_MAX_BYTES,
  PET_IMAGE_MAX_SOURCE_EDGE,
  PetImageError,
  createPetImageStore,
  detectPetImageFormat,
  normalizeStaticImage,
  petImageDataUrl,
  readPetImageSize,
  type PetImageFormat,
} from "../../main/desktop-pet/pet-image";

function pngHeader(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write("IHDR", 12, "ascii");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

function jpegHeader(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(21);
  buffer[0] = 0xff;
  buffer[1] = 0xd8;
  buffer[2] = 0xff;
  buffer[3] = 0xc0;
  buffer.writeUInt16BE(17, 4);
  buffer[6] = 8;
  buffer.writeUInt16BE(height, 7);
  buffer.writeUInt16BE(width, 9);
  buffer[11] = 3;
  return buffer;
}

const PNG = pngHeader(10, 10);
const JPEG = jpegHeader(20, 10);
const REAL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAYAAACddGYaAAAAEUlEQVR4nGP4n6LxH4YZkDkAxtoPPWgYDl8AAAAASUVORK5CYII=",
  "base64",
);
const REAL_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAA6ADAAQAAAABAAAAAgAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAAgADAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgKCgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8PD//bAEMBAgICBAQEBwQEBxALCQsQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEP/dAAQAAf/aAAwDAQACEQMRAD8A7Ciiiv4fP9SD/9k=",
  "base64",
);
const GIF = Buffer.from("GIF89a----", "ascii");
const WEBP = Buffer.concat([
  Buffer.from("RIFF", "ascii"),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from("WEBP", "ascii"),
]);

let dir = "";
let sourceDir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pet-images-"));
  sourceDir = await mkdtemp(join(tmpdir(), "pet-source-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  await rm(sourceDir, { recursive: true, force: true });
});

async function source(name: string, bytes: Buffer): Promise<string> {
  const path = join(sourceDir, name);
  await writeFile(path, bytes);
  return path;
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ name: "PetImageError", code });
}

describe("detectPetImageFormat", () => {
  it.each([
    ["png", PNG],
    ["jpg", JPEG],
    ["gif", GIF],
    ["webp", WEBP],
  ] as Array<[PetImageFormat, Buffer]>)(
    "detects %s from its header",
    (format, bytes) => {
      expect(detectPetImageFormat(bytes)).toBe(format);
    },
  );

  it("rejects a text file even with an image extension", () => {
    expect(detectPetImageFormat(Buffer.from("hello"))).toBeNull();
  });
});

describe("petImageDataUrl", () => {
  it("uses the MIME type of the detected format", () => {
    expect(petImageDataUrl(PNG, "png")).toBe(
      `data:image/png;base64,${PNG.toString("base64")}`,
    );
    expect(petImageDataUrl(GIF, "gif")).toContain("data:image/gif;base64,");
    expect(petImageDataUrl(WEBP, "webp")).toContain("data:image/webp;base64,");
  });
});

describe("readPetImageSize", () => {
  it("reads the PNG IHDR dimensions", () => {
    expect(readPetImageSize(PNG, "png")).toEqual({ width: 10, height: 10 });
  });

  it("reads the JPEG SOF dimensions", () => {
    expect(readPetImageSize(JPEG, "jpg")).toEqual({ width: 20, height: 10 });
  });

  it("skips JPEG segments before SOF", () => {
    const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]);
    const jpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      app0,
      JPEG.subarray(2),
    ]);
    expect(readPetImageSize(jpeg, "jpg")).toEqual({ width: 20, height: 10 });
  });

  it("returns null for a malformed header", () => {
    expect(readPetImageSize(Buffer.from("hello"), "png")).toBeNull();
    expect(readPetImageSize(Buffer.from([0xff, 0xd8, 0xff]), "jpg")).toBeNull();
  });

  it("stops scanning at SOS instead of reading entropy bytes", () => {
    const buffer = Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      Buffer.from([0xff, 0xda, 0x00, 0x04, 0x00, 0x00]),
    ]);
    expect(readPetImageSize(buffer, "jpg")).toBeNull();
  });

  it("reads a real PNG produced by an encoder", () => {
    expect(detectPetImageFormat(REAL_PNG)).toBe("png");
    expect(readPetImageSize(REAL_PNG, "png")).toEqual({ width: 3, height: 2 });
  });

  it("reads a real JPEG with EXIF/ICC segments before SOF", () => {
    expect(detectPetImageFormat(REAL_JPEG)).toBe("jpg");
    expect(readPetImageSize(REAL_JPEG, "jpg")).toEqual({ width: 3, height: 2 });
  });
});

describe("normalizeStaticImage", () => {
  function fakeImage(width: number, height: number, tag: string) {
    return {
      isEmpty: () => false,
      getSize: () => ({ width, height }),
      resize: (options: { width?: number; height?: number }) => ({
        toPNG: () => Buffer.from(`${tag}:${JSON.stringify(options)}`),
      }),
      toPNG: () => Buffer.from(tag),
    };
  }

  it("resizes landscape images by width", () => {
    const api = { createFromBuffer: () => fakeImage(800, 400, "plain") };
    expect(normalizeStaticImage(PNG, "png", api).toString()).toBe(
      'plain:{"width":216,"quality":"best"}',
    );
  });

  it("resizes portrait images by height", () => {
    const api = { createFromBuffer: () => fakeImage(400, 800, "plain") };
    expect(normalizeStaticImage(PNG, "png", api).toString()).toBe(
      'plain:{"height":216,"quality":"best"}',
    );
  });

  it("re-encodes small images without resizing", () => {
    const api = { createFromBuffer: () => fakeImage(100, 100, "plain") };
    expect(normalizeStaticImage(PNG, "png", api).toString()).toBe("plain");
  });

  it("rejects an empty decode", () => {
    const api = {
      createFromBuffer: () => ({
        ...fakeImage(10, 10, "x"),
        isEmpty: () => true,
      }),
    };
    expect(() => normalizeStaticImage(PNG, "png", api)).toThrow(PetImageError);
  });

  it("passes GIF/WebP through without decoding", () => {
    const api = { createFromBuffer: vi.fn() };
    expect(normalizeStaticImage(GIF, "gif", api)).toBe(GIF);
    expect(api.createFromBuffer).not.toHaveBeenCalled();
  });
});

describe("createPetImageStore", () => {
  it("normalizes PNG/JPEG and stores the result as .png", async () => {
    const normalize = vi.fn(() => Buffer.from("normalized"));
    const store = createPetImageStore({ dir, now: () => 123, normalize });
    const { fileName } = await store.choose(await source("cat.png", PNG));
    expect(fileName).toBe("custom-123.png");
    expect(normalize).toHaveBeenCalledWith(PNG, "png");
    expect(await readFile(join(dir, fileName))).toEqual(
      Buffer.from("normalized"),
    );

    const jpeg = await store.choose(await source("cat.jpg", JPEG));
    expect(jpeg.fileName).toBe("custom-123-1.png");
    expect(normalize).toHaveBeenCalledWith(JPEG, "jpg");
  });

  it("keeps GIF/WebP bytes untouched so animation survives", async () => {
    const normalize = vi.fn(() => Buffer.from("nope"));
    const store = createPetImageStore({ dir, now: () => 7, normalize });
    const gif = await store.choose(await source("cat.gif", GIF));
    expect(gif.fileName).toBe("custom-7.gif");
    expect(await readFile(join(dir, gif.fileName))).toEqual(GIF);

    const webp = await store.choose(await source("cat.webp", WEBP));
    expect(webp.fileName).toBe("custom-7.webp");
    expect(normalize).not.toHaveBeenCalled();
  });

  it("rejects files over 10MB before reading them", async () => {
    const path = await source("big.png", Buffer.from("x"));
    await truncate(path, PET_IMAGE_MAX_BYTES + 1);
    const store = createPetImageStore({ dir });
    await expectCode(store.choose(path), "too-large");
  });

  it("rejects a static image over 8192px before decoding it", async () => {
    const store = createPetImageStore({ dir, normalize: () => PNG });
    await expectCode(
      store.choose(await source("huge.png", pngHeader(9000, 10))),
      "too-large",
    );
    await expectCode(
      store.choose(await source("huge.jpg", jpegHeader(10, 9000))),
      "too-large",
    );
    expect(PET_IMAGE_MAX_SOURCE_EDGE).toBe(8192);
  });

  it("rejects an empty file and a fake extension", async () => {
    const store = createPetImageStore({ dir });
    await expectCode(
      store.choose(await source("empty.png", Buffer.alloc(0))),
      "invalid",
    );
    await expectCode(
      store.choose(await source("note.png", Buffer.from("hello"))),
      "invalid",
    );
  });

  it("rejects a corrupt static image reported by the normalizer", async () => {
    const store = createPetImageStore({
      dir,
      normalize: () => {
        throw new Error("decode failed");
      },
    });
    await expectCode(store.choose(await source("bad.png", PNG)), "invalid");
  });

  it("removes a partially written file when the write fails", async () => {
    const partialWrite = vi.fn(async (path: string, data: Buffer) => {
      await writeFile(path, data.subarray(0, 1));
      throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
    });
    const store = createPetImageStore({
      dir,
      now: () => 5,
      normalize: () => PNG,
      writeFile: partialWrite as unknown as typeof writeFile,
    });
    await expectCode(
      store.choose(await source("cat.png", PNG)),
      "write-failed",
    );
    expect(existsSync(join(dir, "custom-5.png"))).toBe(false);
  });

  it("reports a write failure without leaving a file", async () => {
    const blocker = join(sourceDir, "not-a-dir");
    await writeFile(blocker, "x");
    const store = createPetImageStore({
      dir: blocker,
      normalize: () => PNG,
    });
    await expectCode(
      store.choose(await source("cat.png", PNG)),
      "write-failed",
    );
  });

  it("adds a suffix when the timestamp name already exists", async () => {
    const normalize = () => PNG;
    const store = createPetImageStore({ dir, now: () => 42, normalize });
    const first = await store.choose(await source("a.png", PNG));
    const second = await store.choose(await source("b.png", PNG));
    expect(first.fileName).toBe("custom-42.png");
    expect(second.fileName).toBe("custom-42-1.png");
  });

  it("reads a stored image as a data URL and reports missing files", async () => {
    const store = createPetImageStore({ dir });
    await writeFile(join(dir, "custom-1.png"), PNG);
    await expect(store.read("custom-1.png")).resolves.toBe(
      `data:image/png;base64,${PNG.toString("base64")}`,
    );
    await expect(store.read("custom-2.png")).resolves.toBeNull();
    await expect(store.read("../custom-1.png")).resolves.toBeNull();
  });

  it("rejects an oversized stored file", async () => {
    const store = createPetImageStore({ dir });
    const path = join(dir, "custom-1.png");
    await writeFile(path, PNG);
    await truncate(path, PET_IMAGE_MAX_BYTES + 1);
    await expect(store.read("custom-1.png")).resolves.toBeNull();
  });

  it("rejects a stored static image over the pixel guard", async () => {
    const store = createPetImageStore({ dir });
    await writeFile(join(dir, "custom-1.png"), pngHeader(9000, 10));
    await expect(store.read("custom-1.png")).resolves.toBeNull();
  });

  it("has/remove only touch safe file names", async () => {
    const store = createPetImageStore({ dir });
    await writeFile(join(dir, "custom-1.png"), PNG);
    expect(store.has("custom-1.png")).toBe(true);
    expect(store.has("../custom-1.png")).toBe(false);
    expect(store.has("custom-2.png")).toBe(false);

    await store.remove("custom-1.png");
    expect(existsSync(join(dir, "custom-1.png"))).toBe(false);
    await store.remove("../custom-1.png");
  });
});

describe("PET_IMAGE_ERROR_KEYS", () => {
  it("maps every error code to an i18n key", () => {
    expect(PET_IMAGE_ERROR_KEYS).toEqual({
      invalid: "pet.imageInvalid",
      "too-large": "pet.imageTooLarge",
      "write-failed": "pet.imageWriteFailed",
    });
  });
});
