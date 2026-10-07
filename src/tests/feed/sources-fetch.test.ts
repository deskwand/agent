import { describe, expect, it, vi } from "vitest";

import {
  parseDevTo,
  parseGitHub,
  parseHackerNews,
  parseHuggingFace,
  parseLobsters,
  parseRssFeed,
  parseStackExchange,
  SOURCES,
} from "../../main/feed/sources/catalog";
import {
  createTextFetcher,
  fetchSourceBuckets,
  SOURCE_TOTAL_BUDGET_MS,
} from "../../main/feed/sources/index";

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>T</title>
<item><title>条目一</title><link>https://e.com/a</link>
<description>&lt;p&gt;正文&lt;/p&gt;</description>
<pubDate>Wed, 07 Oct 2026 11:00:00 +0800</pubDate></item>
</channel></rss>`;

describe("parseRssFeed", () => {
  it("解析出标题、URL、纯文本片段与发布时间", () => {
    const items = parseRssFeed(RSS);
    expect(items).toHaveLength(1);
    expect(items?.[0]).toEqual({
      title: "条目一",
      url: "https://e.com/a",
      snippet: "正文",
      publishedAt: Date.parse("2026-10-07T03:00:00.000Z"),
    });
  });

  it("反爬 HTML 页返回 null（Review Focus 2）", () => {
    expect(parseRssFeed("<html><body><h1>x</h1></body></html>")).toBeNull();
  });

  it("空 channel 返回 null", () => {
    expect(
      parseRssFeed(
        `<?xml version="1.0"?><rss version="2.0"><channel><title>T</title></channel></rss>`,
      ),
    ).toBeNull();
  });
});

describe("JSON 源的字段映射", () => {
  it("Hacker News：Ask HN 没有外链时回落到讨论页", () => {
    const body = JSON.stringify({
      hits: [
        {
          title: "Ask HN: x",
          url: null,
          objectID: "123",
          story_text: "<p>hi</p>",
          created_at_i: 1_700_000_000,
        },
        {
          title: "Link",
          url: "https://e.com/a",
          objectID: "124",
          created_at_i: 1_700_000_001,
        },
      ],
    });
    const items = parseHackerNews(body);
    expect(items?.[0]).toEqual({
      title: "Ask HN: x",
      url: "https://news.ycombinator.com/item?id=123",
      snippet: "hi",
      publishedAt: 1_700_000_000_000,
    });
    expect(items?.[1].url).toBe("https://e.com/a");
  });

  it("HuggingFace：用 paper.id 拼出论文页地址", () => {
    const body = JSON.stringify([
      {
        title: "P",
        summary: "S",
        publishedAt: "2026-10-02T20:00:00.000Z",
        paper: { id: "2610.04596" },
      },
    ]);
    expect(parseHuggingFace(body)?.[0]).toEqual({
      title: "P",
      url: "https://huggingface.co/papers/2610.04596",
      snippet: "S",
      publishedAt: Date.parse("2026-10-02T20:00:00.000Z"),
    });
  });

  it("Lobsters：没有外链时回落到评论页", () => {
    const body = JSON.stringify([
      {
        title: "L",
        url: "",
        comments_url: "https://lobste.rs/s/x",
        description_plain: "d",
        created_at: "2026-10-06T17:26:46.902-05:00",
      },
    ]);
    expect(parseLobsters(body)?.[0].url).toBe("https://lobste.rs/s/x");
  });

  it("DEV.to：读 published_timestamp", () => {
    const body = JSON.stringify([
      {
        title: "D",
        url: "https://dev.to/a",
        description: "d",
        published_timestamp: "2026-10-05T15:09:58Z",
      },
    ]);
    expect(parseDevTo(body)?.[0]).toEqual({
      title: "D",
      url: "https://dev.to/a",
      snippet: "d",
      publishedAt: Date.parse("2026-10-05T15:09:58Z"),
    });
  });

  it("StackExchange：从 items 里取，snippet 是空串（默认 filter 不返回正文）", () => {
    const body = JSON.stringify({
      items: [
        {
          title: "Q",
          link: "https://stackoverflow.com/q/1",
          creation_date: 1_700_000_000,
        },
      ],
    });
    expect(parseStackExchange(body)?.[0]).toEqual({
      title: "Q",
      url: "https://stackoverflow.com/q/1",
      snippet: "",
      publishedAt: 1_700_000_000_000,
    });
  });

  it("GitHub：标题用 full_name，片段带上语言", () => {
    const body = JSON.stringify({
      items: [
        {
          full_name: "a/b",
          html_url: "https://github.com/a/b",
          description: "d",
          language: "Rust",
          pushed_at: "2026-10-06T00:00:00Z",
        },
      ],
    });
    expect(parseGitHub(body)?.[0]).toEqual({
      title: "a/b",
      url: "https://github.com/a/b",
      snippet: "d · language: Rust",
      publishedAt: Date.parse("2026-10-06T00:00:00Z"),
    });
  });

  it("JSON 坏了返回 null 而不是抛", () => {
    expect(parseHackerNews("<html>")).toBeNull();
    expect(parseGitHub("not json")).toBeNull();
  });
});

describe("fetchSourceBuckets", () => {
  it("一个源失败不影响其他源（Review Focus 2）", async () => {
    const buckets = await fetchSourceBuckets({
      fetchText: async (url) => {
        if (url.includes("hackernews")) throw new Error("boom");
        if (url.includes("sspai")) return RSS;
        return null;
      },
    });
    const byId = new Map(buckets.map((bucket) => [bucket.id, bucket.items]));
    expect(byId.get("hackernews")).toEqual([]);
    expect(byId.get("sspai")).toHaveLength(1);
    expect(buckets).toHaveLength(SOURCES.length);
  });

  it("丢了标题的条目在这里被滤掉；没外链的已回落到讨论页", async () => {
    const buckets = await fetchSourceBuckets({
      fetchText: async () =>
        JSON.stringify({
          hits: [
            { title: "", url: "https://e.com/a", objectID: "1" },
            { title: "Ask HN", url: null, objectID: "2" },
            { title: "好的", url: "https://e.com/c", objectID: "3" },
          ],
        }),
    });
    const hn = buckets.find((bucket) => bucket.id === "hackernews");
    expect(hn?.items.map((item) => item.title)).toEqual(["Ask HN", "好的"]);
  });

  it("每个源按 maxItems 截断", async () => {
    const many = JSON.stringify({
      hits: Array.from({ length: 40 }, (_, index) => ({
        title: `t${index}`,
        url: `https://e.com/${index}`,
        objectID: `${index}`,
      })),
    });
    const buckets = await fetchSourceBuckets({ fetchText: async () => many });
    const hn = buckets.find((bucket) => bucket.id === "hackernews");
    expect(hn?.items).toHaveLength(20);
  });
});

