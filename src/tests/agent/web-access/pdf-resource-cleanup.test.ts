import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  destroy: vi.fn(async () => undefined),
  getDocumentProxy: vi.fn(),
}));

vi.mock("unpdf", () => ({
  getDocumentProxy: mocks.getDocumentProxy,
}));

import { extractPDFToMarkdown } from "../../../main/agent/tools/web-access/pdf-extract";

describe("PDF extraction cleanup", () => {
  it("destroys the PDF document when page extraction fails", async () => {
    mocks.getDocumentProxy.mockResolvedValueOnce({
      numPages: 1,
      getMetadata: async () => ({ info: {} }),
      getPage: async () => {
        throw new Error("Malformed page");
      },
      destroy: mocks.destroy,
    });

    await expect(
      extractPDFToMarkdown(
        new Uint8Array([1, 2, 3]).buffer,
        "https://example.com/broken.pdf",
      ),
    ).rejects.toThrow("Malformed page");
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });
});
