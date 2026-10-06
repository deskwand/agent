// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { FeedReaderPane } from "../../renderer/components/FeedReaderPane";
import type { FeedItemWithMeta } from "../../shared/feed";

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
        body: { body: "正文第一段。", bodyStatus: "ok" },
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
    expect(Number.parseFloat(body.style.lineHeight)).toBeGreaterThanOrEqual(
      1.75,
    );
  });

  it("snippet_only 时给出「只抓到片段」提示", async () => {
    await render({ body: { body: "片段", bodyStatus: "snippet_only" } });
    expect(container.textContent).toContain("feed.readerSnippetOnly");
  });

  it("没有正文时只显示摘要，不显示空正文块", async () => {
    await render({ body: { body: null, bodyStatus: "snippet_only" } });
    expect(container.querySelector('[data-testid="feed-body"]')).toBeNull();
  });

  it("有图时渲染大图，无图时不渲染图片块", async () => {
    await render();
    expect(container.querySelector('[data-testid="feed-hero"]')).toBeTruthy();
    await render({ item: { ...item, imageUrl: null } });
    expect(container.querySelector('[data-testid="feed-hero"]')).toBeNull();
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
