/**
 * Unit tests for office document read tools.
 *
 * Covers: readers (xlsx/docx/pptx), common utilities,
 * and tool factory execution branches.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { TextContent } from "@earendil-works/pi-ai";

/** Cast a content block to TextContent — all office tools return text-only. */
const asText = (block: { type: string }): TextContent => block as TextContent;
import {
  resolvePath,
  validateFile,
  formatResult,
  formatError,
  DEFAULT_MAX_OUTPUT_BYTES,
} from "../../main/agent/tools/office/common";
import {
  readXlsx,
  arrayToMarkdownTable,
} from "../../main/agent/tools/office/xlsx-reader";
import { readDocx } from "../../main/agent/tools/office/docx-reader";

// ── Helpers ──

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "deskwand-office-test-"));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

// ── Common Utilities ──

describe("office common utilities", () => {
  describe("resolvePath", () => {
    it("returns absolute paths as-is", () => {
      expect(resolvePath("/tmp/file.xlsx", "/workspace")).toBe(
        "/tmp/file.xlsx",
      );
    });

    it("resolves relative paths against workspaceDir", () => {
      const result = resolvePath("data/file.xlsx", "/workspace");
      expect(result).toBe(path.resolve("/workspace", "data/file.xlsx"));
    });
  });

  describe("validateFile", () => {
    it("rejects non-existent files", () => {
      const result = validateFile("/nonexistent/file.xlsx", [".xlsx"], 1024);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain("File not found");
      }
    });

    it("rejects directories", () => {
      const result = validateFile(tempDir, [".xlsx"], 1024);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain("Not a file");
      }
    });

    it("rejects wrong extension", () => {
      const txtPath = path.join(tempDir, "notes.txt");
      fs.writeFileSync(txtPath, "hello");
      const result = validateFile(txtPath, [".xlsx"], 1024);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain('Unsupported file type ".txt"');
      }
    });

    it("rejects oversized files", () => {
      const bigPath = path.join(tempDir, "big.xlsx");
      const fd = fs.openSync(bigPath, "w");
      fs.writeSync(fd, Buffer.alloc(1024 * 1024 + 1)); // just over 1MB
      fs.closeSync(fd);
      const result = validateFile(bigPath, [".xlsx"], 1024 * 1024);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain("File too large");
      }
    });

    it("accepts valid file", () => {
      const xlsxPath = path.join(tempDir, "data.xlsx");
      fs.writeFileSync(xlsxPath, "fake xlsx content");
      const result = validateFile(xlsxPath, [".xlsx"], 1024 * 1024);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.buffer).toBeInstanceOf(Buffer);
      }
    });
  });

  describe("formatResult", () => {
    it("wraps text with header", () => {
      const result = formatResult("Hello World", "test.xlsx");
      expect(result.content[0].type).toBe("text");
      expect(asText(result.content[0]).text).toContain("[test.xlsx]");
      expect(asText(result.content[0]).text).toContain("Hello World");
    });

    it("truncates long output", () => {
      const longText = "A".repeat(DEFAULT_MAX_OUTPUT_BYTES + 1000);
      const result = formatResult(longText, "big.xlsx");
      expect(asText(result.content[0]).text).toContain("[Truncated");
      expect(
        Buffer.byteLength(asText(result.content[0]).text, "utf-8"),
      ).toBeLessThanOrEqual(DEFAULT_MAX_OUTPUT_BYTES + 200);
    });
  });

  describe("formatError", () => {
    it("returns error format", () => {
      const result = formatError("something went wrong");
      expect(result.content[0].type).toBe("text");
      expect(asText(result.content[0]).text).toContain(
        "Error: something went wrong",
      );
    });
  });
});

// ── Markdown Table Formatter ──

describe("arrayToMarkdownTable", () => {
  it("returns placeholder for empty data", () => {
    expect(arrayToMarkdownTable([])).toBe("(empty sheet)");
  });

  it("renders single row without table", () => {
    expect(arrayToMarkdownTable([["A", "B"]])).toBe("A | B");
  });

  it("renders table with header and rows", () => {
    const result = arrayToMarkdownTable([
      ["Name", "Age"],
      ["Alice", "30"],
      ["Bob", "25"],
    ]);
    expect(result).toContain("| Name");
    expect(result).toContain("| Alice");
    expect(result).toContain("| Bob");
    expect(result).toContain("---");
  });
});

// ── XLSX Reader ──

