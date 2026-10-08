// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { FeedReaderPane } from "../../renderer/components/FeedReaderPane";
import type { FeedBodyPayload, FeedItemWithMeta } from "../../shared/feed";

/** 有本地化摘录的那条路径 */
const withExcerpt: FeedBodyPayload = {
  body: "# 抓来的 markdown",
  bodyStatus: "ok",
  excerpt: "这是本地化摘录。",
};

const item: FeedItemWithMeta = {
  id: "i1",
  run_id: "r1",
  title: "标题",
  summary: "摘要",
  url: "https://a.com/1",
  url_key: "a.com/1",
  source_host: "a.com",
  topic: "主题",
  relevance: "为什么和你相关",
  body_status: "ok",
  image_url: null,
  image_file: null,
  image_status: "none",
  created_at: 1,
  published_at: null,
  read_at: null,
  dismissed_at: null,
  unprocessed: 0,
  imageUrl: "deskwand-feed-image://local/f.jpg",
};

let container: HTMLDivElement;
let root: Root;
const noop = () => {};

beforeEach(() => {
  container = document.createElement("div");
  document.body.innerHTML = "";
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(
  props: Partial<React.ComponentProps<typeof FeedReaderPane>> = {},
) {
  await act(async () => {
    root.render(
      React.createElement(FeedReaderPane, {
        item,
        body: { body: "正文第一段。", bodyStatus: "ok", excerpt: null },
        onOpenInBrowser: noop,
        ...props,
      } as React.ComponentProps<typeof FeedReaderPane>),
    );
  });
}

describe("FeedReaderPane", () => {
  it("渲染标题、摘要、相关性、正文，且文案叫「摘录」不叫「原文」", async () => {
    await render();
    expect(container.textContent).toContain("标题");
    expect(container.textContent).toContain("摘要");
    expect(container.textContent).toContain("为什么和你相关");
    expect(container.textContent).toContain("正文第一段。");
    expect(container.textContent).toContain("feed.readerExcerpt");
    expect(container.textContent).not.toContain("原文");
  });

  it("正文限宽（不是通栏）：宽度归居中列管，正文只负责排版", async () => {
    await render();
    // 限宽从正文自身收上到列（宽屏下多出来的宽度由列两侧均分，见「居中列」那条）
    const column = container.querySelector(
      '[data-testid="feed-reader-column"]',
    ) as HTMLElement;
    expect(column.style.maxWidth).toBe("34em");
    const body = container.querySelector(
      '[data-testid="feed-body"]',
    ) as HTMLElement;
    expect(body.style.maxWidth).toBe("");
    // 行高不再写在元素上，改由 .prose-feed 规则给（数值由 feed-prose.test.ts 守）
    expect(body.className).toContain("prose-feed");
  });

  it("有本地化摘录时渲染摘录，元信息行标「· 本地化」", async () => {
    await render({ body: withExcerpt });
    expect(container.textContent).toContain("这是本地化摘录。");
    expect(container.querySelector('[data-testid="feed-raw-note"]')).toBeNull();
    // 标签只在元信息行出现一次 —— 底部那次已删（设计 §8.1 第 4 条：同一屏不标两遍）
    expect(
      (container.textContent?.match(/feed\.readerExcerptLocalized/g) ?? [])
        .length,
    ).toBe(1);
    expect(
      container.querySelector('[data-testid="feed-open-browser"]'),
    ).toBeTruthy();
  });

  it("没有摘录时渲染抓来的正文，并显示一行说明（标签退回「正文摘录」）", async () => {
    await render();
    expect(
      container.querySelector('[data-testid="feed-raw-note"]'),
    ).toBeTruthy();
    expect(container.textContent).toContain("feed.readerRawFallback");
    expect(
      (container.textContent?.match(/feed\.readerExcerptLocalized/g) ?? [])
        .length,
    ).toBe(0);
    // 只在元信息行出现一次
    expect(
      (container.textContent?.match(/feed\.readerExcerpt/g) ?? []).length,
    ).toBe(1);
  });

  it("markdown 标记不再以字面出现（截图那个 bug 的回归锁）", async () => {
    await render({
      body: {
        body: "## 小标题\n\n**粗体**内容",
        bodyStatus: "ok",
        excerpt: null,
      },
    });
    const text = container.textContent ?? "";
    expect(text).not.toContain("##");
    expect(text).not.toContain("**");
    // 只断言 strong（`##` 变成的标题元素与面板自己的标题 h2 撞车，那个断言等于没断言）
    expect(container.querySelector("strong")).toBeTruthy();
  });

  it("摘录里的 $ 不会被当成公式吃掉", async () => {
    await render({
      body: {
        body: null,
        bodyStatus: "ok",
        excerpt: "标准版 $95.4/百万字符，最新版 $139.92/百万字符。",
      },
    });
    const text = container.textContent ?? "";
    expect(text).toContain("$95.4");
    expect(text).toContain("$139.92");
    expect(container.querySelector(".katex")).toBeNull();
  });

  it("snippet_only 时给出「只抓到片段」提示", async () => {
    await render({
      body: { body: "片段", bodyStatus: "snippet_only", excerpt: null },
    });
    expect(container.textContent).toContain("feed.readerSnippetOnly");
  });

  it("没有正文时只显示摘要，不显示空正文块", async () => {
    await render({
      body: { body: null, bodyStatus: "snippet_only", excerpt: null },
    });
    expect(container.querySelector('[data-testid="feed-body"]')).toBeNull();
  });

  it("有图时渲染大图，无图时不渲染图片块", async () => {
    await render();
    expect(container.querySelector('[data-testid="feed-hero"]')).toBeTruthy();
    await render({ item: { ...item, imageUrl: null } });
    expect(container.querySelector('[data-testid="feed-hero"]')).toBeNull();
  });

  it("字号用 token：标题 text-lg、正文 text-base、大图高度写 rem", async () => {
    await render();
    const title = container.querySelector("h2") as HTMLElement;
    const body = container.querySelector(
      '[data-testid="feed-body"]',
    ) as HTMLElement;
    const hero = container.querySelector(
      '[data-testid="feed-hero"]',
    ) as HTMLElement;
    expect(title.className).toContain("text-lg");
    expect(body.className).toContain("text-base");
    // 正文是右栏里唯一要真读的段落：浅色主题下 muted 在 background-secondary 上只有 4.06:1
    expect(body.className).toContain("text-text-primary");
    expect(hero.className).not.toMatch(/h-\[\d+px\]/);
    expect(container.innerHTML).not.toMatch(/text-\[[0-9.]+px\]/);
  });

  it("「在浏览器中打开完整页面」把 url 交给调用方", async () => {
    const onOpenInBrowser = vi.fn();
    await render({ onOpenInBrowser });
    await act(async () => {
      (
        container.querySelector(
          '[data-testid="feed-open-browser"]',
        ) as HTMLElement
      ).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onOpenInBrowser).toHaveBeenCalledWith("https://a.com/1");
  });
});

describe("底部那一行", () => {
  it("被截断的相关性有 title 兜底 —— 右栏是这句话唯一出现的地方", async () => {
    await render();
    const rel = container.querySelector(
      '[data-testid="feed-relevance"]',
    ) as HTMLElement | null;
    expect(rel).not.toBeNull();
    // 列宽 476 里还要让出「打开原文」，这条 span 只剩约 320px：截掉的尾巴必须能拿回来
    expect(rel?.className).toContain("truncate");
    expect(rel?.getAttribute("title")).toBe("为什么和你相关");
  });
});

describe("居中列", () => {
  it("标题、正文与出口都在同一个居中列里（宽屏下空白一分为二）", async () => {
    await render({ body: withExcerpt });
    const column = container.querySelector(
      '[data-testid="feed-reader-column"]',
    ) as HTMLElement | null;
    expect(column).not.toBeNull();
    // 居中：宽屏下多出来的宽度两侧均分，而不是全堆在右边（改前右栏 1104px 里空 588px）
    expect(column?.className).toContain("mx-auto");
    // 一条列管住正文类内容 —— 漏掉任何一个，它就会贴回左边缘
    for (const testid of ["feed-body", "feed-open-browser"]) {
      expect(column?.querySelector(`[data-testid="${testid}"]`)).not.toBeNull();
    }
    expect(column?.textContent).toContain("这是本地化摘录。");
    expect(column?.textContent).toContain("标题");
  });

  it("大图比正文列宽，且是列外的兄弟节点（breakout：图片允许比正文宽）", async () => {
    await render();
    const hero = container.querySelector(
      '[data-testid="feed-hero"]',
    ) as HTMLElement | null;
    const column = container.querySelector(
      '[data-testid="feed-reader-column"]',
    ) as HTMLElement;
    expect(hero).not.toBeNull();
    // 在列外：否则它会被 34em 一起卡住，breakout 无从谈起
    expect(column.contains(hero)).toBe(false);
    expect(hero?.parentElement).toBe(column.parentElement);
    expect(hero?.className).toContain("mx-auto");
    // 它现在是 flex 纵列里的一项，默认 flex-shrink:1 —— 长正文会先把它压成横条、再压成 0
    // （真实浏览器实测：无 shrink-0 时 10 段正文就只剩 4px 高，20 段以上归零）
    expect(hero?.className).toContain("shrink-0");
    const heroEm = parseFloat(hero?.style.maxWidth ?? "");
    const colEm = parseFloat(column.style.maxWidth);
    expect(heroEm / colEm).toBeCloseTo(1.4, 1);
  });
});
