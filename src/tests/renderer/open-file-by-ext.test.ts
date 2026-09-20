import { describe, expect, it } from "vitest";
import {
  extOf,
  resolveOpenAction,
} from "../../renderer/utils/open-file-by-ext";

describe("extOf", () => {
  it("lowercases the extension of a bare name", () => {
    expect(extOf("Report.DOCX")).toBe(".docx");
  });

  it("works on a path with directories", () => {
    expect(extOf("/repo/docs/Q3 report.XLSX")).toBe(".xlsx");
  });

  it("returns empty string when there is no extension", () => {
    expect(extOf("Makefile")).toBe("");
    expect(extOf("")).toBe("");
  });

  it("treats a leading dot as no extension", () => {
    expect(extOf(".gitignore")).toBe("");
  });
});

describe("resolveOpenAction", () => {
  it("sends browser-openable types to the built-in browser", () => {
    for (const ext of [".html", ".pdf", ".mp3"]) {
      expect(resolveOpenAction(ext)).toBe("browser");
    }
  });

  it("sends previewable types to the preview panel", () => {
    for (const ext of [".md", ".txt", ".png", ".csv"]) {
      expect(resolveOpenAction(ext)).toBe("preview");
    }
  });

  it("sends office types to the office renderer", () => {
    for (const ext of [".docx", ".xlsx", ".pptx"]) {
      expect(resolveOpenAction(ext)).toBe("office");
    }
  });

  it("falls back for everything else", () => {
    for (const ext of [".zip", ".doc", ".exe", ""]) {
      expect(resolveOpenAction(ext)).toBe("fallback");
    }
  });

  it("keeps the existing precedence: browser and preview win over office", () => {
    // Guards the ordering: if an extension were ever added to two lists, the
    // pre-existing behaviour must not shift.
    expect(resolveOpenAction(".pdf")).toBe("browser");
    expect(resolveOpenAction(".csv")).toBe("preview");
  });
});
