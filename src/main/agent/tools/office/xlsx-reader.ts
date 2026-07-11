/**
 * @module main/agent/tools/office/xlsx-reader
 *
 * Reads .xlsx / .xlsm files using SheetJS (Community Edition).
 * Extracts sheet data as a Markdown table.
 */
import * as XLSX from "xlsx";

/**
 * Read an Excel workbook buffer and return content as Markdown table(s).
 * If sheetName is provided, only that sheet is returned.
 * Otherwise, all sheets are included with sheet name headers.
 */
export function readXlsx(buffer: Buffer, sheetName?: string): string {
  const wb = XLSX.read(buffer, { type: "buffer" });

  if (sheetName) {
    if (!wb.SheetNames.includes(sheetName)) {
      const available = wb.SheetNames.map((s) => `"${s}"`).join(", ");
      throw new Error(
        `Sheet "${sheetName}" not found. Available sheets: ${available}`,
      );
    }
    const data = sheetTo2DArray(wb.Sheets[sheetName]);
    return `## ${sheetName}\n\n${arrayToMarkdownTable(data)}`;
  }

  // All sheets
  const parts: string[] = [];
  for (const name of wb.SheetNames) {
    const data = sheetTo2DArray(wb.Sheets[name]);
    parts.push(`## ${name}\n\n${arrayToMarkdownTable(data)}`);
  }
  return parts.join("\n\n");
}

/**
 * Convert a SheetJS worksheet to a 2D array of strings.
 * Uses sheet_to_json with header:1 for raw row arrays.
 */
function sheetTo2DArray(ws: XLSX.WorkSheet): string[][] {
  const raw: unknown[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    defval: "",
    blankrows: false,
  });

  // Convert all cells to strings and trim trailing empty columns
  return raw
    .filter((row) => row.some((cell) => cell !== "" && cell != null))
    .map((row) =>
      row.slice(0, lastNonEmptyIndex(row) + 1).map((cell) => {
        if (cell === null || cell === undefined) return "";
        return String(cell);
      }),
    );
}

function lastNonEmptyIndex(row: unknown[]): number {
  for (let i = row.length - 1; i >= 0; i--) {
    if (row[i] !== "" && row[i] != null) return i;
  }
  return -1;
}

/**
 * Convert a 2D string array to a GitHub-flavored Markdown table.
 * First row is treated as header.
 */
export function arrayToMarkdownTable(data: string[][]): string {
  if (data.length === 0) return "(empty sheet)";
  if (data.length === 1) return data[0].join(" | ");

  const header = data[0];
  const rows = data.slice(1);

  // Calculate column widths for alignment padding
  const colWidths = header.map((h, i) => {
    const maxCellLen = rows.reduce(
      (max, row) => Math.max(max, (row[i] || "").length),
      h.length,
    );
    return Math.min(maxCellLen, 60); // cap column width at 60 chars
  });

  const formatRow = (cells: string[]): string =>
    "| " +
    cells
      .map((c, i) => {
        const padded = c.padEnd(colWidths[i] || 0, " ");
        return padded.slice(0, 60); // truncate cell content
      })
      .join(" | ") +
    " |";

  const separator =
    "|" + colWidths.map((w) => "-".repeat(w + 2) + "|").join("");

  return [formatRow(header), separator, ...rows.map(formatRow)].join("\n");
}