describe("createTextFetcher", () => {
  const options = { timeoutMs: 1000, maxBytes: 100 };

  it("content-length 超限时直接放弃（Review Focus 5）", async () => {
    const fetchText = createTextFetcher(
      async () =>
        new Response("x".repeat(10), {
          status: 200,
          headers: { "content-length": "99999999" },
        }),
      options,
    );
    expect(await fetchText("https://e.com/a")).toBeNull();
  });

  it("没声明长度但正文超限时也放弃 —— 不能把半截 XML 交给解析器", async () => {
    const fetchText = createTextFetcher(
      async () => new Response("x".repeat(5000), { status: 200 }),
      options,
    );
    expect(await fetchText("https://e.com/a")).toBeNull();
  });

  it("正常大小原样返回", async () => {
    const fetchText = createTextFetcher(
      async () => new Response("ok", { status: 200 }),
      options,
    );
    expect(await fetchText("https://e.com/a")).toBe("ok");
  });

  it("非 2xx 与网络抛错都返回 null", async () => {
    const forbidden = createTextFetcher(
      async () => new Response("nope", { status: 403 }),
      options,
    );
    expect(await forbidden("https://e.com/a")).toBeNull();

    const broken = createTextFetcher(async () => {
      throw new Error("boom");
    }, options);
    expect(await broken("https://e.com/a")).toBeNull();
  });
});

describe("整体时间预算", () => {
  it("超预算时带着已经回来的源先走，不等挂住的那几个", async () => {
    vi.useFakeTimers();
    try {
      const pending = fetchSourceBuckets({
        // 除了第一个源，其余全部永久挂住
        fetchText: async (url) =>
          url.includes("sspai") ? RSS : new Promise<string>(() => {}),
      });
      await vi.advanceTimersByTimeAsync(SOURCE_TOTAL_BUDGET_MS + 1);
      const buckets = await pending;
      expect(
        buckets.find((bucket) => bucket.id === "sspai")?.items,
      ).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
