import { describe, expect, it } from "vitest";
import { getFileKind } from "../src/renderer/utils/file-types";

describe("getFileKind", () => {
  it("maps every kind to more than one extension", () => {
    expect(getFileKind("photo.png")).toBe("image");
    expect(getFileKind("photo.svg")).toBe("image");
    expect(getFileKind("clip.mp4")).toBe("video");
    expect(getFileKind("clip.mkv")).toBe("video");
    expect(getFileKind("track.mp3")).toBe("audio");
    expect(getFileKind("track.flac")).toBe("audio");
    expect(getFileKind("notes.md")).toBe("doc");
    expect(getFileKind("notes.mdx")).toBe("doc");
    expect(getFileKind("report.pdf")).toBe("doc");
    expect(getFileKind("report.xlsx")).toBe("sheet");
    expect(getFileKind("data.csv")).toBe("sheet");
    expect(getFileKind("app.tsx")).toBe("code");
    expect(getFileKind("config.yaml")).toBe("code");
    expect(getFileKind("bundle.zip")).toBe("archive");
    expect(getFileKind("bundle.tar.gz")).toBe("archive");
  });

  it("falls back to file for unknown or missing extensions", () => {
    expect(getFileKind("Makefile")).toBe("file");
    expect(getFileKind("archive.bin")).toBe("file");
    expect(getFileKind("")).toBe("file");
    expect(getFileKind(".")).toBe("file");
    expect(getFileKind("name.")).toBe("file");
  });

  it("is case insensitive", () => {
    expect(getFileKind(".PNG")).toBe("image");
    expect(getFileKind("REPORT.XLSX")).toBe("sheet");
  });

  it("treats a dotfile with a known extension as that type", () => {
    expect(getFileKind(".env")).toBe("code");
  });

  it("accepts both a filename and a bare extension", () => {
    expect(getFileKind("App.tsx")).toBe("code");
    expect(getFileKind(".tsx")).toBe("code");
    expect(getFileKind("App.tsx")).toBe(getFileKind(".tsx"));
  });

  it("takes the basename before resolving the extension", () => {
    expect(getFileKind("/a/b/App.tsx")).toBe("code");
    expect(getFileKind("C:\\a\\b\\App.tsx")).toBe("code");
    expect(getFileKind("/a.b/c/dir")).toBe("file");
  });

  it("never returns an inherited Object.prototype member as a kind", () => {
    for (const ext of [
      "constructor",
      "toString",
      "valueOf",
      "__proto__",
      "hasOwnProperty",
      "isPrototypeOf",
      "propertyIsEnumerable",
      "toLocaleString",
    ]) {
      expect(getFileKind(`a.${ext}`)).toBe("file");
    }
  });

  it("never returns folder, which only the caller can know", () => {
    expect(getFileKind("folder")).toBe("file");
    expect(getFileKind("components")).toBe("file");
    expect(getFileKind("folder.tsx")).toBe("code");
  });
});

/** 与设计文档 §5 的映射表一一对应的独立副本，用于锁死键名拼写。 */
const SPEC_EXTENSIONS: Record<string, string[]> = {
  image: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif", "ico"],
  video: ["mp4", "mov", "mkv", "webm", "avi", "m4v"],
  audio: ["mp3", "wav", "m4a", "aac", "ogg", "flac"],
  doc: [
    "md",
    "markdown",
    "mdx",
    "txt",
    "log",
    "doc",
    "docx",
    "pdf",
    "rtf",
    "ppt",
    "pptx",
    "key",
  ],
  sheet: ["csv", "tsv", "xls", "xlsx"],
  code: [
    "ts",
    "tsx",
    "js",
    "jsx",
    "mjs",
    "cjs",
    "json",
    "css",
    "scss",
    "less",
    "html",
    "xml",
    "yaml",
    "yml",
    "toml",
    "ini",
    "cfg",
    "conf",
    "env",
    "sh",
    "bash",
    "zsh",
    "py",
    "rb",
    "go",
    "rs",
    "java",
    "c",
    "cpp",
    "h",
    "hpp",
    "swift",
    "sql",
    "lock",
  ],
  archive: ["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "dmg"],
};

describe("getFileKind extension table", () => {
  it("pins every extension listed in the spec", () => {
    const actual: Record<string, string> = {};
    for (const [kind, exts] of Object.entries(SPEC_EXTENSIONS)) {
      for (const ext of exts) {
        actual[ext] = getFileKind(`file.${ext}`);
      }
    }
    const expected = Object.fromEntries(
      Object.entries(SPEC_EXTENSIONS).flatMap(([kind, exts]) =>
        exts.map((ext) => [ext, kind]),
      ),
    );
    expect(actual).toEqual(expected);
  });
});
