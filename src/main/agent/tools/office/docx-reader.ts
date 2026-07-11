/**
 * @module main/agent/tools/office/docx-reader
 *
 * Reads .docx files using mammoth.js.
 * Converts Word documents to Markdown with preserved formatting.
 */
// mammoth is CJS-only — use require()
// eslint-disable-next-line @typescript-eslint/no-var-requires
const mammoth = require("mammoth") as {
  convertToMarkdown: (options: { buffer: Buffer }) => Promise<{
    value: string;
    messages: Array<{ type: string; message: string }>;
  }>;
};
import { logWarn } from "../../../utils/logger";

/**
 * Convert a .docx buffer to Markdown text.
 * Mammoth's defaults handle headings, lists, tables, bold/italic, and links.
 * Chinese text is preserved correctly.
 */
export async function readDocx(buffer: Buffer): Promise<string> {
  const result = await mammoth.convertToMarkdown({ buffer });

  // Log any warnings (e.g., unsupported features)
  if (result.messages.length > 0) {
    for (const msg of result.messages) {
      logWarn(`[DocxReader] mammoth warning: [${msg.type}] ${msg.message}`);
    }
  }

  const text = result.value.trim();
  if (!text) {
    return "(empty document — no text content found)";
  }

  return text;
}
