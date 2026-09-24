/**
 * @module main/agent/prompt-image-extract
 *
 * Extracts image content from a user message's content blocks for direct
 * multimodal sending. Two sources are supported:
 *
 * 1. Inline `image` blocks (pasted images) — passed through as-is.
 * 2. `file_attachment` blocks pointing at image files (select/drag files) —
 *    the file is read and base64-encoded so a vision-capable main model
 *    receives it directly instead of having to fall back to the
 *    vision_describe tool.
 *
 * Non-image attachments (docs, archives, svg, oversized files) are left
 * untouched — the agent keeps using Read/vision_describe for those.
 */
import * as fs from "fs";
import * as path from "path";
import type { ContentBlock } from "../../renderer/types";
import { detectImageMimeType } from "./tools/vision-describe";

export interface PromptImage {
  type: "image";
  data: string;
  mimeType: string;
}

const DEFAULT_MAX_IMAGE_BYTES = 10 * 1024 * 1024;

// image_url content types supported by OpenAI-compatible chat APIs.
// BMP/SVG are detected by detectImageMimeType but rejected here — sending
// them as image_url would fail or be ignored by the provider.
const SUPPORTED_IMAGE_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

/**
 * Collect images from user message content blocks.
 *
 * @param blocks   content blocks of the last user message
 * @param workingDir  session working directory; `file_attachment.relativePath`
 *                    (e.g. `.tmp/shot.png`) is resolved against it
 * @param maxImageBytes  files larger than this stay file_attachment
 */
export function collectPromptImagesFromBlocks(
  blocks: ContentBlock[],
  workingDir: string,
  maxImageBytes: number = DEFAULT_MAX_IMAGE_BYTES,
): PromptImage[] {
  const images: PromptImage[] = [];
  for (const block of blocks) {
    if (block.type === "image") {
      images.push({
        type: "image",
        data: block.source.data,
        mimeType: block.source.media_type,
      });
      continue;
    }
    if (block.type !== "file_attachment") continue;

    const attachment = block as {
      type: "file_attachment";
      relativePath: string;
      mimeType?: string;
      inlineDataBase64?: string;
    };

    // Inline base64 (remote attachments) can be sent directly.
    if (attachment.inlineDataBase64) {
      const mime = normalizeInlineMime(attachment.mimeType);
      if (mime) {
        images.push({
          type: "image",
          data: attachment.inlineDataBase64,
          mimeType: mime,
        });
      }
      continue;
    }

    // Local file: resolve against the session working directory.
    const filePath = path.resolve(workingDir, attachment.relativePath);
    const mimeType = detectImageMimeType(filePath);
    if (!mimeType || !SUPPORTED_IMAGE_MIMES.has(mimeType)) continue;

    try {
      const stat = fs.statSync(filePath);
      if (stat.size > maxImageBytes) continue;
      const data = fs.readFileSync(filePath).toString("base64");
      images.push({ type: "image", data, mimeType });
    } catch {
      // Unreadable file — keep as file_attachment, agent falls back to tools.
      continue;
    }
  }
  return images;
}

function normalizeInlineMime(mimeType: string | undefined): string | null {
  if (!mimeType) return null;
  return SUPPORTED_IMAGE_MIMES.has(mimeType) ? mimeType : null;
}

/**
 * 单个 file_attachment 是否是一张可直传/可交给 vision_describe 的图片。
 * 内联数据按 mime 判定；落盘文件按内容嗅探，并用 SUPPORTED_IMAGE_MIMES 挡掉
 * BMP/SVG 这类 provider 不接受作为 image_url 的格式。
 *
 * 刻意**不**套 DEFAULT_MAX_IMAGE_BYTES：超过直传上限的图进不了模型，但仍应该拿到
 * vision_describe 提示（按体积截断只发生在 collectPromptImagesFromBlocks 的直传链路）。
 */
function isSupportedImageAttachment(
  block: ContentBlock,
  workingDir: string,
): boolean {
  const attachment = block as {
    inlineDataBase64?: string;
    mimeType?: string;
    relativePath: string;
  };
  if (attachment.inlineDataBase64) {
    return normalizeInlineMime(attachment.mimeType) !== null;
  }
  const filePath = path.resolve(workingDir, attachment.relativePath || "");
  const mimeType = detectImageMimeType(filePath);
  return mimeType !== null && SUPPORTED_IMAGE_MIMES.has(mimeType);
}

/**
 * 消息里是否有「模型可能直接看到的图片」：内联 `image` 块，或受支持格式的
 * `file_attachment`。主会话的能力判定用它替代「只数内联块」的旧逻辑——旧逻辑会让
 * 纯文本模型下的附图无声消失（连 vision_describe 提示都没有）。
 *
 * 与 collectPromptImagesFromBlocks 的唯一差异是体积上限（见 isSupportedImageAttachment）。
 */
export function messageHasImages(
  blocks: ContentBlock[],
  workingDir: string,
): boolean {
  return blocks.some((block) => {
    if (block.type === "image") return true;
    if (block.type !== "file_attachment") return false;
    return isSupportedImageAttachment(block, workingDir);
  });
}

/**
 * 附图在磁盘上的绝对路径，供 vision_describe 使用。
 * 附件文件本来就由 SessionManager 落到 <cwd>/.tmp，这里不复制、不读取内容。
 */
export function collectImageAttachmentPaths(
  blocks: ContentBlock[],
  workingDir: string,
): string[] {
  const paths: string[] = [];
  for (const block of blocks) {
    if (block.type !== "file_attachment") continue;
    if (!isSupportedImageAttachment(block, workingDir)) continue;
    const attachment = block as {
      inlineDataBase64?: string;
      relativePath: string;
    };
    // 只有内联数据、磁盘上没有对应文件的附件没有可指向的路径。
    if (attachment.inlineDataBase64) continue;
    const filePath = path.resolve(workingDir, attachment.relativePath || "");
    if (fs.existsSync(filePath)) paths.push(filePath);
  }
  return paths;
}
