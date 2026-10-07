import { describe, expect, it } from "vitest";

import { SOURCES, stripHtml } from "../../main/feed/sources/catalog";

describe("SOURCES", () => {
  it("id 唯一", () => {
    const ids = SOURCES.map((source) => source.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("URL 全部是 http(s) 绝对地址，maxItems 是正数", () => {
    for (const source of SOURCES) {
      expect(source.url, source.id).toMatch(/^https:\/\//);
      expect(source.maxItems, source.id).toBeGreaterThan(0);
    }
  });

  it("每条都有 parse 函数", () => {
    for (const source of SOURCES) {
      expect(typeof source.parse, source.id).toBe("function");
    }
  });
});

describe("stripHtml", () => {
  it("剥标签、解实体、压空白", () => {
    expect(stripHtml("<p>正文&nbsp;&amp; 更多</p>\n\n<div>x</div>")).toBe(
      "正文 & 更多 x",
    );
  });

  it("剥掉 script 与 style 的内容，不是只剥标签", () => {
    expect(stripHtml("a<script>var x=1;</script>b<style>p{}</style>c")).toBe(
      "a b c",
    );
  });
});
