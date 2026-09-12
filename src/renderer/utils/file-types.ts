const _IMG_EXTS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".svg",
  ".avif",
] as const;

export const PREVIEW_EXTS = [
  ".txt",
  ".md",
  ".mdx",
  ".markdown",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".json",
  ".css",
  ".html",
  ".xml",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".cfg",
  ".conf",
  ".log",
  ".csv",
  ".sh",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".c",
  ".cpp",
  ".h",
  ".swift",
  ".sql",
  ".env",
  ..._IMG_EXTS,
] as const;

export type FileKind =
  | "folder"
  | "image"
  | "video"
  | "audio"
  | "doc"
  | "sheet"
  | "code"
  | "archive"
  | "file";

/** 扩展名（小写、不含点）→ FileKind。未收录的一律降级为 "file"。 */
const EXT_KIND_MAP: Record<string, FileKind> = {
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  bmp: "image",
  svg: "image",
  avif: "image",
  ico: "image",
  mp4: "video",
  mov: "video",
  mkv: "video",
  webm: "video",
  avi: "video",
  m4v: "video",
  mp3: "audio",
  wav: "audio",
  m4a: "audio",
  aac: "audio",
  ogg: "audio",
  flac: "audio",
  md: "doc",
  markdown: "doc",
  mdx: "doc",
  txt: "doc",
  log: "doc",
  doc: "doc",
  docx: "doc",
  pdf: "doc",
  rtf: "doc",
  ppt: "doc",
  pptx: "doc",
  key: "doc",
  csv: "sheet",
  tsv: "sheet",
  xls: "sheet",
  xlsx: "sheet",
  ts: "code",
  tsx: "code",
  js: "code",
  jsx: "code",
  mjs: "code",
  cjs: "code",
  json: "code",
  css: "code",
  scss: "code",
  less: "code",
  html: "code",
  xml: "code",
  yaml: "code",
  yml: "code",
  toml: "code",
  ini: "code",
  cfg: "code",
  conf: "code",
  env: "code",
  sh: "code",
  bash: "code",
  zsh: "code",
  py: "code",
  rb: "code",
  go: "code",
  rs: "code",
  java: "code",
  c: "code",
  cpp: "code",
  h: "code",
  hpp: "code",
  swift: "code",
  sql: "code",
  lock: "code",
  zip: "archive",
  rar: "archive",
  "7z": "archive",
  tar: "archive",
  gz: "archive",
  bz2: "archive",
  xz: "archive",
  dmg: "archive",
};

/**
 * 解析文件名 / 裸扩展名 / 完整路径对应的文件类型。
 * 永不抛错、永不返回空：未识别一律 "file"。目录类型由调用方显式指定。
 */
export function getFileKind(nameOrExt: string): FileKind {
  const normalized = nameOrExt.trim().toLowerCase();
  const lastSeparator = Math.max(
    normalized.lastIndexOf("/"),
    normalized.lastIndexOf("\\"),
  );
  const basename =
    lastSeparator === -1 ? normalized : normalized.slice(lastSeparator + 1);
  const lastDot = basename.lastIndexOf(".");
  if (lastDot === -1 || lastDot === basename.length - 1) {
    return "file";
  }
  const kind = EXT_KIND_MAP[basename.slice(lastDot + 1)];
  // 必须用 typeof 而非 `?? "file"`：EXT_KIND_MAP 是普通对象字面量，
  // "constructor" / "toString" / "__proto__" / "valueOf" 等扩展名会命中
  // Object.prototype 的成员，`??` 拦不住（它们不是 null/undefined），
  // 会返回一个函数或对象，导致 TILE_GLYPHS[kind] 为 undefined、
  // glyphs.map 抛 TypeError——文件名为 a.constructor 即可触发。
  return typeof kind === "string" ? kind : "file";
}
