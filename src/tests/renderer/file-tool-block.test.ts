import { describe, expect, it } from "vitest";
import {
  languageFromPath,
  formatSize,
  canHandleFileInput,
  stripLineNumbers,
} from "../../renderer/components/message/FileToolBlock";

describe("languageFromPath", () => {
  it("returns typescript for .ts and .tsx", () => {
    expect(languageFromPath("/src/foo.ts")).toBe("typescript");
    expect(languageFromPath("/src/foo.tsx")).toBe("typescript");
  });

  it("returns javascript for .js and .jsx", () => {
    expect(languageFromPath("app.js")).toBe("javascript");
    expect(languageFromPath("app.jsx")).toBe("javascript");
  });

  it("returns python for .py", () => {
    expect(languageFromPath("main.py")).toBe("python");
  });

  it("returns json for .json", () => {
    expect(languageFromPath("config.json")).toBe("json");
  });

  it("returns css for .css", () => {
    expect(languageFromPath("styles.css")).toBe("css");
  });

  it("returns markdown for .md", () => {
    expect(languageFromPath("README.md")).toBe("markdown");
  });

  it("returns xml for .html and .svg", () => {
    expect(languageFromPath("index.html")).toBe("xml");
    expect(languageFromPath("icon.svg")).toBe("xml");
  });

  it("returns yaml for .yaml and .yml", () => {
    expect(languageFromPath("docker-compose.yaml")).toBe("yaml");
    expect(languageFromPath("docker-compose.yml")).toBe("yaml");
  });

  it("returns bash for .sh", () => {
    expect(languageFromPath("setup.sh")).toBe("bash");
  });

  it("returns the extension itself for unknown extensions", () => {
    expect(languageFromPath("Dockerfile")).toBe("text");
    expect(languageFromPath("file.unknown")).toBe("unknown");
  });

  it("returns text for paths with no extension", () => {
    expect(languageFromPath("Makefile")).toBe("text");
    expect(languageFromPath("/usr/bin/script")).toBe("text");
  });
});

describe("formatSize", () => {
  it("formats bytes below 1024 as B", () => {
    expect(formatSize(0)).toBe("0 B");
    expect(formatSize(1)).toBe("1 B");
    expect(formatSize(1023)).toBe("1023 B");
  });

  it("formats bytes at and above 1024 as KB", () => {
    expect(formatSize(1024)).toBe("1.0 KB");
    expect(formatSize(1536)).toBe("1.5 KB");
    expect(formatSize(1023 * 1024)).toBe("1023.0 KB");
  });

  it("formats bytes at and above 1 MB as MB", () => {
    expect(formatSize(1024 * 1024)).toBe("1.0 MB");
    expect(formatSize(1536 * 1024)).toBe("1.5 MB");
  });
});

describe("canHandleFileInput", () => {
  it("accepts valid input with path and string content", () => {
    expect(canHandleFileInput({ path: "/src/foo.ts", content: "hello" })).toBe(
      true,
    );
  });

  it("accepts valid input with filePath alias", () => {
    expect(
      canHandleFileInput({ filePath: "/src/bar.ts", content: "code" }),
    ).toBe(true);
  });

  it("accepts valid input with file_path alias", () => {
    expect(
      canHandleFileInput({ file_path: "/src/baz.ts", content: "code" }),
    ).toBe(true);
  });

  it("accepts input without content field (content is optional)", () => {
    expect(canHandleFileInput({ path: "/src/foo.ts" })).toBe(true);
  });

  it("rejects undefined input", () => {
    expect(canHandleFileInput(undefined)).toBe(false);
  });

  it("rejects input with no path", () => {
    expect(canHandleFileInput({ content: "hello" })).toBe(false);
  });

  it("rejects input with empty path", () => {
    expect(canHandleFileInput({ path: "", content: "hello" })).toBe(false);
  });

  it("rejects input with whitespace-only path", () => {
    expect(canHandleFileInput({ path: "   ", content: "hello" })).toBe(false);
  });

  it("rejects input with non-string content (object)", () => {
    expect(
      canHandleFileInput({ path: "/src/foo.ts", content: { foo: 1 } }),
    ).toBe(false);
  });

  it("rejects input with non-string content (number)", () => {
    expect(canHandleFileInput({ path: "/src/foo.ts", content: 42 })).toBe(
      false,
    );
  });

  it("rejects input with non-string content (null)", () => {
    expect(canHandleFileInput({ path: "/src/foo.ts", content: null })).toBe(
      false,
    );
  });
});

describe("stripLineNumbers", () => {
  it("removes line number prefixes with tab separator", () => {
    const input = "  1\timport React\n  2\tconst x = 1\n";
    expect(stripLineNumbers(input)).toBe("import React\nconst x = 1\n");
  });

  it("removes line number prefixes with space separator", () => {
    const input = "  1 import React\n   2 const x = 1\n";
    expect(stripLineNumbers(input)).toBe("import React\nconst x = 1\n");
  });

  it("handles multi-digit line numbers", () => {
    const input = " 99\tline 99\n100\tline 100\n";
    expect(stripLineNumbers(input)).toBe("line 99\nline 100\n");
  });

  it("keeps lines without line numbers unchanged", () => {
    const input = "plain text\nmore text\n";
    expect(stripLineNumbers(input)).toBe("plain text\nmore text\n");
  });

  it("handles empty input", () => {
    expect(stripLineNumbers("")).toBe("");
  });

  it("keeps content where number is immediately followed by non-whitespace", () => {
    // "42_answer" — the number is part of code, no whitespace separator
    const input = "42_answer\n";
    expect(stripLineNumbers(input)).toBe("42_answer\n");
  });
});
