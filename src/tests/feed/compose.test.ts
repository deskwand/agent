import { describe, expect, it, vi } from "vitest";
import {
  MAX_ITEMS,
  composeItems,
  parseComposeResponse,
} from "../../main/feed/feed-compose";
import type { FeedFetchedCandidate } from "../../main/feed/feed-fetch";

const candidates: FeedFetchedCandidate[] = [
  {
    id: 0,
    title: "A",
    url: "https://a.com/1",
    urlKey: "a.com/1",
    host: "a.com",
    snippet: "s",
    topic: "T",
    reason: "r",
    publishedAt: null,
    body: "正文 A",
    bodyStatus: "ok",
  },
  {
    id: 1,
    title: "B",
    url: "https://b.com/1",
    urlKey: "b.com/1",
    host: "b.com",
    snippet: "s",
    topic: "T",
    reason: "r",
    publishedAt: null,
    body: "正文 B",
    bodyStatus: "ok",
  },
];

function reply(items: unknown[]): string {
  return JSON.stringify({ items });
}

describe("parseComposeResponse", () => {
  it("解析合法响应并保留 candidateId", () => {
    const parsed = parseComposeResponse(
      reply([
        {
          candidateId: 1,
          title: "中文标题 B",
          summary: "摘要",
          topic: "T",
          relevance: "和你相关",
          keep: true,
        },
      ]),
      candidates,
    );
    expect(parsed).toEqual([
      {
        candidateId: 1,
        title: "中文标题 B",
        summary: "摘要",
        topic: "T",
        relevance: "和你相关",
      },
    ]);
  });

  it("candidateId 越界或不是数字时丢弃该条（防幻觉第一道）", () => {
    const parsed = parseComposeResponse(
      reply([
        {
          candidateId: 99,
          title: "x",
          summary: "y",
          topic: "T",
          relevance: "r",
          keep: true,
        },
        {
          candidateId: "abc",
          title: "x",
          summary: "y",
          topic: "T",
          relevance: "r",
          keep: true,
        },
        {
          candidateId: 0,
          title: "ok",
          summary: "y",
          topic: "T",
          relevance: "r",
          keep: true,
        },
      ]),
      candidates,
    );
    expect(parsed?.map((item) => item.candidateId)).toEqual([0]);
  });

  it("keep:false 的丢弃", () => {
    const parsed = parseComposeResponse(
      reply([
        {
          candidateId: 0,
          title: "x",
          summary: "y",
          topic: "T",
          relevance: "r",
          keep: false,
        },
      ]),
      candidates,
    );
    expect(parsed).toEqual([]);
  });

  it("缺 title 或 summary 的丢弃", () => {
    const parsed = parseComposeResponse(
      reply([
        { candidateId: 0, topic: "T", relevance: "r", keep: true },
        { candidateId: 1, title: "y", topic: "T", keep: true },
      ]),
      candidates,
    );
    expect(parsed).toEqual([]);
  });

  it("超过 8 条时截断", () => {
    const many = Array.from({ length: 20 }, () => ({
      candidateId: 0,
      title: "t",
      summary: "s",
      topic: "T",
      relevance: "r",
      keep: true,
    }));
    expect(parseComposeResponse(reply(many), candidates)).toHaveLength(
      MAX_ITEMS,
    );
  });

  it("非 JSON 返回 null；items 不是数组也返回 null", () => {
    expect(parseComposeResponse("好的", candidates)).toBeNull();
    expect(parseComposeResponse('{"items":{}}', candidates)).toBeNull();
  });
});

describe("composeItems", () => {
  it("**防幻觉**：模型在 title 里塞链接也没用，入库的 url 永远来自候选池", async () => {
    const complete = vi.fn().mockResolvedValue(
      reply([
        {
          candidateId: 0,
          title: "点这里 https://evil.example.com/x",
          summary: "摘要",
          topic: "T",
          relevance: "r",
          keep: true,
        },
      ]),
    );
    const drafts = await composeItems({ candidates, locale: "zh", complete });
    expect(drafts[0].candidate.url).toBe("https://a.com/1");
    expect(drafts[0].candidate.urlKey).toBe("a.com/1");
  });

  it("标题与摘要取模型给的值，topic/relevance 缺省时回落到候选上的值", async () => {
    const complete = vi
      .fn()
      .mockResolvedValue(
        reply([
          { candidateId: 0, title: "新标题", summary: "新摘要", keep: true },
        ]),
      );
    const drafts = await composeItems({ candidates, locale: "zh", complete });
    expect(drafts[0].title).toBe("新标题");
    expect(drafts[0].summary).toBe("新摘要");
    expect(drafts[0].topic).toBe("T");
    expect(drafts[0].relevance).toBe("r");
    expect(drafts[0].unprocessed).toBe(0);
  });

  it("两次都失败时把候选前 8 条原样入库并标未加工", async () => {
    const complete = vi.fn().mockResolvedValue("不听");
    const drafts = await composeItems({ candidates, locale: "zh", complete });
    expect(drafts.map((item) => item.title)).toEqual(["A", "B"]);
    expect(drafts.every((item) => item.unprocessed === 1)).toBe(true);
    expect(drafts[0].summary).toBeNull();
  });

  it("模型全标 keep:false 时返回空数组（不是退化）", async () => {
    const complete = vi
      .fn()
      .mockResolvedValue(
        reply([{ candidateId: 0, title: "x", summary: "y", keep: false }]),
      );
    expect(await composeItems({ candidates, locale: "zh", complete })).toEqual(
      [],
    );
  });

  it("prompt 里带序号，并要求只回 candidateId", async () => {
    const complete = vi.fn().mockResolvedValue(reply([]));
    await composeItems({ candidates, locale: "zh", complete });
    const { systemPrompt, userPrompt } = complete.mock.calls[0][0];
    expect(userPrompt).toContain('"id":0');
    expect(systemPrompt).toContain("candidateId");
  });

  it("候选为空时直接返回空，不调模型", async () => {
    const complete = vi.fn();
    expect(
      await composeItems({ candidates: [], locale: "zh", complete }),
    ).toEqual([]);
    expect(complete).not.toHaveBeenCalled();
  });
});