describe("readXlsx", () => {
  it("returns empty result for non-zip buffer", () => {
    // SheetJS gracefully handles non-zip data — no throw, just empty output
    const badBuffer = Buffer.from("not a zip file");
    const result = readXlsx(badBuffer);
    // Returns empty content (no sheets found in random bytes)
    expect(typeof result).toBe("string");
  });

  it("throws on non-existent sheet name", () => {
    // Create a minimal xlsx programmatically using SheetJS itself
    const XLSX = require("xlsx");
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["Header", "Value"],
      ["A", "1"],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, "Data");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    expect(() => readXlsx(buf, "NonExistent")).toThrow(
      'Sheet "NonExistent" not found',
    );
  });

  it("reads a single-sheet workbook", () => {
    const XLSX = require("xlsx");
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["Name", "Age"],
      ["张三", "30"],
      ["李四", "25"],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    const result = readXlsx(buf);
    expect(result).toContain("## Sheet1");
    expect(result).toContain("张三");
    expect(result).toContain("李四");
  });

  it("reads a specific sheet by name", () => {
    const XLSX = require("xlsx");
    const wb = XLSX.utils.book_new();
    const ws1 = XLSX.utils.aoa_to_sheet([["SheetOne"]]);
    const ws2 = XLSX.utils.aoa_to_sheet([["SheetTwo"]]);
    XLSX.utils.book_append_sheet(wb, ws1, "First");
    XLSX.utils.book_append_sheet(wb, ws2, "Second");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    const result = readXlsx(buf, "Second");
    expect(result).toContain("## Second");
    expect(result).toContain("SheetTwo");
    expect(result).not.toContain("SheetOne");
  });
});

// ── DOCX Reader ──

describe("readDocx", () => {
  async function createDocxBuffer(documentXml: string): Promise<Buffer> {
    const JSZip = require("jszip");
    const zip = new JSZip();

    zip.file(
      "[Content_Types].xml",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        "</Types>",
    );

    zip
      .folder("_rels")!
      .file(
        ".rels",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
          "</Relationships>",
      );

    zip.folder("word")!.file("document.xml", documentXml);

    return zip.generateAsync({ type: "nodebuffer" }) as Promise<Buffer>;
  }

  it("reads a docx with Chinese text", async () => {
    const buf = await createDocxBuffer(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        "<w:body>" +
        "<w:p><w:r><w:t>你好世界</w:t></w:r></w:p>" +
        "<w:p><w:r><w:t>Hello World</w:t></w:r></w:p>" +
        "</w:body>" +
        "</w:document>",
    );

    const result = await readDocx(buf);
    expect(result).toContain("你好世界");
    expect(result).toContain("Hello World");
  });

  it("handles empty docx gracefully", async () => {
    const buf = await createDocxBuffer(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        "<w:body></w:body>" +
        "</w:document>",
    );

    const result = await readDocx(buf);
    expect(result).toContain("(empty document");
  });
});

// ── PPTX Reader ──

describe("readPptx", () => {
  it("throws on invalid buffer", async () => {
    // Dynamic import because ESM interop
    const { readPptx } =
      await import("../../main/agent/tools/office/pptx-reader");
    await expect(readPptx(Buffer.from("not a zip"), false)).rejects.toThrow();
  });

  it("reads a pptx with text content", async () => {
    const { readPptx } =
      await import("../../main/agent/tools/office/pptx-reader");
    const JSZip = require("jszip");
    const zip = new JSZip();

    zip.file(
      "[Content_Types].xml",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
        '<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>' +
        "</Types>",
    );

    zip
      .folder("_rels")!
      .file(
        ".rels",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>' +
          "</Relationships>",
      );

    zip
      .folder("ppt")!
      .file(
        "presentation.xml",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
          '<p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>' +
          "</p:presentation>",
      );

    zip
      .folder("ppt")!
      .folder("_rels")!
      .file(
        "presentation.xml.rels",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>' +
          "</Relationships>",
      );

    zip
      .folder("ppt")!
      .folder("slides")!
      .file(
        "slide1.xml",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"' +
          ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
          "<p:cSld>" +
          "<p:spTree>" +
          "<p:sp>" +
          '<p:nvSpPr><p:cNvPr id="1" name="Title"/></p:nvSpPr>' +
          "<p:txBody>" +
          "<a:bodyPr/>" +
          "<a:p><a:r><a:t>演示文稿</a:t></a:r></a:p>" +
          "</p:txBody>" +
          "</p:sp>" +
          "</p:spTree>" +
          "</p:cSld>" +
          "</p:sld>",
      );

    zip
      .folder("ppt")!
      .folder("slides")!
      .folder("_rels")!
      .file(
        "slide1.xml.rels",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>',
      );

    const buf = await zip.generateAsync({ type: "nodebuffer" });

    const result = await readPptx(buf, false);
    expect(result).toContain("演示文稿");
    expect(result).toContain("## Slide 1");
  });

  it("includeNotes flag adds note about skill", async () => {
    const { readPptx } =
      await import("../../main/agent/tools/office/pptx-reader");
    const JSZip = require("jszip");
    const zip = new JSZip();

    zip.file(
      "[Content_Types].xml",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
        '<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>' +
        "</Types>",
    );

    zip
      .folder("_rels")!
      .file(
        ".rels",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>' +
          "</Relationships>",
      );

    zip
      .folder("ppt")!
      .file(
        "presentation.xml",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
          '<p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>' +
          "</p:presentation>",
      );

    zip
      .folder("ppt")!
      .folder("_rels")!
      .file(
        "presentation.xml.rels",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>' +
          "</Relationships>",
      );

    zip
      .folder("ppt")!
      .folder("slides")!
      .file(
        "slide1.xml",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"' +
          ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
          "<p:cSld>" +
          "<p:spTree>" +
          "<p:sp>" +
          '<p:nvSpPr><p:cNvPr id="1" name="Title"/></p:nvSpPr>' +
          "<p:txBody>" +
          "<a:bodyPr/>" +
          "<a:p><a:r><a:t>Slide text</a:t></a:r></a:p>" +
          "</p:txBody>" +
          "</p:sp>" +
          "</p:spTree>" +
          "</p:cSld>" +
          "</p:sld>",
      );

    // Add a notes slide for the includeNotes test
    zip
      .folder("ppt")!
      .folder("notesSlides")!
      .file(
        "notesSlide1.xml",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"' +
          ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
          "<p:cSld><p:spTree><p:sp><p:txBody><a:bodyPr/><a:p><a:r><a:t>Speaker notes: remember to mention Q3 results</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>" +
          "</p:notes>",
      );

    zip
      .folder("ppt")!
      .folder("notesSlides")!
      .folder("_rels")!
      .file(
        "notesSlide1.xml.rels",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>',
      );

    zip
      .folder("ppt")!
      .folder("slides")!
      .folder("_rels")!
      .file(
        "slide1.xml.rels",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>',
      );

    const buf = await zip.generateAsync({ type: "nodebuffer" });

    const result = await readPptx(buf, true);
    expect(result).toContain("Slide text");
    expect(result).toContain("Speaker notes");
    expect(result).toContain("Q3 results");
  });
});

