import { describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { extractLeadImageUrl } from "../../../main/agent/tools/web-access/extract";

function doc(head: string) {
  return parseHTML(`<html><head>${head}</head><body></body></html>`)
    .document as unknown as Document;
}

describe("extractLeadImageUrl", () => {
  it("优先取 og:image", () => {
    expect(
      extractLeadImageUrl(
        doc(
          '<meta property="og:image" content="https://cdn.example.com/a.jpg"><meta name="twitter:image" content="https://cdn.example.com/b.jpg">',
        ),
      ),
    ).toBe("https://cdn.example.com/a.jpg");
  });

  it("没有 og:image 时退到 twitter:image", () => {
    expect(
      extractLeadImageUrl(
        doc(
          '<meta name="twitter:image" content="https://cdn.example.com/b.jpg">',
        ),
      ),
    ).toBe("https://cdn.example.com/b.jpg");
  });

  it("都没有时返回 undefined", () => {
    expect(extractLeadImageUrl(doc("<title>t</title>"))).toBeUndefined();
  });

  it("跳过空白值", () => {
    expect(
      extractLeadImageUrl(doc('<meta property="og:image" content="   ">')),
    ).toBeUndefined();
  });

  it("相对路径直接丢弃", () => {
    expect(
      extractLeadImageUrl(
        doc('<meta property="og:image" content="/img/a.jpg">'),
      ),
    ).toBeUndefined();
  });

  it("只接受 http/https", () => {
    expect(
      extractLeadImageUrl(
        doc('<meta property="og:image" content="javascript:alert(1)">'),
      ),
    ).toBeUndefined();
  });
});
