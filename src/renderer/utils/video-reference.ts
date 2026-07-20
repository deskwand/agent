import { isUncPath, isWindowsDrivePath } from "../../shared/local-file-path";
import { resolvePathAgainstWorkspace } from "../../shared/workspace-path";
import { getVideoPlaybackKind } from "../../shared/video-file";
import { splitTextByFileMentions } from "./file-link";
import {
  extractMarkdownLocalFileHrefs,
  resolveLocalFilePathFromHref,
  stripMarkdownInlineLinks,
} from "./markdown-local-link";

export interface VideoReference {
  path: string;
  name: string;
  playbackKind: "inline" | "external";
}

export function normalizeVideoReferencePath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  return isWindowsDrivePath(filePath) || isUncPath(filePath)
    ? normalized.toLowerCase()
    : normalized;
}

function isAbsoluteLocalPath(value: string): boolean {
  return value.startsWith("/") || isWindowsDrivePath(value) || isUncPath(value);
}

function addReference(
  output: Map<string, VideoReference>,
  candidate: string,
  workspacePath?: string,
): void {
  if (!isAbsoluteLocalPath(candidate) && !workspacePath) return;
  const path = resolvePathAgainstWorkspace(candidate, workspacePath);
  const playbackKind = getVideoPlaybackKind(path);
  if (playbackKind === "none") return;
  const name = path.split(/[/\\]/).pop() || path;
  output.set(normalizeVideoReferencePath(path), { path, name, playbackKind });
}

export function extractVideoReferences(
  markdown: string,
  workspacePath?: string,
): VideoReference[] {
  const output = new Map<string, VideoReference>();

  for (const part of splitTextByFileMentions(
    stripMarkdownInlineLinks(markdown),
  )) {
    if (part.type === "file") addReference(output, part.value, workspacePath);
  }

  for (const href of extractMarkdownLocalFileHrefs(markdown)) {
    const path = resolveLocalFilePathFromHref(href, workspacePath);
    if (path) addReference(output, path, workspacePath);
  }

  return [...output.values()];
}
