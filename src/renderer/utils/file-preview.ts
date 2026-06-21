export type ReadFileResult =
  | { type: "text"; content: string; ext: string }
  | { type: "image"; content: string; mimeType: string }
  | { type: "error"; message: string };

// Map file extension to highlight.js language identifier
export const LANG_MAP: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".jsx": "jsx",
  ".json": "json",
  ".css": "css",
  ".html": "xml",
  ".xml": "xml",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "ini",
  ".ini": "ini",
  ".cfg": "ini",
  ".conf": "ini",
  ".sh": "bash",
  ".bash": "bash",
  ".zsh": "bash",
  ".py": "python",
  ".rb": "ruby",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".c": "c",
  ".cpp": "cpp",
  ".h": "c",
  ".hpp": "cpp",
  ".swift": "swift",
  ".sql": "sql",
  ".env": "bash",
  ".csv": "plaintext",
};

export function getLangFromExt(ext: string): string {
  return LANG_MAP[ext] || ext.slice(1) || "plaintext";
}

import { PREVIEW_EXTS } from "./file-types";

/** Check if a filename extension is one that FilePreviewModal can preview. */
export function isPreviewableExt(ext: string): boolean {
  return Boolean(ext && (PREVIEW_EXTS as readonly string[]).includes(ext));
}
