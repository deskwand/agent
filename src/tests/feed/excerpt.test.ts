import { describe, expect, it, vi } from "vitest";

import {
  EXCERPT_MAX_CHARS,
  buildExcerptPrompt,
  cleanExcerpt,
  writeExcerpts,
} from "../../main/feed/feed-excerpt";
import type { FeedItemDraft } from "../../main/feed/feed-compose";

function draft(overrides: Partial<FeedItemDraft> = {}): FeedItemDraft {
  return {
    candidate: {
      id: 0,
      url: "https://a.com/1",
      urlKey: "a.com/1",
      host: "a.com",
      title: "A",
      snippet: "片段",
      topic: "主题",
      reason: "理由",
      publishedAt: null,
      body: "页面正文，约有几百字。".repeat(20),
      bodyStatus: "ok",
    },
    title: "标题",
    summary: "摘要",
    topic: "主题",
    relevance: "理由",
    excerpt: null,
    script: null,
    unprocessed: 0,
    ...overrides,
  };
}

describe("buildExcerptPrompt", () => {
  it("带上素材、locale，以及「把页面文本当数据」那句", () => {
    const { systemPrompt, userPrompt } = buildExcerptPrompt(
      "正文素材",
      "zh-CN",
    );
    expect(systemPrompt).toContain("locale: zh-CN");
    expect(systemPrompt).toContain("untrusted page text");
    expect(userPrompt).toBe("正文素材");
  });
});

describe("cleanExcerpt", () => {
  it("正常文本原样返回（trim 过）", () => {
    expect(cleanExcerpt("  一段摘录。  ")).toBe("一段摘录。");
  });

  it("剥掉代码围栏", () => {
    expect(cleanExcerpt("```markdown\n一段摘录。\n```")).toBe("一段摘录。");
  });

  it("剥掉 markdown 链接、图片与裸 URL，只留文字", () => {
    expect(
      cleanExcerpt(
        "见 [文档](https://a.com/x) 与 ![图](https://a.com/i.png) 以及 https://b.com/y 的说明",
      ),
    ).toBe("见 文档 与  以及  的说明");
  });

  it("remark-gfm 会自动变成链接的两种写法也剥掉（www. 与邮箱）", () => {
    expect(cleanExcerpt("参见 www.a.com/x 或写信到 hi@a.com 询问")).toBe(
      "参见  或写信到  询问",
    );
  });

  it("空串与纯空白算失败", () => {
    expect(cleanExcerpt("   \n  ")).toBeNull();
    expect(cleanExcerpt("```\n\n```")).toBeNull();
  });

  it("超长截到硬上限", () => {
    expect(cleanExcerpt("字".repeat(5000))?.length).toBe(EXCERPT_MAX_CHARS);
  });
});

describe("writeExcerpts", () => {
  const isScript = (prompt: { systemPrompt: string }) =>
    prompt.systemPrompt.includes("spoken-word");

  it("逐条写：摘录与稿子各写一次，结果填进各自字段", async () => {
    const complete = vi.fn(async (prompt: { systemPrompt: string }) =>
      isScript(prompt) ? "口播稿。" : "第一段摘录。",
    );
    const out = await writeExcerpts({
      drafts: [draft()],
      locale: "zh-CN",
      complete,
    });
    expect(out[0]?.excerpt).toBe("第一段摘录。");
    expect(out[0]?.script).toBe("口播稿。");
    expect(
      complete.mock.calls.filter(([prompt]) => !isScript(prompt)),
    ).toHaveLength(1);
  });

  it("摘录与口播稿并发写：一方失败不牵连另一方", async () => {
    const complete = vi.fn(async (prompt: { systemPrompt: string }) => {
      if (isScript(prompt)) return "口播稿写好了。";
      throw new Error("excerpt boom");
    });
    const [out] = await writeExcerpts({
      drafts: [draft()],
      locale: "zh-CN",
      complete,
    });
    expect(out.excerpt).toBeNull();
    expect(out.script).toBe("口播稿写好了。");
  });

  it("两个调用是并发的，不是串行", async () => {
    const order: string[] = [];
    const complete = vi.fn(async (prompt: { systemPrompt: string }) => {
      const kind = isScript(prompt) ? "script" : "excerpt";
      order.push(`${kind}:start`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push(`${kind}:end`);
      return "内容";
    });
    await writeExcerpts({ drafts: [draft()], locale: "zh-CN", complete });
    expect(order.slice(0, 2).sort()).toEqual(["excerpt:start", "script:start"]);
  });

  it("某条抛错只丢那一条，不中断后面的（摘录失败不连坐稿子）", async () => {
    let excerptCall = 0;
    const complete = vi.fn(async (prompt: { systemPrompt: string }) => {
      if (isScript(prompt)) return "口播稿。";
      excerptCall += 1;
      if (excerptCall === 2) throw new Error("boom");
      return `第 ${excerptCall} 段摘录。`;
    });
    const out = await writeExcerpts({
      drafts: [draft(), draft(), draft()],
      locale: "zh-CN",
      complete,
    });
    expect(out.map((entry) => entry.excerpt)).toEqual([
      "第 1 段摘录。",
      null,
      "第 3 段摘录。",
    ]);
    expect(out.map((entry) => entry.script)).toEqual([
      "口播稿。",
      "口播稿。",
      "口播稿。",
    ]);
  });

  it("compose 兜底产物（unprocessed: 1）摘录与稿子都不写、不发请求", async () => {
    const complete = vi.fn(async (prompt: { systemPrompt: string }) =>
      isScript(prompt) ? "口播稿。" : "摘录。",
    );
    const out = await writeExcerpts({
      drafts: [draft({ unprocessed: 1 }), draft()],
      locale: "zh-CN",
      complete,
    });
    expect(out[0]?.excerpt).toBeNull();
    expect(out[0]?.script).toBeNull();
    // 只有第二条发了请求：两次（摘录 + 稿子），不是四次
    expect(complete).toHaveBeenCalledTimes(2);
  });
});
