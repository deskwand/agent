import { describe, expect, it } from "vitest";
import {
  isOfficePreviewExt,
  OFFICE_EXTS,
} from "../../renderer/utils/file-preview";

describe("isOfficePreviewExt", () => {
  it("accepts the three OOXML extensions", () => {
    expect(OFFICE_EXTS).toEqual([".docx", ".xlsx", ".pptx"]);
    for (const ext of OFFICE_EXTS) {
      expect(isOfficePreviewExt(ext)).toBe(true);
    }
  });

  it("requires a dotted lowercase extension", () => {
    expect(isOfficePreviewExt("docx")).toBe(false);
    expect(isOfficePreviewExt(".DOCX")).toBe(false);
    expect(isOfficePreviewExt("")).toBe(false);
  });

  it("does not claim the legacy binary formats", () => {
    // officecli only understands OOXML; .doc/.xls/.ppt must keep going to the
    // system opener.
    expect(isOfficePreviewExt(".doc")).toBe(false);
    expect(isOfficePreviewExt(".xls")).toBe(false);
    expect(isOfficePreviewExt(".ppt")).toBe(false);
  });

  it("does not claim other preview or browser types", () => {
    expect(isOfficePreviewExt(".pdf")).toBe(false);
    expect(isOfficePreviewExt(".md")).toBe(false);
    expect(isOfficePreviewExt(".html")).toBe(false);
  });
});
