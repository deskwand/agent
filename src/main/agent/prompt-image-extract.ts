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
