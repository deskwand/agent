export type VideoPlaybackKind = "inline" | "external" | "none";

export const INLINE_VIDEO_EXTENSIONS = [".mp4", ".webm"] as const;
export const EXTERNAL_VIDEO_EXTENSIONS = [
  ".mov",
  ".m4v",
  ".ogv",
  ".mkv",
] as const;
export const KNOWN_VIDEO_EXTENSIONS = [
  ...INLINE_VIDEO_EXTENSIONS,
  ...EXTERNAL_VIDEO_EXTENSIONS,
] as const;

const inlineExtensions = new Set<string>(INLINE_VIDEO_EXTENSIONS);
const knownExtensions = new Set<string>(KNOWN_VIDEO_EXTENSIONS);

const videoMimeTypes: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".m4v": "video/x-m4v",
  ".ogv": "video/ogg",
  ".mkv": "video/x-matroska",
};

function getExtension(filename: string): string {
  const basename = filename.split(/[/\\]/).pop() ?? filename;
  const dot = basename.lastIndexOf(".");
  return dot > 0 ? basename.slice(dot).toLowerCase() : "";
}

export function getVideoPlaybackKind(
  filename: string,
  mimeType?: string,
): VideoPlaybackKind {
  const extension = getExtension(filename);
  if (inlineExtensions.has(extension)) return "inline";
  if (knownExtensions.has(extension)) return "external";
  return mimeType?.toLowerCase().startsWith("video/") ? "external" : "none";
}

export function isKnownVideoFile(filename: string): boolean {
  return knownExtensions.has(getExtension(filename));
}

export function getVideoMimeType(filename: string): string {
  return videoMimeTypes[getExtension(filename)] ?? "application/octet-stream";
}

export function buildLocalVideoUrl(
  filePath: string,
  signature: string,
): string {
  const url = new URL("deskwand-media://local");
  url.searchParams.set("path", filePath);
  url.searchParams.set("signature", signature);
  return url.toString();
}
