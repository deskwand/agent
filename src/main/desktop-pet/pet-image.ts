import { nativeImage } from "electron";
import { statSync } from "node:fs";
import {
  mkdir,
  readFile,
  stat,
  unlink,
  writeFile as writeFileImpl,
} from "node:fs/promises";
import { join } from "node:path";
import { isSafePetImageFileName } from "../../shared/pet-appearance";

export const PET_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const PET_IMAGE_MAX_EDGE = 216;
/** 导入前的像素上限：避免 nativeImage 在主进程里解码超大静态图。 */
export const PET_IMAGE_MAX_SOURCE_EDGE = 8192;

export type PetImageFormat = "png" | "jpg" | "gif" | "webp";
export type PetImageErrorCode = "invalid" | "too-large" | "write-failed";

export class PetImageError extends Error {
  constructor(readonly code: PetImageErrorCode) {
    super(code);
    this.name = "PetImageError";
  }
}

export const PET_IMAGE_ERROR_KEYS: Record<PetImageErrorCode, string> = {
  invalid: "pet.imageInvalid",
  "too-large": "pet.imageTooLarge",
  "write-failed": "pet.imageWriteFailed",
};

const MIME: Record<PetImageFormat, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

export function detectPetImageFormat(buffer: Buffer): PetImageFormat | null {
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "png";
  }
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return "jpg";
  }
  if (buffer.length >= 6) {
    const head = buffer.subarray(0, 6).toString("ascii");
    if (head === "GIF87a" || head === "GIF89a") return "gif";
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "webp";
  }
  return null;
}

export function petImageDataUrl(
  buffer: Buffer,
  format: PetImageFormat,
): string {
  return `data:${MIME[format]};base64,${buffer.toString("base64")}`;
}

/**
 * 从文件头读静态图尺寸：
 * - PNG：IHDR 的宽高在偏移 16 / 20（大端 32 位）。
 * - JPEG：扫到 SOF 段，高在 length 字段后第 3 字节，宽在第 5 字节。
 * GIF/WebP 不在主进程解码，返回 null（不参与像素预检）。
 */
