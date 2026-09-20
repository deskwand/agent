// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extOf,
  resolveFileReferencePath,
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

describe("resolveFileReferencePath", () => {
  afterEach(() => {
    Reflect.deleteProperty(
      window as unknown as Record<string, unknown>,
      "electronAPI",
    );
  });

  it("uses the main-process result when the IPC is available", async () => {
    const resolveReference = vi.fn(async () => "/ws/test_docs/report.docx");
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: { file: { resolveReference } },
    });

    await expect(resolveFileReferencePath("report.docx", "/ws")).resolves.toBe(
      "/ws/test_docs/report.docx",
    );
    expect(resolveReference).toHaveBeenCalledWith("report.docx", "/ws");
  });

  it("falls back to local workspace resolution when the IPC is missing", async () => {
    // 生产环境不会走到：preload 一定在。这是为了让 helper 能脱离 IPC 单测。
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: {},
    });

    await expect(resolveFileReferencePath("report.docx", "/ws")).resolves.toBe(
      "/ws/report.docx",
    );
  });

  it("falls back to local resolution when the IPC throws", async () => {
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: {
        file: {
          resolveReference: vi.fn(async () => {
            throw new Error("ipc down");
          }),
        },
      },
    });

    await expect(resolveFileReferencePath("report.docx", "/ws")).resolves.toBe(
      "/ws/report.docx",
    );
  });
});
