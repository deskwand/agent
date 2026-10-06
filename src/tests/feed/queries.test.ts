import { describe, expect, it, vi } from "vitest";
import {
  MAX_QUERIES,
  parseQueriesResponse,
  planQueries,
} from "../../main/feed/feed-queries";
import type { FeedSignals } from "../../main/feed/feed-signals";

const signals: FeedSignals = {
  interests: ["Rust 异步运行时"],
  preferences: [],
  recentQuestions: [{ sessionTitle: "调 tokio", text: "blocking pool 怎么调" }],
  blockedTopics: [],
};

const goodJson = JSON.stringify({
  topics: [{ label: "Rust 异步运行时" }, { label: "Postgres 运维" }],
  queries: [
    {
      q: "tokio runtime 新特性",
      topic: "Rust 异步运行时",
      reason: "你最近在调 tokio",
    },
    { q: "postgres 逻辑复制", topic: "Postgres 运维", reason: "你问过复制延迟" },
  ],
});

describe("parseQueriesResponse", () => {
  it("解析合法 JSON", () => {
    const parsed = parseQueriesResponse(goodJson, []);
    expect(parsed?.queries).toHaveLength(2);
    expect(parsed?.queries[0].q).toBe("tokio runtime 新特性");
  });

  it("剥掉 ```json 围栏", () => {
    expect(
      parseQueriesResponse("```json\n" + goodJson + "\n```", []),
    ).not.toBeNull();
  });

  it("非 JSON 返回 null", () => {
    expect(parseQueriesResponse("我建议你关注……", [])).toBeNull();
  });

  it("缺少 queries 数组返回 null", () => {
    expect(parseQueriesResponse('{"topics":[]}', [])).toBeNull();
  });

  it("丢弃缺字段、空字符串与 topic 命中屏蔽列表的项", () => {
    const parsed = parseQueriesResponse(
      JSON.stringify({
        topics: [
          { label: "Rust 异步运行时" },
          { label: "不要的主题" },
          { label: "" },
        ],
        queries: [
          { q: "a", topic: "Rust 异步运行时", reason: "r" },
          { q: "", topic: "x", reason: "r" },
          { q: "b", topic: "不要的主题", reason: "r" },
          { q: "c" },
        ],
      }),
      ["不要的主题"],
    );
    expect(parsed?.queries.map((item) => item.q)).toEqual(["a"]);
    expect(parsed?.topics.map((item) => item.label)).toEqual([
      "Rust 异步运行时",
    ]);
  });

  it("超过 6 个 query 时截断", () => {
    const parsed = parseQueriesResponse(
      JSON.stringify({
        topics: [],
        queries: Array.from({ length: 10 }, (_, i) => ({
          q: `q${i}`,
          topic: "t",
          reason: "r",
        })),
      }),
      [],
    );
    expect(parsed?.queries).toHaveLength(MAX_QUERIES);
  });

  it("topics 去重", () => {
    const parsed = parseQueriesResponse(
      JSON.stringify({
        topics: [{ label: "T" }, { label: "T" }],
        queries: [{ q: "a", topic: "T", reason: "r" }],
      }),
      [],
    );
    expect(parsed?.topics).toHaveLength(1);
  });
});

describe("planQueries", () => {
  it("第一次就成功时不重试", async () => {
    const complete = vi.fn().mockResolvedValue(goodJson);
    const result = await planQueries({
      signals,
      blockedTopics: [],
      locale: "zh",
      complete,
    });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(result.queries).toHaveLength(2);
  });

  it("第一次是废话时重试一次，第二次成功", async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce("我不太确定")
      .mockResolvedValueOnce(goodJson);
    const result = await planQueries({
      signals,
      blockedTopics: [],
      locale: "zh",
      complete,
    });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(result.queries).toHaveLength(2);
  });

  it("模型调用抛错时也重试，再退化", async () => {
    const complete = vi.fn().mockRejectedValue(new Error("boom"));
    const result = await planQueries({
      signals,
      blockedTopics: [],
      locale: "zh",
      complete,
    });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(result.queries.map((item) => item.q)).toEqual(["Rust 异步运行时"]);
  });

  it("两次都失败时退化为拿记忆里的兴趣直接当查询词", async () => {
    const complete = vi.fn().mockResolvedValue("还是不听话");
    const result = await planQueries({
      signals,
      blockedTopics: [],
      locale: "zh",
      complete,
    });
    expect(result.queries.map((item) => item.q)).toEqual(["Rust 异步运行时"]);
    expect(result.queries[0].reason).toBe("");
  });

  it("连兴趣也没有时返回空查询词（调用方据此跳过本次）", async () => {
    const complete = vi.fn().mockResolvedValue("垃圾");
    const result = await planQueries({
      signals: { ...signals, interests: [], recentQuestions: [] },
      blockedTopics: [],
      locale: "zh",
      complete,
    });
    expect(result.queries).toEqual([]);
  });

  it("prompt 里带上屏蔽主题", async () => {
    const complete = vi.fn().mockResolvedValue(goodJson);
    await planQueries({
      signals,
      blockedTopics: ["不要的主题"],
      locale: "zh",
      complete,
    });
    expect(complete.mock.calls[0][0].userPrompt).toContain("不要的主题");
    expect(complete.mock.calls[0][0].systemPrompt).toBeTruthy();
  });
});
