import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_HASH_MAX_BYTES,
  attachmentDestFilename,
  attachmentSuffix,
} from "../../main/session/session-manager";

describe("attachmentDestFilename", () => {
  it("keeps stem, suffix and extension", () => {
    expect(attachmentDestFilename("report.pdf", "7f3a91c2")).toBe(
      "report-7f3a91c2.pdf",
    );
  });

  it("handles names without extension", () => {
    expect(attachmentDestFilename("Makefile", "ab12cd34")).toBe(
      "Makefile-ab12cd34",
    );
  });

  it("treats a dotfile as stem-only", () => {
    expect(attachmentDestFilename(".env", "ab12cd34")).toBe(".env-ab12cd34");
  });

  it("only strips the last extension of a double extension", () => {
    expect(attachmentDestFilename("archive.tar.gz", "ab12cd34")).toBe(
      "archive.tar-ab12cd34.gz",
    );
  });
});

describe("attachmentSuffix", () => {
  it("uses the first 8 chars of the content hash for small files", () => {
    expect(attachmentSuffix(10, () => "7f3a91c2deadbeef", "uuid-1")).toBe(
      "7f3a91c2",
    );
  });

  it("hashes a file exactly at the cap", () => {
    expect(
      attachmentSuffix(ATTACHMENT_HASH_MAX_BYTES, () => "abcdef1234", "uuid-1"),
    ).toBe("abcdef12");
  });

  it("falls back to uuid above the cap without reading content", () => {
    expect(
      attachmentSuffix(
        ATTACHMENT_HASH_MAX_BYTES + 1,
        () => {
          throw new Error("content must not be read");
        },
        "uuid-1",
      ),
    ).toBe("uuid-1");
  });
});
