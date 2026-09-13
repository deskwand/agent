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

/**
 * 可用内置浏览器（file://）打开的扩展名。
 * 只收「浏览器渲染就是最好的呈现方式」的类型：页面、PDF、音频。
 * 图片（含 svg）走图片预览，文本/代码走高亮源码预览，mp4/webm 走 VideoPlayer，
 * mov/m4v/ogv/mkv/avi 仍交给系统默认程序。
 */
const BROWSER_OPENABLE_EXTS = [
  ".html",
  ".htm",
  ".pdf",
  ".mp3",
  ".wav",
  ".m4a",
  ".aac",
  ".ogg",
  ".flac",
] as const;

/** 命中即以内置浏览器打开；未命中走既有预览 / 系统程序分支。契约同 isPreviewableExt。 */
export function isBrowserOpenableExt(ext: string): boolean {
  return Boolean(
    ext && (BROWSER_OPENABLE_EXTS as readonly string[]).includes(ext),
  );
}
