/**
 * @module main/agent/tools/office/pdf-reader
 *
 * Reads .pdf files using pdfjs-dist (Mozilla).
 * - Text pages: extracts text content with CMap support for Chinese/CJK.
 * - Image-only pages: renders to PNG, saves to temp files, returns file paths
 *   so the LLM can delegate to vision_describe or image-ocr as needed.
 *
 * pdfjs-dist is loaded lazily (dynamic import inside readPdf) to avoid a
 * startup crash on Windows when @napi-rs/canvas native binary is missing
 * and DOMMatrix cannot be polyfilled at module-init time.
 */
import * as path from "path";
import * as fs from "fs";
import { pathToFileURL } from "url";
import { logError } from "../../../utils/logger";

// ── Content block types ───────────────────────────────────────────

export interface PdfTextBlock {
  type: "text";
  text: string;
}

/** An image-only page rendered to a PNG file on disk. */
export interface PdfImageBlock {
  type: "image";
  pageNumber: number;
  /** Absolute path to the rendered PNG file. Pass this to vision_describe. */
  imagePath: string;
}

export type PdfContentBlock = PdfTextBlock | PdfImageBlock;

// ── Internal helpers ──────────────────────────────────────────────

interface TextItem {
  str: string;
  hasEOL?: boolean;
}

function extractPageText(textContent: { items: TextItem[] }): string {
  return textContent.items
    .map((item) => item.str + (item.hasEOL ? "\n" : " "))
    .join("")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function renderPageToPng(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page: any,
  scale: number,
  outputPath: string,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createCanvas } = require("@napi-rs/canvas") as {
    createCanvas: (
      w: number,
      h: number,
    ) => {
      getContext: (kind: "2d") => {
        canvas: { width: number; height: number };
      } & Record<string, unknown>;
      toBuffer: (mime: string) => Buffer;
    };
  };

  let viewport = page.getViewport({ scale });
  // Cap viewport to prevent OOM on extremely large pages (e.g. A0 blueprints)
  const maxDim = 4096;
  if (viewport.width > maxDim || viewport.height > maxDim) {
    const ratio = Math.min(maxDim / viewport.width, maxDim / viewport.height);
    viewport = page.getViewport({ scale: scale * ratio });
  }
  const canvas = createCanvas(viewport.width, viewport.height);
  const ctx = canvas.getContext("2d");

  await page.render({
    canvasContext: ctx as unknown as CanvasRenderingContext2D,
    canvas: canvas as unknown as HTMLCanvasElement,
    viewport,
  }).promise;

  fs.writeFileSync(outputPath, canvas.toBuffer("image/png"));
}

// ── Public API ───────────────────────────────────────────────────

/**
 * Read a PDF buffer and return content blocks.
 * Text pages → PdfTextBlock. Image-only pages → PdfImageBlock with a file path
 * to the rendered PNG (saved under `imageDir`).
 *
 * @param buffer  - PDF file buffer
 * @param imageDir - directory to write rendered page PNGs
 * @param startPage - 1-indexed start page (default 1)
 * @param endPage   - 1-indexed end page (default: last page)
 */
export async function readPdf(
  buffer: Buffer,
  imageDir: string,
  startPage?: number,
  endPage?: number,
): Promise<PdfContentBlock[]> {
  // Dynamic import avoids a startup crash on Windows where @napi-rs/canvas
  // native binary is missing → pdfjs-dist top-level `new DOMMatrix()` throws.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfjsLib: any = await import("pdfjs-dist/legacy/build/pdf.mjs");

  // Worker & CMap setup (previously at module top-level, now inline)
  try {
    const wp = require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");
    pdfjsLib.GlobalWorkerOptions.workerSrc = pathToFileURL(wp).href;
  } catch {
    // worker file not found — pdfjs-dist will fall back to its default
  }
  let cmapUrl: string | undefined;
  try {
    const p = require.resolve("pdfjs-dist/legacy/build/pdf.mjs");
    cmapUrl = pathToFileURL(
      path.join(path.dirname(p), "..", "..", "cmaps") + path.sep,
    ).href;
  } catch {
    // cmaps not found — CJK text may render poorly
  }

  // pdfjs-dist v6 requires Uint8Array; from fs.readFileSync, byteOffset is 0.
  const data = new Uint8Array(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength,
  );

  const loadingTask = pdfjsLib.getDocument({
    data,
    ...(cmapUrl ? { cMapUrl: cmapUrl, cMapPacked: true } : {}),
  });

  const doc = await loadingTask.promise;
  const totalPages = doc.numPages;
  const start = Math.max(1, startPage || 1);
  const end = Math.min(endPage || totalPages, totalPages);

  if (start > end) {
    throw new Error(
      `Invalid page range: start (${start}) > end (${end}). Document has ${totalPages} pages.`,
    );
  }

  // Ensure image output directory exists
  fs.mkdirSync(imageDir, { recursive: true });

  const blocks: PdfContentBlock[] = [];

  for (let i = start; i <= end; i++) {
    const page = await doc.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = extractPageText(textContent as { items: TextItem[] });

    if (pageText.length > 0) {
      const header = totalPages > 1 ? `--- Page ${i} ---\n\n` : "";
      blocks.push({ type: "text", text: header + pageText });
    } else {
      try {
        const imageName = `pdf-page-${i}.png`;
        const imagePath = path.join(imageDir, imageName);
        await renderPageToPng(page, 2.0, imagePath);
        blocks.push({ type: "image", pageNumber: i, imagePath });
      } catch (err) {
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        logError(`[PdfReader] Failed to render page ${i}: ${err}`);
        blocks.push({
          type: "text",
          text:
            `--- Page ${i} ---\n\n` +
            "(no text content on this page — image rendering failed)",
        });
      }
    }
  }

  return blocks;
}
