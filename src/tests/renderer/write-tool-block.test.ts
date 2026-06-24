import { describe, expect, it } from "vitest";
import {
  languageFromPath,
  formatSize,
  canHandleWriteInput,
} from "../../renderer/components/message/WriteToolBlock";

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

describe("canHandleWriteInput", () => {
  it("accepts valid input with path and string content", () => {
    expect(canHandleWriteInput({ path: "/src/foo.ts", content: "hello" })).toBe(
      true,
    );
  });

  it("accepts valid input with filePath alias", () => {
    expect(
      canHandleWriteInput({ filePath: "/src/bar.ts", content: "code" }),
    ).toBe(true);
  });

  it("accepts valid input with file_path alias", () => {
    expect(
      canHandleWriteInput({ file_path: "/src/baz.ts", content: "code" }),
    ).toBe(true);
  });

  it("accepts input without content field (content is optional)", () => {
    expect(canHandleWriteInput({ path: "/src/foo.ts" })).toBe(true);
  });

  it("rejects undefined input", () => {
    expect(canHandleWriteInput(undefined)).toBe(false);
  });

  it("rejects input with no path", () => {
    expect(canHandleWriteInput({ content: "hello" })).toBe(false);
  });

  it("rejects input with empty path", () => {
    expect(canHandleWriteInput({ path: "", content: "hello" })).toBe(false);
  });

  it("rejects input with whitespace-only path", () => {
    expect(canHandleWriteInput({ path: "   ", content: "hello" })).toBe(false);
  });

  it("rejects input with non-string content (object)", () => {
    expect(
      canHandleWriteInput({ path: "/src/foo.ts", content: { foo: 1 } }),
    ).toBe(false);
  });

  it("rejects input with non-string content (number)", () => {
    expect(canHandleWriteInput({ path: "/src/foo.ts", content: 42 })).toBe(
      false,
    );
  });

  it("rejects input with non-string content (null)", () => {
    expect(canHandleWriteInput({ path: "/src/foo.ts", content: null })).toBe(
      false,
    );
  });
});
