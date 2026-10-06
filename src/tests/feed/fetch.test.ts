import { describe, expect, it, vi } from "vitest";
import type { ExtractedContent } from "../../main/agent/tools/web-access/types";
import {
  BODY_MAX_CHARS,
  fetchCandidateBodies,
} from "../../main/feed/feed-fetch";
import type { FeedCandidate } from "../../main/feed/feed-collect";

const candidates: FeedCandidate[] = [
  {
    id: 0,
    title: "A",
    url: "https://a.com/1",
    urlKey: "a.com/1",
    host: "a.com",
    snippet: "片段 A",
    topic: "T",
    reason: "r",
  },
  {
    id: 1,
    title: "B",
    url: "https://b.com/1",
    urlKey: "b.com/1",
    host: "b.com",
    snippet: "片段 B",
    topic: "T",
    reason: "r",
  },
];

function page(url: string, content: string, imageUrl?: string): ExtractedContent {
  return { url, title: "t", content, error: null, imageUrl };
}

describe("fetchCandidateBodies", () => {
  it("抓到正文时 body_status = ok，并带上图 URL", async () => {
    const fetchPages = vi
      .fn()
      .mockResolvedValue([
        page("https://a.com/1", "正".repeat(200), "https://a.com/cover.jpg"),
        page("https://b.com/1", "正".repeat(200)),
      ]);
    const out = await fetchCandidateBodies({ candidates, fetchPages });
    expect(out[0].bodyStatus).toBe("ok");
    expect(out[0].imageUrl).toBe("https://a.com/cover.jpg");
  });

  it("正文超过 3000 字符被截断", async () => {
    const fetchPages = vi
      .fn()
      .mockResolvedValue([
        page("https://a.com/1", "字".repeat(BODY_MAX_CHARS + 500)),
      ]);
    const out = await fetchCandidateBodies({
      candidates: [candidates[0]],
      fetchPages,
    });
    expect(out[0].body).toHaveLength(BODY_MAX_CHARS);
  });

  it("抓取失败时退化为搜索片段，条目不丢", async () => {
    const fetchPages = vi
      .fn()
      .mockResolvedValue([
        { url: "https://a.com/1", title: "", content: "", error: "403" },
      ]);
    const out = await fetchCandidateBodies({
      candidates: [candidates[0]],
      fetchPages,
    });
    expect(out[0].bodyStatus).toBe("snippet_only");
    expect(out[0].body).toBe("片段 A");
  });

  it("正文太短也走片段，避免拿半截正文写摘要", async () => {
    const fetchPages = vi
      .fn()
      .mockResolvedValue([page("https://a.com/1", "很短")]);
    const out = await fetchCandidateBodies({
      candidates: [candidates[0]],
      fetchPages,
    });
    expect(out[0].bodyStatus).toBe("snippet_only");
  });

  it("片段也空时 body 为 null（调用方据此丢弃该条）", async () => {
    const fetchPages = vi
      .fn()
      .mockResolvedValue([
        { url: "https://a.com/1", title: "", content: "", error: "x" },
      ]);
    const out = await fetchCandidateBodies({
      candidates: [{ ...candidates[0], snippet: "" }],
      fetchPages,
    });
    expect(out[0].body).toBeNull();
  });

  it("fetchPages 整个抛错时不抛，全部退化为片段", async () => {
    const fetchPages = vi.fn().mockRejectedValue(new Error("网络断了"));
    const out = await fetchCandidateBodies({ candidates, fetchPages });
    expect(out.map((item) => item.bodyStatus)).toEqual([
      "snippet_only",
      "snippet_only",
    ]);
  });

  it("返回顺序与候选顺序一致（后面靠 id 对号入座）", async () => {
    const fetchPages = vi
      .fn()
      .mockResolvedValue([
        page("https://b.com/1", "B 正文"),
        page("https://a.com/1", "A 正文"),
      ]);
    const out = await fetchCandidateBodies({ candidates, fetchPages });
    expect(out.map((item) => item.id)).toEqual([0, 1]);
    expect(out[0].body).toContain("片段 A");
  });

  it("候选为空时不调 fetchPages", async () => {
    const fetchPages = vi.fn();
    expect(await fetchCandidateBodies({ candidates: [], fetchPages })).toEqual(
      [],
    );
    expect(fetchPages).not.toHaveBeenCalled();
  });
});
