/**
 * @module main/agent/tools/office/common
 *
 * Shared utilities for office document read tools:
 * path resolution, file validation, output truncation, error formatting.
 */
import * as fs from "fs";
import * as path from "path";

// ── Constants ──

export const DEFAULT_MAX_OUTPUT_BYTES = 50 * 1024; // 50 KB
export const OFFICE_MAX_SIZE = 50 * 1024 * 1024; // 50 MB
export const PDF_MAX_SIZE = 100 * 1024 * 1024; // 100 MB

// ── Path Resolution ──

export function resolvePath(filePath: string, workspaceDir: string): string {
  return path.isAbsolute(filePath)
    ? filePath
    : path.resolve(workspaceDir, filePath);
}

// ── File Validation ──

interface FileValid {
  valid: true;
  buffer: Buffer;
}

interface FileInvalid {
  valid: false;
  error: string;
}

export function validateFile(
  filePath: string,
  expectedExtensions: string[],
  maxSize: number,
): FileValid | FileInvalid {
  if (!fs.existsSync(filePath)) {
    return { valid: false, error: `File not found: ${filePath}` };
  }

  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    return { valid: false, error: `Not a file: ${filePath}` };
  }

  const ext = path.extname(filePath).toLowerCase();
  if (!expectedExtensions.includes(ext)) {
    return {
      valid: false,
      error: `Unsupported file type "${ext}". Expected: ${expectedExtensions.join(", ")}`,
    };
  }

  if (stat.size > maxSize) {
    return {
      valid: false,
      error: `File too large: ${(stat.size / 1024 / 1024).toFixed(1)} MB. Maximum is ${(maxSize / 1024 / 1024).toFixed(0)} MB.`,
    };
  }

  try {
    const buffer = fs.readFileSync(filePath);
    return { valid: true, buffer };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { valid: false, error: `Failed to read file: ${message}` };
  }
}

// ── Output Formatting ──

export function formatResult(
  text: string,
  sourceName: string,
  maxBytes: number = DEFAULT_MAX_OUTPUT_BYTES,
): { content: [{ type: "text"; text: string }] } {
  const header = `[${sourceName}]\n\n`;
  let body = text;

  // Truncate if output exceeds maxBytes
  const headerBytes = Buffer.byteLength(header, "utf-8");
  const maxBodyBytes = maxBytes - headerBytes - 50; // 50 byte buffer for truncation marker

  if (Buffer.byteLength(body, "utf-8") > maxBodyBytes) {
    // Truncate at character boundary while preserving valid UTF-8
    let truncated = body;
    while (Buffer.byteLength(truncated, "utf-8") > maxBodyBytes - 30) {
      truncated = truncated.slice(0, -1);
    }
    body = truncated + "\n\n[Truncated — output exceeds limit]";
  }

  return {
    content: [
      {
        type: "text" as const,
        text: header + body,
      },
    ],
  };
}

export function formatError(message: string): {
  content: [{ type: "text"; text: string }];
} {
  return {
    content: [
      {
        type: "text" as const,
        text: `Error: ${message}`,
      },
    ],
  };
}
