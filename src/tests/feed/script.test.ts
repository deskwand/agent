import { describe, expect, it, vi } from "vitest";

import {
  SCRIPT_MAX_CHARS,
  buildScriptPrompt,
  cleanScript,
  writeScript,
} from "../../main/feed/feed-script";
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

describe("buildScriptPrompt", () => {
  it("带上 locale、把页面文本当数据、禁列表与链接、禁客套开头结尾", () => {
    const { systemPrompt, userPrompt } = buildScriptPrompt("正文素材", "zh-CN");
    expect(userPrompt).toBe("正文素材");
    expect(systemPrompt).toContain("zh-CN");
    expect(systemPrompt).toContain("untrusted");
    expect(systemPrompt).toContain("400-700");
    expect(systemPrompt).toContain("no welcome");
    expect(systemPrompt).toContain("No lists");
  });
});

describe("cleanScript", () => {
  it("剥代码围栏与链接，保留邮箱（音频里不可点击，剥它会切断句子）", () => {
    expect(cleanScript("```\n今天讲一件事。\n```")).toBe("今天讲一件事。");
    // markdown 链接只留文字
    expect(cleanScript("详见 [原文](https://a.com/x)。")).toBe("详见 原文。");
    // 裸 URL / www. 用 `\S+` 贪婪匹配：URL 后直接跟标点会把标点一起吃掉，
    // 前后留空格则只吃 URL 本身。两条都把真实行为钉住（正则与上游摘录清洗同源）。
    expect(cleanScript("看 https://a.com/x。")).toBe("看");
    expect(cleanScript("看 https://a.com/x 就够了。")).toBe("看  就够了。");
    // **不剥邮箱** —— 这是与上游摘录清洗唯一的行为差异，是有意的
    expect(cleanScript("写信到 a@b.com 找我。")).toBe("写信到 a@b.com 找我。");
  });

  it("截断到硬上限；空内容返回 null", () => {
    expect(cleanScript("字".repeat(SCRIPT_MAX_CHARS + 50))).toHaveLength(
      SCRIPT_MAX_CHARS,
    );
    expect(cleanScript("   \n  ")).toBeNull();
  });
});

describe("writeScript", () => {
  it("成功时返回清洗后的稿子", async () => {
    const complete = vi.fn(async () => "```\n今天的稿子。\n```");
    await expect(writeScript(draft(), "zh-CN", complete)).resolves.toBe(
      "今天的稿子。",
    );
  });

  it("模型抛错时返回 null，不向外抛", async () => {
    const complete = vi.fn(async () => {
      throw new Error("boom");
    });
    await expect(writeScript(draft(), "zh-CN", complete)).resolves.toBeNull();
  });
});