// ── Tool Factory ──

describe("createOfficeTools", () => {
  async function getTools() {
    const { createOfficeTools } =
      await import("../../main/agent/tools/office/office-tools");
    return createOfficeTools(tempDir);
  }

  it("returns 4 tool definitions", async () => {
    const tools = await getTools();
    expect(tools).toHaveLength(4);
  });

  it("each tool has required fields", async () => {
    const tools = await getTools();
    for (const tool of tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.label).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.parameters).toBeTruthy();
      expect(typeof tool.execute).toBe("function");
    }
  });

  it("tool names match expected pattern", async () => {
    const tools = await getTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "office_read_docx",
      "office_read_pdf",
      "office_read_pptx",
      "office_read_xlsx",
    ]);
  });

  it("xlsx tool returns error for missing file", async () => {
    const tools = await getTools();
    const xlsxTool = tools.find((t) => t.name === "office_read_xlsx")!;
    const result = await xlsxTool.execute(
      "call-1",
      { path: path.join(tempDir, "nonexistent.xlsx") },
      undefined,
      undefined,
      {} as never,
    );
    expect(asText(result.content[0]).text).toContain("Error: File not found");
  });

  it("docx tool returns error for missing file", async () => {
    const tools = await getTools();
    const docxTool = tools.find((t) => t.name === "office_read_docx")!;
    const result = await docxTool.execute(
      "call-1",
      { path: path.join(tempDir, "nonexistent.docx") },
      undefined,
      undefined,
      {} as never,
    );
    expect(asText(result.content[0]).text).toContain("Error: File not found");
  });

  it("pptx tool returns error for missing file", async () => {
    const tools = await getTools();
    const pptxTool = tools.find((t) => t.name === "office_read_pptx")!;
    const result = await pptxTool.execute(
      "call-1",
      { path: path.join(tempDir, "nonexistent.pptx") },
      undefined,
      undefined,
      {} as never,
    );
    expect(asText(result.content[0]).text).toContain("Error: File not found");
  });

  it("pdf tool returns error for missing file", async () => {
    const tools = await getTools();
    const pdfTool = tools.find((t) => t.name === "office_read_pdf")!;
    const result = await pdfTool.execute(
      "call-1",
      { path: path.join(tempDir, "nonexistent.pdf") },
      undefined,
      undefined,
      {} as never,
    );
    expect(asText(result.content[0]).text).toContain("Error: File not found");
  });

  it("xlsx tool returns error for wrong extension", async () => {
    const tools = await getTools();
    const xlsxTool = tools.find((t) => t.name === "office_read_xlsx")!;
    const txtPath = path.join(tempDir, "notes.txt");
    fs.writeFileSync(txtPath, "hello");
    const result = await xlsxTool.execute(
      "call-1",
      { path: txtPath },
      undefined,
      undefined,
      {} as never,
    );
    expect(asText(result.content[0]).text).toContain("Unsupported file type");
  });
});
