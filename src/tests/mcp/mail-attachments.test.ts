import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  attachmentMetadataFromStructure,
  MAX_SOURCE_BYTES,
  saveAttachmentFromSource,
} from "../../main/mcp/mail/attachments";

/** 一封带一个附件的最小 RFC822。 */
function rawMessage(filename: string, body = "hello"): Buffer {
  return Buffer.from(
    [
      "From: sender@example.com",
      "To: me@qq.com",
      "Subject: report",
      "MIME-Version: 1.0",
      'Content-Type: multipart/mixed; boundary="B"',
      "",
      "--B",
      "Content-Type: text/plain; charset=utf-8",
      "",
      body,
      "",
      "--B",
      `Content-Type: application/pdf; name="${filename}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${filename}"`,
      "",
      Buffer.from("%PDF-1.4 fake").toString("base64"),
      "",
      "--B--",
      "",
    ].join("\r\n"),
  );
}

describe("attachment metadata", () => {
  it("reads filenames and sizes from bodyStructure without fetching the source", () => {
    const structure = {
      childNodes: [
        { part: "1", type: "text/plain", size: 5 },
        {
          part: "2",
          type: "application/pdf",
          size: 12,
          disposition: "attachment",
          dispositionParameters: { filename: "报告.pdf" },
        },
      ],
    };
    expect(attachmentMetadataFromStructure(structure)).toEqual([
      { filename: "报告.pdf", contentType: "application/pdf", size: 12 },
    ]);
  });

  it("returns an empty list for a message without attachments", () => {
    expect(attachmentMetadataFromStructure({ part: "1", type: "text/plain" })).toEqual([]);
    expect(attachmentMetadataFromStructure(undefined)).toEqual([]);
  });
});

describe("saveAttachmentFromSource", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "mail-att-"));
  });

  it("writes the attachment under root/<email>/ and returns the path", async () => {
    const result = await saveAttachmentFromSource({
      source: rawMessage("报告.pdf"),
      root,
      email: "zhangsan@qq.com",
      index: 0,
      taken: new Set<string>(),
    });
    expect(result.path).toBe(path.join(root, "zhangsan@qq.com", "报告.pdf"));
    expect(fs.readFileSync(result.path, "utf8")).toBe("%PDF-1.4 fake");
    expect(result.size).toBe(Buffer.byteLength("%PDF-1.4 fake"));
  });

  it("ignores the traversal a hostile sender puts in Content-Disposition", async () => {
    const result = await saveAttachmentFromSource({
      source: rawMessage("../../../../etc/passwd"),
      root,
      email: "a@qq.com",
      index: 0,
      taken: new Set<string>(),
    });
    expect(result.path).toBe(path.join(root, "a@qq.com", "passwd"));
    expect(result.path.startsWith(root + path.sep)).toBe(true);
  });

  it("writes into a relative subdirectory when one is given", async () => {
    const result = await saveAttachmentFromSource({
      source: rawMessage("报告.pdf"),
      root,
      email: "a@qq.com",
      index: 0,
      taken: new Set<string>(),
      subdir: "invoices/2026",
    });
    expect(result.path).toBe(path.join(root, "a@qq.com", "invoices/2026", "报告.pdf"));
    expect(fs.readFileSync(result.path, "utf8")).toBe("%PDF-1.4 fake");
  });

  it("refuses a subdirectory that escapes the root", async () => {
    await expect(
      saveAttachmentFromSource({
        source: rawMessage("报告.pdf"),
        root,
        email: "a@qq.com",
        index: 0,
        taken: new Set<string>(),
        subdir: "../../escape",
      }),
    ).rejects.toThrow(/escapes the attachment root/);
  });

  it("rejects an out-of-range index", async () => {
    await expect(
      saveAttachmentFromSource({
        source: rawMessage("a.pdf"),
        root,
        email: "a@qq.com",
        index: 5,
        taken: new Set<string>(),
      }),
    ).rejects.toThrow(/index/i);
  });

  it("exposes the source size ceiling as a named constant", () => {
    expect(MAX_SOURCE_BYTES).toBe(25 * 1024 * 1024);
  });
});
