import { describe, expect, it } from "vitest";
import type { QueryResultData } from "../../main/agent/tools/web-access/types";
import {
  CANDIDATE_LIMIT,
  collectCandidates,
  normalizeTitle,
  normalizeUrlKey,
} from "../../main/feed/feed-collect";
import type { FeedQuery } from "../../main/feed/feed-queries";

const queries: FeedQuery[] = [
  { q: "q1", topic: "T1", reason: "r1" },
  { q: "q2", topic: "T2", reason: "r2" },
];

function result(query: string, urls: string[]): QueryResultData {
  return {
    query,
    answer: "",
    error: null,
    results: urls.map((url, index) => ({
      url,
      title: `${query} 标题 ${index}`,
      snippet: "片段",
    })),
  };
}

describe("normalizeUrlKey", () => {
  it("去掉追踪参数、锚点、末尾斜杠，host 转小写", () => {
    expect(
      normalizeUrlKey("HTTPS://Example.COM/a/b/?utm_source=x&utm_medium=y#top"),
    ).toBe("example.com/a/b");
  });

  it("保留有意义查询参数并对参数排序", () => {
    expect(normalizeUrlKey("https://e.com/s?b=2&a=1")).toBe("e.com/s?a=1&b=2");
  });

  it("非法 URL 与非 http(s) 返回 null", () => {
    expect(normalizeUrlKey("not a url")).toBeNull();
    expect(normalizeUrlKey("javascript:alert(1)")).toBeNull();
  });
});

describe("normalizeTitle", () => {
  it("去掉标点与空白、转小写", () => {
    expect(normalizeTitle("Hello， World!")).toBe("helloworld");
  });
});

describe("collectCandidates", () => {
  it("按 query 顺序轮流取，主题分布均匀", () => {
    const results = [
      result("q1", ["https://a.com/1", "https://a.com/2", "https://a.com/3"]),
      result("q2", ["https://b.com/1", "https://b.com/2"]),
    ];
    const candidates = collectCandidates({
      results,
      queries,
      knownUrlKeys: new Set(),
    });
    expect(candidates.map((item) => item.host)).toEqual([
      "a.com",
      "b.com",
      "a.com",
      "b.com",
      "a.com",
    ]);
  });

  it("同批 URL 去重（含归一化后相同的）", () => {
    const results = [
      result("q1", ["https://a.com/1", "https://a.com/1/?utm_source=x"]),
      result("q2", ["https://A.com/1#x"]),
    ];
    expect(
      collectCandidates({ results, queries, knownUrlKeys: new Set() }),
    ).toHaveLength(1);
  });

  it("标题规范化后完全相同也去重", () => {
    const results: QueryResultData[] = [
      {
        query: "q1",
        answer: "",
        error: null,
        results: [
          { url: "https://a.com/1", title: "Hello，World!", snippet: "s" },
          { url: "https://b.com/2", title: "hello world", snippet: "s" },
        ],
      },
    ];
    expect(
      collectCandidates({ results, queries, knownUrlKeys: new Set() }),
    ).toHaveLength(1);
  });

  it("跨天去重：已知 urlKey 不再进候选", () => {
    const results = [result("q1", ["https://a.com/1", "https://a.com/2"])];
    const candidates = collectCandidates({
      results,
      queries,
      knownUrlKeys: new Set(["a.com/1"]),
    });
    expect(candidates.map((item) => item.url)).toEqual(["https://a.com/2"]);
  });

  it("失败的 query 直接跳过，不影响其他 query", () => {
    const results: QueryResultData[] = [
      { query: "q1", answer: "", results: [], error: "boom" },
      result("q2", ["https://b.com/1"]),
    ];
    expect(
      collectCandidates({ results, queries, knownUrlKeys: new Set() }),
    ).toHaveLength(1);
  });

  it("候选按 0 起编号，且不超过上限", () => {
    const results = [
      result(
        "q1",
        Array.from({ length: 20 }, (_, i) => `https://a.com/${i}`),
      ),
      result(
        "q2",
        Array.from({ length: 20 }, (_, i) => `https://b.com/${i}`),
      ),
    ];
    const candidates = collectCandidates({
      results,
      queries,
      knownUrlKeys: new Set(),
    });
    expect(candidates).toHaveLength(CANDIDATE_LIMIT);
    expect(candidates[0].id).toBe(0);
    expect(candidates[CANDIDATE_LIMIT - 1].id).toBe(CANDIDATE_LIMIT - 1);
  });

  it("带上 topic 与 reason，供后面写条目与展示依据", () => {
    const candidates = collectCandidates({
      results: [result("q2", ["https://b.com/1"])],
      queries,
      knownUrlKeys: new Set(),
    });
    expect(candidates[0].topic).toBe("T2");
    expect(candidates[0].reason).toBe("r2");
  });

  it("结果里 query 不在 planned 列表里时忽略", () => {
    const candidates = collectCandidates({
      results: [result("unknown-query", ["https://a.com/1"])],
      queries,
      knownUrlKeys: new Set(),
    });
    expect(candidates).toEqual([]);
  });
});
