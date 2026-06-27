import { describe, expect, it } from "vitest";
import { getCodeRenderMode } from "../../renderer/components/message/ContentBlockView";

describe("getCodeRenderMode", () => {
  describe("isInline detection", () => {
    it("renders single-line plain text as inline code", () => {
      const result = getCodeRenderMode(undefined, "hello");
      expect(result.isInline).toBe(true);
      expect(result.codeContent).toBe("hello");
    });

    it("renders single-line with language specifier as code block", () => {
      const result = getCodeRenderMode("language-js", "const x = 1;");
      expect(result.isInline).toBe(false);
    });

    it("renders multi-line plain text as code block (multi-line = fenced code)", () => {
      const result = getCodeRenderMode(undefined, "line1\nline2\nline3");
      expect(result.isInline).toBe(false);
    });

    it("renders multi-line with language specifier as code block", () => {
      const result = getCodeRenderMode("language-python", "a = 1\nb = 2");
      expect(result.isInline).toBe(false);
    });

    it("renders URL list (multi-line, no language) as code block", () => {
      const result = getCodeRenderMode(undefined, "https://a.com\nhttps://b.com");
      expect(result.isInline).toBe(false);
    });

    it("handles leading newline in code content (multi-line)", () => {
      const result = getCodeRenderMode(undefined, "\nhttps://example.com\nhttps://example2.com");
      expect(result.isInline).toBe(false);
    });

    it("handles non-string children", () => {
      const result = getCodeRenderMode(undefined, 123);
      expect(result.isInline).toBe(true);
      expect(result.codeContent).toBe("123");
    });

  });

  describe("codeContent extraction", () => {
    it("passes through string children unchanged", () => {
      const result = getCodeRenderMode(undefined, " git status ");
      expect(result.codeContent).toBe(" git status ");
    });

    it("preserves leading/trailing spaces in inline code", () => {
      // inline code like ` code ` should preserve its spaces
      const result = getCodeRenderMode(undefined, " code ");
      expect(result.codeContent).toBe(" code ");
    });
  });
});
