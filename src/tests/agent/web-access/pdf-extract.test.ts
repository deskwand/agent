import { describe, expect, it } from "vitest";
import { extractPDFToMarkdown } from "../../../main/agent/tools/web-access/pdf-extract";
import { makePdf } from "./test-fixtures";

describe("extractPDFToMarkdown", () => {
  it("extracts text in memory on Node 22", async () => {
    const result = await extractPDFToMarkdown(
      makePdf("Hello PDF"),
      "https://example.test/hello.pdf",
    );

    expect(result.content).toContain("Hello PDF");
    expect(result.pages).toBe(1);
    expect(result.title).toBe("hello");
  });
});
