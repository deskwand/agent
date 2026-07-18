/**
 * Adapted from nicobailon/pi-web-access v0.13.0 (commit 7bdc30a), MIT License.
 */
import { basename } from "node:path";
import { getDocumentProxy } from "unpdf";

export interface PDFExtractResult {
  title: string;
  pages: number;
  chars: number;
  content: string;
}

export interface PDFExtractOptions {
  maxPages?: number;
}

const DEFAULT_MAX_PAGES = 100;

function extractTitleFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    let filename = basename(parsed.pathname, ".pdf");
    if (parsed.hostname.includes("arxiv.org")) {
      const match = parsed.pathname.match(/\/(?:pdf|abs)\/(\d+\.\d+)/);
      if (match) filename = `arxiv-${match[1]}`;
    }
    return (
      filename.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim() || "document"
    );
  } catch {
    return "document";
  }
}

export async function extractPDFToMarkdown(
  buffer: ArrayBuffer,
  url: string,
  options: PDFExtractOptions = {},
): Promise<PDFExtractResult> {
  const safeMaxPages = Number.isFinite(options.maxPages)
    ? Math.max(1, Math.floor(options.maxPages ?? DEFAULT_MAX_PAGES))
    : DEFAULT_MAX_PAGES;
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  try {
    const metadata = await pdf.getMetadata();
    const metadataInfo =
      metadata.info && typeof metadata.info === "object"
        ? (metadata.info as Record<string, unknown>)
        : null;
    const metaTitle =
      typeof metadataInfo?.Title === "string" ? metadataInfo.Title : undefined;
    const metaAuthor =
      typeof metadataInfo?.Author === "string"
        ? metadataInfo.Author
        : undefined;
    const title = metaTitle?.trim() || extractTitleFromUrl(url);
    const pagesToExtract = Math.min(pdf.numPages, safeMaxPages);
    const truncated = pdf.numPages > safeMaxPages;
    const pages: Array<{ pageNum: number; text: string }> = [];

    for (let pageNum = 1; pageNum <= pagesToExtract; pageNum += 1) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      const text = textContent.items
        .map((item: unknown) =>
          typeof item === "object" && item !== null && "str" in item
            ? String((item as { str?: unknown }).str ?? "")
            : "",
        )
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (text) pages.push({ pageNum, text });
    }

    const lines = [
      `# ${title}`,
      "",
      `> Source: ${url}`,
      `> Pages: ${pdf.numPages}${truncated ? ` (extracted first ${pagesToExtract})` : ""}`,
    ];
    if (metaAuthor) lines.push(`> Author: ${metaAuthor}`);
    lines.push("", "---", "");
    pages.forEach((page, index) => {
      if (index > 0) lines.push("", `<!-- Page ${page.pageNum} -->`, "");
      lines.push(page.text);
    });
    if (truncated) {
      lines.push(
        "",
        "---",
        "",
        `*[Truncated: Only first ${pagesToExtract} of ${pdf.numPages} pages extracted]*`,
      );
    }
    const content = lines.join("\n");
    return { title, pages: pdf.numPages, chars: content.length, content };
  } finally {
    await pdf.destroy().catch(() => undefined);
  }
}

export function isPDF(url: string, contentType?: string): boolean {
  if (contentType?.includes("application/pdf")) return true;
  try {
    return new URL(url).pathname.toLowerCase().endsWith(".pdf");
  } catch {
    return false;
  }
}
