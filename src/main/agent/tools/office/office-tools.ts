/**
 * @module main/agent/tools/office/office-tools
 *
 * Factory that creates the 4 built-in office document read tools
 * and returns them as pi-coding-agent ToolDefinition objects.
 */
import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { readXlsx } from "./xlsx-reader";
import { readDocx } from "./docx-reader";
import { readPptx } from "./pptx-reader";
import { readPdf } from "./pdf-reader";
import {
  resolvePath,
  validateFile,
  formatResult,
  formatError,
  OFFICE_MAX_SIZE,
  PDF_MAX_SIZE,
  DEFAULT_MAX_OUTPUT_BYTES,
} from "./common";
import { log, logError } from "../../../utils/logger";
import * as path from "path";
import * as fs from "fs";

// Workaround for SDK ToolDefinition type strictness
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const td = (t: any): any => t;

type ToolExecuteResult = {
  content: Array<{ type: "text"; text: string }>;
};

export function createOfficeTools(workspaceDir: string): ToolDefinition[] {
  // ── office_read_xlsx ──

  const xlsxTool = td({
    name: "office_read_xlsx",
    label: "Read Excel Spreadsheet",
    description:
      "Read an Excel spreadsheet (.xlsx, .xlsm) and return its content as Markdown tables. " +
      "Use this tool when you need to view the data inside an Excel file. " +
      "Supports specifying a sheet name; defaults to the first sheet. " +
      "Preserves Chinese and all Unicode text.",
    parameters: Type.Object({
      path: Type.String({
        description: "Path to the .xlsx or .xlsm file (relative or absolute)",
      }),
      sheet: Type.Optional(
        Type.String({
          description:
            "Optional sheet name to read. If not specified, all sheets are returned.",
        }),
      ),
    }),
    async execute(
      _toolCallId: unknown,
      params: unknown,
      _signal: AbortSignal | undefined,
      _onUpdate: ((update: unknown) => void) | undefined,
      _ctx: unknown,
    ): Promise<ToolExecuteResult> {
      const { path: filePath, sheet } = params as {
        path: string;
        sheet?: string;
      };

      const resolved = resolvePath(filePath, workspaceDir);
      const validation = validateFile(
        resolved,
        [".xlsx", ".xlsm"],
        OFFICE_MAX_SIZE,
      );
      if (!validation.valid) return formatError(validation.error);

      try {
        const text = readXlsx(validation.buffer, sheet);
        log(`[OfficeReadXlsx] Read "${filePath}", ${text.length} chars`);
        return formatResult(text, path.basename(resolved));
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logError(`[OfficeReadXlsx] Error: ${message}`);
        return formatError(message);
      }
    },
  });

  // ── office_read_docx ──

  const docxTool = td({
    name: "office_read_docx",
    label: "Read Word Document",
    description:
      "Read a Word document (.docx) and return its content as Markdown. " +
      "Preserves headings, lists, tables, bold/italic formatting. " +
      "Use this tool when you need to view the contents of a Word document. " +
      "Supports Chinese and all Unicode text.",
    parameters: Type.Object({
      path: Type.String({
        description: "Path to the .docx file (relative or absolute)",
      }),
    }),
    async execute(
      _toolCallId: unknown,
      params: unknown,
      _signal: AbortSignal | undefined,
      _onUpdate: ((update: unknown) => void) | undefined,
      _ctx: unknown,
    ): Promise<ToolExecuteResult> {
      const { path: filePath } = params as { path: string };

      const resolved = resolvePath(filePath, workspaceDir);
      const validation = validateFile(resolved, [".docx"], OFFICE_MAX_SIZE);
      if (!validation.valid) return formatError(validation.error);

      try {
        const text = await readDocx(validation.buffer);
        log(`[OfficeReadDocx] Read "${filePath}", ${text.length} chars`);
        return formatResult(text, path.basename(resolved));
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logError(`[OfficeReadDocx] Error: ${message}`);
        return formatError(message);
      }
    },
  });

  // ── office_read_pptx ──

  const pptxTool = td({
    name: "office_read_pptx",
    label: "Read PowerPoint Presentation",
    description:
      "Read a PowerPoint presentation (.pptx) and return its content as Markdown. " +
      "Each slide is rendered with its number, title, and text content. " +
      "Use this tool when you need to view the text content of a PowerPoint file. " +
      "Supports Chinese and all Unicode text. Optionally include speaker notes.",
    parameters: Type.Object({
      path: Type.String({
        description: "Path to the .pptx file (relative or absolute)",
      }),
      includeNotes: Type.Optional(
        Type.Boolean({
          description:
            "Include speaker notes in the output (default: false). Note: full notes extraction requires the pptx skill.",
          default: false,
        }),
      ),
    }),
    async execute(
      _toolCallId: unknown,
      params: unknown,
      _signal: AbortSignal | undefined,
      _onUpdate: ((update: unknown) => void) | undefined,
      _ctx: unknown,
    ): Promise<ToolExecuteResult> {
      const { path: filePath, includeNotes } = params as {
        path: string;
        includeNotes?: boolean;
      };

      const resolved = resolvePath(filePath, workspaceDir);
      const validation = validateFile(resolved, [".pptx"], OFFICE_MAX_SIZE);
      if (!validation.valid) return formatError(validation.error);

      // PPTX ZIP parser works directly from buffer
      try {
        const text = await readPptx(validation.buffer, includeNotes ?? false);
        log(`[OfficeReadPptx] Read "${filePath}", ${text.length} chars`);
        return formatResult(text, path.basename(resolved));
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logError(`[OfficeReadPptx] Error: ${message}`);
        return formatError(message);
      }
    },
  });

  // ── office_read_pdf ──

  const pdfTool = td({
    name: "office_read_pdf",
    label: "Read PDF Document",
    description:
      "Read a PDF document and extract its content. " +
      "Text pages are returned as text (with Chinese/CJK support via CMap). " +
      "Image-only pages (scanned documents, diagrams, forms) are rendered to " +
      "PNG files — you will receive the file paths, which you can pass to " +
      "vision_describe to read the image content. " +
      "Supports page range selection for large documents.",
    parameters: Type.Object({
      path: Type.String({
        description: "Path to the .pdf file (relative or absolute)",
      }),
      startPage: Type.Optional(
        Type.Number({
          description: "1-indexed start page (default: 1)",
          minimum: 1,
        }),
      ),
      endPage: Type.Optional(
        Type.Number({
          description: "1-indexed end page (default: last page)",
          minimum: 1,
        }),
      ),
    }),
    async execute(
      _toolCallId: unknown,
      params: unknown,
      _signal: AbortSignal | undefined,
      _onUpdate: ((update: unknown) => void) | undefined,
      _ctx: unknown,
    ): Promise<ToolExecuteResult> {
      const {
        path: filePath,
        startPage,
        endPage,
      } = params as {
        path: string;
        startPage?: number;
        endPage?: number;
      };

      const resolved = resolvePath(filePath, workspaceDir);
      const validation = validateFile(resolved, [".pdf"], PDF_MAX_SIZE);
      if (!validation.valid) return formatError(validation.error);

      try {
        // Create temp dir for rendered page images (clean up stale files first)
        const imageDir = path.join(workspaceDir, ".pdf-images");
        fs.mkdirSync(imageDir, { recursive: true });
        for (const f of fs.readdirSync(imageDir)) {
          if (f.startsWith("pdf-page-")) {
            fs.unlinkSync(path.join(imageDir, f));
          }
        }

        const blocks = await readPdf(
          validation.buffer,
          imageDir,
          startPage,
          endPage,
        );
        log(
          `[OfficeReadPdf] Read "${filePath}", ${blocks.length} blocks`,
        );

        const sourceName = path.basename(resolved);
        const maxTextBytes = DEFAULT_MAX_OUTPUT_BYTES - 200;
        const content: ToolExecuteResult["content"] = [];
        let textBytes = 0;

        for (const block of blocks) {
          if (block.type === "image") {
            // Use absolute path so LLM can copy-paste it directly to vision_describe
            const line =
              `--- Page ${block.pageNumber} ---\n\n` +
              `[Image-only page — call vision_describe with path:\n` +
              `\`${block.imagePath}\`]`;
            content.push({ type: "text" as const, text: line });
          } else {
            const line =
              content.length === 0
                ? `[${sourceName}]\n\n${block.text}`
                : block.text;
            const lineBytes = Buffer.byteLength(line, "utf-8");
            if (textBytes + lineBytes > maxTextBytes) {
              content.push({
                type: "text" as const,
                text: "\n\n[Truncated — output exceeds limit]",
              });
              break;
            }
            textBytes += lineBytes;
            content.push({ type: "text" as const, text: line });
          }
        }

        return { content };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logError(`[OfficeReadPdf] Error: ${message}`);
        return formatError(message);
      }
    },
  });

  return [xlsxTool, docxTool, pptxTool, pdfTool];
}
