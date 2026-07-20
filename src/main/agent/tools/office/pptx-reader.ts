/**
 * @module main/agent/tools/office/pptx-reader
 *
 * Reads .pptx files using only Node.js built-ins (zero external dependencies).
 * PPTX is a ZIP archive of XML files — we unzip with zlib + a minimal
 * Central Directory parser, then extract text from <a:t> elements via regex.
 */
import * as zlib from "zlib";

// ── Minimal ZIP reader (only what we need for PPTX) ──────────────

interface ZipEntry {
  name: string;
  offset: number;
  compressedSize: number;
  uncompressedSize: number;
  compressionMethod: number;
}

/**
 * Parse ZIP Central Directory to locate entries.
 * Returns a Map of filename → entry metadata.
 */
function parseZipDirectory(buf: Buffer): Map<string, ZipEntry> {
  const entries = new Map<string, ZipEntry>();

  // EOCD is at least 22 bytes; anything smaller is not a valid ZIP
  if (buf.length < 22) throw new Error("Not a valid ZIP — too small");

  // Find End of Central Directory record (signature 0x06054b50)
  // Search backwards from end of file (max 64KB comment)
  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (
      buf[i] === 0x50 &&
      buf[i + 1] === 0x4b &&
      buf[i + 2] === 0x05 &&
      buf[i + 3] === 0x06
    ) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) throw new Error("Not a valid ZIP — EOCD not found");

  const cdOffset = buf.readUInt32LE(eocdOffset + 16);
  const totalEntries = buf.readUInt16LE(eocdOffset + 10);
  const cdSize = buf.readUInt32LE(eocdOffset + 12);

  // Sanity: if this single central directory is > 100MB, bail
  if (cdSize > 100 * 1024 * 1024) {
    throw new Error("PPTX too large (>100MB central directory)");
  }

  // PPTX files use standard ZIP (no ZIP64). If the EOCD indicates ZIP64
  // (total entries = 0xFFFF), bail early instead of cryptic parse errors.
  if (buf.readUInt16LE(eocdOffset + 10) === 0xffff) {
    throw new Error("ZIP64 archives are not supported");
  }

  let pos = cdOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) {
      throw new Error("Invalid central directory entry signature");
    }
    const compressionMethod = buf.readUInt16LE(pos + 10);
    const compressedSize = buf.readUInt32LE(pos + 20);
    const uncompressedSize = buf.readUInt32LE(pos + 24);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const localHeaderOffset = buf.readUInt32LE(pos + 42);
    const name = buf.toString("utf8", pos + 46, pos + 46 + nameLen);

    entries.set(name, {
      name,
      offset: localHeaderOffset,
      compressedSize,
      uncompressedSize,
      compressionMethod,
    });

    pos += 46 + nameLen + extraLen + commentLen;
  }

  return entries;
}

/**
 * Read and decompress a single file from the ZIP buffer.
 */
function readZipEntry(zipBuf: Buffer, entry: ZipEntry): Buffer {
  // Skip local file header (30 bytes + name + extra)
  let localPos = entry.offset;
  const localNameLen = zipBuf.readUInt16LE(localPos + 26);
  const localExtraLen = zipBuf.readUInt16LE(localPos + 28);
  localPos += 30 + localNameLen + localExtraLen;

  const compressed = zipBuf.subarray(localPos, localPos + entry.compressedSize);

  if (entry.compressionMethod === 0) {
    // Stored (no compression)
    return compressed;
  } else if (entry.compressionMethod === 8) {
    // DEFLATE
    return zlib.inflateRawSync(compressed);
  } else {
    throw new Error(
      `Unsupported compression method: ${entry.compressionMethod}`,
    );
  }
}

// ── Text extraction ──────────────────────────────────────────────

/**
 * Extract text content from OOXML slide XML buffer.
 * Finds all <a:t> elements and collects their text content.
 */
function extractSlideText(xml: string): string[] {
  const lines: string[] = [];
  // <a:t> tags may contain whitespace and xml:space="preserve" attributes
  const tRegex = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g;
  let match: RegExpExecArray | null;
  while ((match = tRegex.exec(xml)) !== null) {
    const text = match[1].trim();
    if (text) lines.push(text);
  }
  return lines;
}

/**
 * Check if a string looks like XML (starts with < after optional BOM/ws).
 */
function looksLikeXml(s: string): boolean {
  const t = s.trimStart();
  return t.startsWith("<?xml") || t.startsWith("<");
}

// ── Public API ───────────────────────────────────────────────────

/**
 * Convert a .pptx buffer to Markdown text.
 * Each slide is rendered with its number and text content.
 *
 * @param zipBuf - .pptx file content as a Buffer (PPTX is a ZIP archive)
 * @param includeNotes - whether to extract speaker notes from /ppt/notesSlides/
 */
export async function readPptx(
  zipBuf: Buffer,
  includeNotes: boolean,
): Promise<string> {
  const entries = parseZipDirectory(zipBuf);

  // Collect slide files: ppt/slides/slideN.xml
  const slideEntries: Array<{ num: number; entry: ZipEntry }> = [];
  const slideRegex = /^ppt\/slides\/slide(\d+)\.xml$/i;

  for (const [name, entry] of entries) {
    const m = name.match(slideRegex);
    if (m) {
      slideEntries.push({ num: parseInt(m[1], 10), entry });
    }
  }
  slideEntries.sort((a, b) => a.num - b.num);

  if (slideEntries.length === 0) {
    return "(empty presentation — no slides found)";
  }

  // Build notes map if requested
  let notesMap: Map<number, string> | undefined;
  if (includeNotes) {
    notesMap = new Map();
    const notesRegex = /^ppt\/notesSlides\/notesSlide(\d+)\.xml$/i;
    for (const [name, entry] of entries) {
      const m = name.match(notesRegex);
      if (m) {
        const notesXml = readZipEntry(zipBuf, entry).toString("utf8");
        const notesLines = extractSlideText(notesXml);
        notesMap.set(parseInt(m[1], 10), notesLines.join("\n"));
      }
    }
  }

  const parts: string[] = [];
  for (const { num, entry } of slideEntries) {
    const raw = readZipEntry(zipBuf, entry);
    const xml = raw.toString("utf8");

    if (!looksLikeXml(xml)) continue;

    const text = extractSlideText(xml);

    let slideMd = `## Slide ${num}`;
    slideMd += "\n\n";
    if (text.length > 0) {
      slideMd += text.join("\n");
    }

    // Append notes if available
    if (notesMap) {
      const notes = notesMap.get(num);
      if (notes) {
        slideMd += `\n\n> **Speaker notes:** ${notes}`;
      }
    }

    parts.push(slideMd);
  }

  return parts.join("\n\n---\n\n");
}