export function readPetImageSize(
  buffer: Buffer,
  format: PetImageFormat,
): { width: number; height: number } | null {
  if (format === "png") {
    if (buffer.length < 24) return null;
    if (buffer.subarray(12, 16).toString("ascii") !== "IHDR") return null;
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    return width > 0 && height > 0 ? { width, height } : null;
  }
  if (format !== "jpg") return null;

  let offset = 2;
  while (offset + 3 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    if (buffer[offset + 1] === 0xff) {
      // 填充字节：跳过第一个 FF，让下一个 FF 作为标记前缀。
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    offset += 2;
    // SOS 之后的字节是熵编码数据，不再有段长度可读；找不到 SOF 就停。
    if (marker === 0xda) return null;
    if (
      marker === 0xd8 ||
      marker === 0xd9 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      continue;
    }
    if (offset + 2 > buffer.length) return null;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) return null;
    const isSof =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (isSof) {
      if (length < 7) return null;
      const height = buffer.readUInt16BE(offset + 3);
      const width = buffer.readUInt16BE(offset + 5);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    offset += length;
  }
  return null;
}

/** 只依赖 nativeImage 的这几个方法，测试可以注入假实现。 */
interface StaticImage {
  isEmpty(): boolean;
  getSize(): { width: number; height: number };
  resize(options: { width?: number; height?: number; quality?: "best" }): {
    toPNG(): Buffer;
  };
  toPNG(): Buffer;
}

interface StaticImageApi {
  createFromBuffer(buffer: Buffer): StaticImage;
}

export function normalizeStaticImage(
  buffer: Buffer,
  format: PetImageFormat,
  imageApi: StaticImageApi = nativeImage,
): Buffer {
  if (format !== "png" && format !== "jpg") return buffer;
  const image = imageApi.createFromBuffer(buffer);
  if (image.isEmpty()) throw new PetImageError("invalid");
  const { width, height } = image.getSize();
  if (!width || !height) throw new PetImageError("invalid");
  const resized =
    Math.max(width, height) > PET_IMAGE_MAX_EDGE
      ? width >= height
        ? image.resize({ width: PET_IMAGE_MAX_EDGE, quality: "best" })
        : image.resize({ height: PET_IMAGE_MAX_EDGE, quality: "best" })
      : image;
  // 即使不缩放也重编码：统一成 PNG，并顺带丢掉 EXIF/GPS。
  return resized.toPNG();
}

export interface PetImageStore {
  choose(sourcePath: string): Promise<{ fileName: string }>;
  read(fileName: string): Promise<string | null>;
  remove(fileName: string): Promise<void>;
  has(fileName: string): boolean;
}

export function createPetImageStore({
  dir,
  now = Date.now,
  normalize = normalizeStaticImage,
  writeFile = writeFileImpl,
}: {
  dir: string;
  now?: () => number;
  normalize?: (buffer: Buffer, format: PetImageFormat) => Buffer;
  /** 仅测试注入：模拟写到一半就失败的情况。 */
  writeFile?: typeof writeFileImpl;
}): PetImageStore {
  const pathOf = (fileName: string) => join(dir, fileName);

  return {
    async choose(sourcePath) {
      let size: number;
      try {
        size = (await stat(sourcePath)).size;
      } catch {
        throw new PetImageError("invalid");
      }
      if (size === 0) throw new PetImageError("invalid");
      if (size > PET_IMAGE_MAX_BYTES) throw new PetImageError("too-large");

      let source: Buffer;
      try {
        source = await readFile(sourcePath);
      } catch {
        throw new PetImageError("invalid");
      }
      if (source.length > PET_IMAGE_MAX_BYTES) {
        throw new PetImageError("too-large");
      }

      const format = detectPetImageFormat(source);
      if (!format) throw new PetImageError("invalid");

      // 先按文件头拒绝超大静态图，再交给 nativeImage 解码。
      if (format === "png" || format === "jpg") {
        const dimensions = readPetImageSize(source, format);
        if (!dimensions) throw new PetImageError("invalid");
        if (
          dimensions.width > PET_IMAGE_MAX_SOURCE_EDGE ||
          dimensions.height > PET_IMAGE_MAX_SOURCE_EDGE
        ) {
          throw new PetImageError("too-large");
        }
      }

      let stored = source;
      if (format === "png" || format === "jpg") {
        try {
          stored = normalize(source, format);
        } catch (error) {
          throw error instanceof PetImageError
            ? error
            : new PetImageError("invalid");
        }
        if (stored.length === 0) throw new PetImageError("invalid");
      }

      // 静态 PNG/JPEG 统一存成 PNG；GIF/WebP 保留原格式以保住动画。
      const extension = format === "png" || format === "jpg" ? "png" : format;
      try {
        await mkdir(dir, { recursive: true });
      } catch {
        throw new PetImageError("write-failed");
      }

      const stamp = now();
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const fileName =
          attempt === 0
            ? `custom-${stamp}.${extension}`
            : `custom-${stamp}-${attempt}.${extension}`;
        try {
          await writeFile(pathOf(fileName), stored, { flag: "wx" });
          return { fileName };
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
            // writeFile 不是原子的：失败时可能已经留下半个文件。
            await unlink(pathOf(fileName)).catch(() => {});
            throw new PetImageError("write-failed");
          }
        }
      }
      throw new PetImageError("write-failed");
    },

    async read(fileName) {
      if (!isSafePetImageFileName(fileName)) return null;
      const path = pathOf(fileName);
      try {
        const info = await stat(path);
        if (info.size === 0 || info.size > PET_IMAGE_MAX_BYTES) return null;
        const buffer = await readFile(path);
        if (buffer.length === 0 || buffer.length > PET_IMAGE_MAX_BYTES) {
          return null;
        }
        const format = detectPetImageFormat(buffer);
        if (!format) return null;
        // 只读路径也守住像素上限：手工放进 userData 的超大图不能送到渲染层。
        if (format === "png" || format === "jpg") {
          const dimensions = readPetImageSize(buffer, format);
          if (
            !dimensions ||
            dimensions.width > PET_IMAGE_MAX_SOURCE_EDGE ||
            dimensions.height > PET_IMAGE_MAX_SOURCE_EDGE
          ) {
            return null;
          }
        }
        return petImageDataUrl(buffer, format);
      } catch {
        return null;
      }
    },

    async remove(fileName) {
      if (!isSafePetImageFileName(fileName)) return;
      try {
        await unlink(pathOf(fileName));
      } catch {
        // 文件是缓存性质；删不掉（已丢失/被占用）不影响配置。
      }
    },

    has(fileName) {
      if (!isSafePetImageFileName(fileName)) return false;
      try {
        return statSync(pathOf(fileName)).isFile();
      } catch {
        return false;
      }
    },
  };
}
