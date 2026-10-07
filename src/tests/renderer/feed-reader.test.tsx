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

  it("正文容器限宽（不是通栏），行高 ≥ 1.75", async () => {
    await render();
    const body = container.querySelector(
      '[data-testid="feed-body"]',
    ) as HTMLElement;
    expect(body.style.maxWidth).toBe("34em");
    // 行高不再写在元素上，改由 .prose-feed 规则给（数值由 feed-prose.test.ts 守）
    expect(body.className).toContain("prose-feed");
  });

  it("有本地化摘录时渲染摘录，元信息行与底部两处都是「· 本地化」", async () => {
    await render({ body: withExcerpt });
    expect(container.textContent).toContain("这是本地化摘录。");
    expect(container.querySelector('[data-testid="feed-raw-note"]')).toBeNull();
    // 两处标签都得变（元信息行 + 底部）—— 只改一处会在同一屏自相矛盾
    expect(
      (container.textContent?.match(/feed\.readerExcerptLocalized/g) ?? [])
        .length,
    ).toBe(2);
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
    // 不加 (?![A-Za-z])：底部那个标签后面紧跟着按钮的 key，加了会把那一处排掉
    expect(
      (container.textContent?.match(/feed\.readerExcerpt/g) ?? []).length,
    ).toBe(2);
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
